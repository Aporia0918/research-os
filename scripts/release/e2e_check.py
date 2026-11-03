"""Local end-to-end check of the one-click update (ADR-223/225/228), offline: an http.server on 127.0.0.1 (random
port) serves latest.json (+ latest.json.sig) and the installer laid out like a GitHub release, Settings.update_feed_url
points at it, and the real Updater runs, trusting only an ephemeral test key generated for this run:
  signed            check -> available, download -> sha256 verified -> ready
  unsigned          no latest.json.sig -> update_unsigned
  tampered-signature  feed bytes changed after signing -> update_bad_signature
  tampered-sha256   signed feed with a wrong sha256 -> update_checksum_mismatch, download deleted
  mirror-down       mirror prefix unreachable -> update_mirror_failed; the owner's retry without it -> available
  truncated         the server announces the full installer, sends half and closes -> update_incomplete, deleted
  asset-missing     signed feed names a newer version whose installer answers 404 -> update_asset_missing
  racing-clicks     two download clicks at once (slow server) -> one download, the other update_busy -> ready
(disk full on the .part file is a unit test only: tests/test_update_hardening.py)
Mac (ADR-267, e2e_mac.py: a fake .app, the real Updater and the real apply_update.sh, ditto/open stand-ins):
  mac-signed        darwin-arm64 zip downloaded + verified -> the app swapped -> the new version answers
  mac-tampered      signed feed with a wrong zip sha256 -> update_checksum_mismatch, the app untouched
  mac-rollback      the new app never answers -> previous app restored and answering, the new one kept as .failed
  mac-rollback-slow the new app answers unhealthy and exits 3 s after SIGTERM -> the restore waits, then the old
                    version is health-checked and answers
  mac-rollback-mv-fail  moving .prev back fails -> exit 3, no "restored" claim, nothing opened, .prev + .failed kept
  mac-swap-mv-fail  moving the new app in and the recovery move both fail -> exit 3, .prev + the unpack dir kept
  mac-zip-swapped   the verified zip is replaced after the download -> sha256 re-check refuses, nothing unpacked
  mac-no-digest     the helper gets no sha256 -> refuses, nothing unpacked, the old app answers again
The running copy is presented as version 0.0.0 (the updater only offers newer versions). The Windows install step
(silent setup) replaces the installed copy and is always reported as NOT RUN; the Mac steps run on any POSIX box
(macOS NOT RUN: ditto/open are stand-ins).

Usage: python scripts/release/e2e_check.py [--exe release/ResearchOS-Setup-<v>.exe]   (default: small fake installer)
Exit 0 = PASS."""

from __future__ import annotations

import argparse
import re
import shutil
import socket
import sys
import tempfile
import threading
from collections.abc import Callable
from functools import partial
from pathlib import Path
from unittest.mock import patch

from researchos import __version__
from researchos.kernel.backup import file_sha256
from researchos.kernel.config import Settings
from researchos.services.ops import updater
from researchos.services.ops.update_feed import UpdateError, asset_name
from researchos.services.ops.updater import Updater

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_common import (  # noqa: E402
    DOWNLOAD_TIMEOUT_S,
    FAKE_INSTALLER,
    SIMULATED_INSTALLED,
    TAMPERED_SHA256,
    Faults,
    Signer,
    Step,
    check_and_download,
    serve,
    step,
)
from e2e_mac import mac_run  # noqa: E402
from manifest import signed, write_release  # noqa: E402

_ASSET = re.compile(r"^ResearchOS-Setup-(.+)\.exe$")

def publish_local(root: Path, base: str, installer: Path, version: str, signer: Signer, *, mode: str = "signed") -> str:
    """<root>/download/v<v>/<asset> + <root>/latest.json(.sig) written by the release manifest builder, then altered
    per `mode` (signed | unsigned | tampered-signature | tampered-sha256 | asset-missing); returns the feed URL."""
    exe = root / "download" / f"v{version}" / asset_name(version)
    exe.parent.mkdir(parents=True)
    shutil.copyfile(installer, exe)  # a copy: the release file itself is only read
    feed_url = f"{base}/latest.json"
    meta = write_release(exe, version, "local release e2e check", url=f"{base}/download/v{version}/{exe.name}",
                         feed_url=feed_url, out_dir=root, key=signer.key, trusted=signer.trusted)
    feed, sig = root / "latest.json", root / "latest.json.sig"
    if mode == "unsigned":
        sig.unlink()
    elif mode == "tampered-signature":
        feed.write_bytes(feed.read_bytes().replace(b"local release e2e check", b"local release e2e CHECK"))
    elif mode == "asset-missing":
        exe.unlink()
    elif mode == "tampered-sha256":
        raw, s = signed({**meta, "sha256": TAMPERED_SHA256}, signer.key, feed_url, signer.trusted)
        feed.write_bytes(raw)
        sig.write_bytes(s)
    return feed_url


def _updater(feed_url: str, work: Path, signer: Signer, mirror: str = "") -> Updater:
    s = Settings(data_dir=work / "data", update_feed_url=feed_url, update_mirror_prefix=mirror, update_timeout_s=5.0)
    return Updater(s, download_dir=work / "download", trusted_keys=signer.trusted)


def refused(up: Updater, code: str) -> list[Step]:
    try:
        st = up.check()
    except UpdateError as e:
        return [step(f"check -> {code}", e.code == code, f"error={e.code}")]
    return [step(f"check -> {code}", False, f"state={st['state']}")]


def mirror_down_run(up: Updater) -> list[Step]:
    steps = refused(up, "update_mirror_failed")
    st = up.check(direct=True)
    return [*steps, step("retry without the mirror -> available", st["state"] == "available", f"state={st['state']}")]


