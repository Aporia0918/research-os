"""Mac scenarios of the local update e2e check (ADR-267), run by e2e_check.py on any POSIX box: a fake ResearchOS.app
(version file + the real stop.sh) installed in a temp "Applications" folder, a fake app server (answers
/api/v1/health with the app's version, pid file like start.sh), stand-ins for the macOS tools `ditto` (unzip) and
`open` (starts the fake server), the real Updater and the real scripts/apply_update.sh. macOS NOT RUN: the real
ditto / open / Gatekeeper path needs a Mac."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from researchos import __version__
from researchos.kernel.config import Settings
from researchos.services.ops.update_feed import asset_name
from researchos.services.ops.updater import Updater

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_common import (  # noqa: E402
    FAKE_INSTALLER,
    SIMULATED_INSTALLED,
    TAMPERED_SHA256,
    Signer,
    Step,
    check_and_download,
    serve,
    step,
)
from manifest import signed, write_release  # noqa: E402

APP_SCRIPTS = Path(__file__).resolve().parents[1]
MAC = "darwin-arm64"
# injected mv failures (see _stand_ins): the rollback's move of .prev back; the swap's move in and its recovery move
MV_FAIL = {"rollback-mv-fail": "*/ResearchOS.app.prev",
           "swap-mv-fail": "*/.ResearchOS-update-*/ResearchOS.app */ResearchOS.app.prev"}

FAKE_SERVER = """import json, os, re, signal, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
app, port, data = sys.argv[1], int(sys.argv[2]), sys.argv[3]
res = os.path.join(app, "Contents", "Resources", "app")
if os.path.exists(os.path.join(res, "BROKEN")):
    sys.exit(1)
version = re.search(r'^version = "(.*)"$', open(os.path.join(res, "pyproject.toml")).read(), re.M).group(1)
if os.path.exists(os.path.join(res, "SLOW_EXIT")):  # answers, but not with its version; SIGTERM: exits 3 s later
    version = "unhealthy"
    signal.signal(signal.SIGTERM, lambda *a: threading.Thread(target=lambda: (time.sleep(3), os._exit(0))).start())
body = json.dumps({"status": "ok", "version": version}).encode()
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("content-length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
srv = HTTPServer(("127.0.0.1", port), H)
os.makedirs(os.path.join(data, "run"), exist_ok=True)
open(os.path.join(data, "run", "api.pid"), "w").write(str(os.getpid()))
srv.serve_forever()
"""


def _stand_ins(bin_dir: Path, server: Path) -> None:
    """`ditto -x -k <zip> <dir>` and `open <app>` for a POSIX box without macOS (both log their calls), and an `mv`
    that fails on request."""
    bin_dir.mkdir(parents=True)
    py = sys.executable
    tools = {"ditto": f'#!/bin/sh\n[ "$1 $2" = "-x -k" ] || exit 64\necho "$*" >> "$E2E_DITTO_LOG"\n'
                      f'exec "{py}" -m zipfile -e "$3" "$4"\n',
             "open": f'#!/bin/sh\necho "$1" >> "$E2E_OPEN_LOG"\n'
                     f'nohup "{py}" "{server}" "$1" "$E2E_PORT" "$E2E_DATA" >/dev/null 2>&1 &\n',
             # E2E_MV_FAIL: space-separated globs; a move whose source matches one fails (an injected rename error)
             "mv": f'#!/bin/sh\nset -f\nfor p in ${{E2E_MV_FAIL:-}}; do case "$1" in $p) '
                   f'echo "mv: injected failure: $1" >&2; exit 1;; esac; done\nexec "{shutil.which("mv")}" "$@"\n'}
    for name, text in tools.items():
        (bin_dir / name).write_text(text, encoding="utf-8")
        (bin_dir / name).chmod(0o755)


def fake_app(folder: Path, version: str, *, marker: str = "") -> Path:
    """<folder>/ResearchOS.app with a version file and the real stop.sh / apply_update.sh; returns the .app. marker:
    BROKEN (the fake server refuses to start) or SLOW_EXIT (it answers unhealthy and exits 3 s after SIGTERM)."""
    app = folder / "ResearchOS.app"
    res = app / "Contents" / "Resources" / "app"
    (res / "scripts").mkdir(parents=True)
    (res / "pyproject.toml").write_text(f'[project]\nname = "researchos"\nversion = "{version}"\n', encoding="utf-8")
    for script in ("stop.sh", "apply_update.sh"):
        shutil.copyfile(APP_SCRIPTS / script, res / "scripts" / script)
    if marker:
        (res / marker).write_text("fake server behaviour for the e2e check\n", encoding="utf-8")
    return app


def mac_zip(work: Path, version: str, *, marker: str = "") -> Path:
    """ResearchOS-<v>-mac-arm64.zip of a fake app, laid out like `ditto -c -k --keepParent`."""
    app = fake_app(work / "zip-src", version, marker=marker)
    out = work / asset_name(version, MAC)
    with zipfile.ZipFile(out, "w") as z:
        for f in sorted(app.rglob("*")):
            z.write(f, f.relative_to(app.parent).as_posix())
    shutil.rmtree(app.parent)
    return out


def _version_of(app: Path) -> str | None:
    try:
        text = (app / "Contents" / "Resources" / "app" / "pyproject.toml").read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r'^version = "(.*)"$', text, re.M)
    return m.group(1) if m else None


def _health(port: int) -> str | None:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2) as sk:
            sk.sendall(b"GET /api/v1/health HTTP/1.0\r\n\r\n")
            reply = b"".join(iter(lambda: sk.recv(4096), b""))
        return str(json.loads(reply.split(b"\r\n\r\n", 1)[1])["version"])
    except (OSError, ValueError, KeyError, IndexError):
        return None


def _wait_health(port: int, want: str, timeout_s: float = 10.0) -> str | None:
    deadline, seen = time.monotonic() + timeout_s, None
    while time.monotonic() < deadline:
        seen = _health(port)
        if seen == want:
            break
        time.sleep(0.1)
    return seen


@dataclass(frozen=True)
class MacBox:
    """The fake Mac: Applications folder, data + logs, a free port, PATH with the stand-ins."""
    apps: Path
    data: Path
    port: int
    env: dict[str, str]

    @classmethod
    def make(cls, work: Path) -> MacBox:
        with socket.socket() as sk:
            sk.bind(("127.0.0.1", 0))
            port = int(sk.getsockname()[1])
        _stand_ins(work / "bin", work / "fake_app_server.py")
        (work / "fake_app_server.py").write_text(FAKE_SERVER, encoding="utf-8")
        data = work / "data"
        env = {"PATH": f"{work / 'bin'}{os.pathsep}{os.environ.get('PATH', '/usr/bin:/bin')}", "E2E_PORT": str(port),
               "E2E_DATA": str(data), "E2E_DITTO_LOG": str(work / "ditto.log"), "E2E_OPEN_LOG": str(work / "open.log"),
               "HEALTH_TIMEOUT_S": "6"}
        return cls(work / "Applications", data, port, env)

    def run(self, cmd: Sequence[str], **env: str) -> int:
        return subprocess.run(list(cmd), env={**self.env, **env}, timeout=180, check=False).returncode

    def stop(self) -> None:
        subprocess.run(["sh", str(APP_SCRIPTS / "stop.sh")], env={**self.env, "RESEARCHOS_DATA_DIR": str(self.data)},
                       capture_output=True, check=False)


def _waited(log: str) -> int:
    """Seconds the rollback waited for API + worker to exit (the last "stopped after" line of update.log)."""
    found = re.findall(r"API and worker stopped after (\d+) s", log)
    return int(found[-1]) if found else -1


def _last(log: str) -> str:
    return (log.splitlines() or ["update.log empty"])[-1]


def mac_run(work: Path, signer: Signer, mode: str) -> list[Step]:
    """Install the fake 0.0.0 app, start it, publish the new zip, click through check -> download -> install, run
    the captured apply_update.sh hand-over and look at the result. Modes: signed | tampered | rollback (the new app
    never answers) | rollback-slow (it answers with the wrong version and takes 3 s to exit: the restore must wait
    for it and health-check the old version) | zip-swapped (the verified zip replaced after the download, same
    version, one extra file) | no-digest (no sha256 argument): both must refuse before unpacking | rollback-mv-fail
    / swap-mv-fail (a move fails, MV_FAIL): the log must not claim a restore, nothing is opened and the recovery dirs
    stay (ADR-270)."""
    box = MacBox.make(work)
    app = fake_app(box.apps, SIMULATED_INSTALLED)
    box.run(["open", str(app)])
    calls: list[list[str]] = []
    try:
        if _wait_health(box.port, SIMULATED_INSTALLED) != SIMULATED_INSTALLED:
            return [step("the installed fake app answers", False, "no answer")]
        version = __version__
        marker = {"rollback": "BROKEN", "rollback-slow": "SLOW_EXIT", "rollback-mv-fail": "BROKEN"}.get(mode, "")
        z = mac_zip(work, version, marker=marker)
        root = work / "srv"
        exe = root / "download" / f"v{version}" / asset_name(version)
        exe.parent.mkdir(parents=True)
        exe.write_bytes(FAKE_INSTALLER)
        shutil.move(z, exe.parent / z.name)
        with serve(root) as base:
            feed_url, dl = f"{base}/latest.json", f"{base}/download/v{version}/"
            meta = write_release(exe, version, "mac e2e", url=dl + exe.name, feed_url=feed_url, out_dir=root,
                                 key=signer.key, trusted=signer.trusted, mac={MAC: (exe.parent / z.name, dl + z.name)})
            if mode == "tampered":
                platforms = meta["platforms"]
                assert isinstance(platforms, dict)
                bad = {**meta, "platforms": {MAC: {**platforms[MAC], "sha256": TAMPERED_SHA256}}}
                raw, sig = signed(bad, signer.key, feed_url, signer.trusted)
                (root / "latest.json").write_bytes(raw)
                (root / "latest.json.sig").write_bytes(sig)
            s = Settings(data_dir=box.data, update_feed_url=feed_url, update_timeout_s=5.0, port=box.port)
            up = Updater(s, download_dir=work / "download", platform=MAC, trusted_keys=signer.trusted,
                         app_root=app / "Contents" / "Resources" / "app",
                         spawn=lambda cmd, env: calls.append(list(cmd)))
            steps = check_and_download(up)
        if mode == "tampered":
            code = (up.status()["error"] or {}).get("code")
            return [*steps, step("zip download -> update_checksum_mismatch", code == "update_checksum_mismatch",
                                  f"error={code}"),
                    step("the installed app is untouched and still answers",
                          _version_of(app) == SIMULATED_INSTALLED and _health(box.port) == SIMULATED_INSTALLED,
                          f"app={_version_of(app)}")]
        ready = up.status()["state"] == "ready" and up.installer is not None and up.installer.name == z.name
        steps.append(step("zip download -> sha256 verified -> ready", ready, f"state={up.status()['state']}"))
        up.install()
        if not calls:
            return [*steps, step("install hands over to apply_update.sh", False, "no helper started")]
        # in the app the updater runs inside the server (the helper waits for os.getpid()); here the fake server is it
        cmd = [*calls[0][:4], (box.data / "run" / "api.pid").read_text().strip(), *calls[0][5:]]
        if mode == "zip-swapped":
            swapped = mac_zip(work / "swap", version)
            with zipfile.ZipFile(swapped, "a") as zf:
                zf.writestr("ResearchOS.app/Contents/Resources/app/EVIL", "not in the signed zip\n")
            shutil.move(swapped, up.installer)
        if mode == "no-digest":
            cmd = cmd[:-1]
        rc = box.run(cmd, E2E_MV_FAIL=MV_FAIL.get(mode, ""))  # the helper, run here in the foreground
        log = (s.logs_dir / "update.log").read_text(encoding="utf-8") if (s.logs_dir / "update.log").is_file() else ""
        leftovers = sorted(p.name for p in box.apps.iterdir() if p.name != "ResearchOS.app")
        opened = (work / "open.log").read_text(encoding="utf-8").splitlines()  # [installed app, the helper's opens]
        if mode in MV_FAIL:
            rollback = mode == "rollback-mv-fail"
            kept = ["ResearchOS.app.failed" if rollback else f".ResearchOS-update-{version}", "ResearchOS.app.prev"]
            honest = all(claim not in log for claim in ("rolled back", "previous version restored", "nothing changed"))
            prev = _version_of(box.apps / "ResearchOS.app.prev")
            return [*steps, step("apply_update.sh -> a move fails -> exit 3", rc == 3, f"exit={rc}"),
                    step("update.log reports the real state, not a restore", honest and "by hand" in _last(log),
                          _last(log)),
                    # opened: the installed app, then (rollback only) the new app; never again after the failed move
                    step("nothing at the app path is opened after the failed move",
                          len(opened) == 1 + rollback and not app.exists(), f"open calls={len(opened)}"),
                    step("the recovery dirs are kept", leftovers == kept and prev == SIMULATED_INSTALLED,
                          ", ".join(leftovers))]
        if mode in ("zip-swapped", "no-digest"):
            seen = _wait_health(box.port, SIMULATED_INSTALLED)
            unpacked = (work / "ditto.log").is_file() or any(p.name == "EVIL" for p in box.apps.rglob("*"))
            why = "sha256" if mode == "zip-swapped" else "no valid sha256"
            return [*steps, step("apply_update.sh refuses before unpacking -> exit 1", rc == 1 and not unpacked,
                                  f"exit={rc} unpacked={unpacked}"),
                    step("the old app is intact and answering again",
                          _version_of(app) == SIMULATED_INSTALLED and seen == SIMULATED_INSTALLED and not leftovers,
                          f"app={_version_of(app)} health={seen} {', '.join(leftovers)}"),
                    step("update.log says why", why in _last(log) and "nothing changed" in _last(log), _last(log))]
        if mode == "signed":
            seen = _wait_health(box.port, version)
            return [*steps, step("apply_update.sh -> the new version answers", rc == 0 and seen == version,
                                  f"exit={rc} health={seen}"),
                    step("app replaced, .prev and the unpack folder removed",
                          _version_of(app) == version and not leftovers, ", ".join(leftovers) or "clean"),
                    step("update.log records the health check", "health check OK" in log, _last(log))]
        seen = _wait_health(box.port, SIMULATED_INSTALLED)
        return [*steps, step("apply_update.sh -> health check fails -> exit 2", rc == 2, f"exit={rc}"),
                step("previous app restored and answering",
                      _version_of(app) == SIMULATED_INSTALLED and seen == SIMULATED_INSTALLED, f"health={seen}"),
                step("the failed app kept as .failed, no .prev", leftovers == ["ResearchOS.app.failed"],
                      ", ".join(leftovers)),
                step("update.log records the rollback", "rolled back" in log, _last(log)),
                step("the restored version is health-checked",
                      f"health check after rollback OK: the previous version {SIMULATED_INSTALLED}" in log, _last(log)),
                *([step("the restore waits until the failed server has exited", _waited(log) >= 2,
                        f"waited {_waited(log)} s")] if mode == "rollback-slow" else [])]
    finally:
        box.stop()