def good_run(up: Updater, digest: str) -> list[Step]:
    steps = check_and_download(up)
    st = up.status()
    ok = st["state"] == "ready" and up.installer is not None and file_sha256(up.installer) == digest
    return [*steps, step("download -> sha256 verified -> ready", ok, f"state={st['state']} {st['progress']}")]


def tampered_run(up: Updater) -> list[Step]:
    steps = check_and_download(up)
    code = (up.status()["error"] or {}).get("code")
    left = sorted(p.name for p in up.download_dir.glob("*"))
    return [*steps, step("download -> update_checksum_mismatch", code == "update_checksum_mismatch",
                          f"error={code}"),
            step("installer deleted", not left, ", ".join(left) or "download dir empty")]


def failed_download_run(up: Updater, code: str) -> list[Step]:
    steps = check_and_download(up)
    got = (up.status()["error"] or {}).get("code")
    left = sorted(p.name for p in up.download_dir.glob("*"))
    return [*steps, step(f"download -> {code}", got == code, f"error={got}"),
            step("nothing left in the download dir", not left, ", ".join(left) or "download dir empty")]


def racing_clicks_run(up: Updater) -> list[Step]:
    st = up.check()
    gate, results = threading.Barrier(2), []

    def click() -> None:
        gate.wait()
        try:
            results.append(up.start_download()["state"])
        except UpdateError as e:
            results.append(e.code)

    clicks = [threading.Thread(target=click) for _ in range(2)]
    for t in clicks:
        t.start()
    for t in clicks:
        t.join(DOWNLOAD_TIMEOUT_S)
    up.wait(DOWNLOAD_TIMEOUT_S)
    final = up.status()["state"]
    return [step("check -> available", st["state"] == "available", f"state={st['state']}"),
            step("two clicks -> one download + update_busy", sorted(results) == ["downloading", "update_busy"],
                  ", ".join(sorted(results))),
            step("the one download -> ready", final == "ready", f"state={final}")]


def _scenario(name: str, body: Callable[[], list[Step]]) -> list[Step]:
    try:
        return [Step(f"{name}: {s.name}", s.status, s.detail) for s in body()]
    except UpdateError as e:
        return [Step(name, "FAIL", f"{e.code}: {e.message}")]


def _closed_port_url() -> str:
    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{sk.getsockname()[1]}/mirror/"


def run(installer: Path | None, work: Path) -> list[Step]:
    """All steps against `installer` (None = a small fake one); `work` is an empty scratch directory."""
    if installer is None:
        installer, version = work / "fake-setup.exe", __version__
        installer.write_bytes(FAKE_INSTALLER)
    else:
        m = _ASSET.match(installer.name)
        if m is None:
            return [Step("installer name", "FAIL", f"{installer.name} is not ResearchOS-Setup-<version>.exe")]
        version = m.group(1)
    digest, signer = file_sha256(installer), Signer.ephemeral()
    size = installer.stat().st_size
    scenarios: dict[str, tuple[str, Callable[[Updater], list[Step]], str, Faults]] = {
        "signed": ("signed", lambda up: good_run(up, digest), "", Faults()),
        "unsigned": ("unsigned", lambda up: refused(up, "update_unsigned"), "", Faults()),
        "tampered-signature": ("tampered-signature", lambda up: refused(up, "update_bad_signature"), "", Faults()),
        "tampered-sha256": ("tampered-sha256", tampered_run, "", Faults()),
        "mirror-down": ("signed", mirror_down_run, _closed_port_url(), Faults()),
        "truncated": ("signed", lambda up: failed_download_run(up, "update_incomplete"), "",
                      Faults(cut_after=size // 2)),
        "asset-missing": ("asset-missing", lambda up: failed_download_run(up, "update_asset_missing"), "", Faults()),
        "racing-clicks": ("signed", racing_clicks_run, "", Faults(delay_s=0.5)),
    }
    steps: list[Step] = []
    with patch.object(updater, "__version__", SIMULATED_INSTALLED):
        for name, (mode, body, mirror, faults) in scenarios.items():
            with serve(work / f"srv-{name}", faults) as base:
                feed = publish_local(work / f"srv-{name}", base, installer, version, signer, mode=mode)
                steps += _scenario(name, partial(body, _updater(feed, work / name, signer, mirror)))
        for mode in ("signed", "tampered", "rollback", "rollback-slow", "rollback-mv-fail", "swap-mv-fail",
                     "zip-swapped", "no-digest"):
            steps += _scenario(f"mac-{mode}", partial(mac_run, work / f"mac-{mode}", signer, mode))
    install = Step("install (silent setup hand-off)", "NOT RUN",
                   f"Windows-only and replaces the installed copy; platform here: {sys.platform}")
    return [*steps, install]


def report(steps: list[Step]) -> bool:
    for s in steps:
        print(f"{s.status:8} {s.name}  [{s.detail}]")
    failed = [s for s in steps if s.status == "FAIL"]
    passed = sum(s.status == "PASS" for s in steps)
    not_run = sum(s.status == "NOT RUN" for s in steps)
    print(f"RESULT: {'FAIL' if failed else 'PASS'} ({passed} passed, {len(failed)} failed, {not_run} not run)")
    return not failed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exe", type=Path, help="real installer; default: a small fake file")
    args = ap.parse_args(argv)
    if args.exe is not None and not args.exe.is_file():
        print(f"e2e_check: {args.exe} not found", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="ros-release-e2e-") as td:
        print(f"simulated installed version {SIMULATED_INSTALLED}; installer: {args.exe or 'fake'}")
        return 0 if report(run(args.exe, Path(td))) else 1


if __name__ == "__main__":
    sys.exit(main())
