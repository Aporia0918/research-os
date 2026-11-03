r"""One-click update (ADR-223/228/267): check -> download + sha256 verify -> hand-over to a helper after the app exits.

Nothing here runs unless the owner clicks: there is no startup or background check. The feed is the signed
`latest.json` asset of the latest GitHub release (update_feed: fields, signature, platforms, codes); an optional mirror
prefix (e.g. https://ghfast.top/) is prepended to the feed and the download URL, and a click may retry once without
it. The update (Windows installer or Mac app zip) is downloaded to a temp folder, hashed while streaming and kept only
if it is complete and the sha256 matches. Installing starts a detached helper copied next to the download: on Windows
(installed copy only) scripts/apply_update.ps1 stops the app, waits for this process to exit, runs
`ResearchOS-Setup-<v>.exe /S /RUNAFTER` and checks the new version's health (setup keeps data\ and restores the
previous app\ on failure); on a Mac (a writable, not translocated .app) scripts/apply_update.sh swaps the .app
(previous kept as .app.prev until the new version answers its health check, else restored). The release notes are
kept for a one-time "What's new" after the update. Every failure is an UpdateError with a stable code.
"""
from __future__ import annotations

import errno
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx

from ... import __version__
from ...kernel.backup import file_sha256
from ...kernel.config import REPO_ROOT, Settings
from ...platform import IS_WINDOWS
from ...platform.env import child_env
from ...platform.macos import updatable_bundle
from ...platform.process import detached_kwargs
from .update_feed import (
    MAC_ARCHES,
    MAX_FEED_BYTES,
    Release,
    UpdateError,
    current_platform,
    is_newer,
    parse_release,
    signature_url,
    validate_mirror,
)
from .update_signing import MAX_SIG_BYTES, TRUSTED_KEYS

MAX_INSTALLER_BYTES = 1024 * 1024 * 1024
MAX_REDIRECTS = 5  # GitHub release assets redirect once (to the object store); a mirror may add one or two
_CUT_OFF = (httpx.RemoteProtocolError, httpx.ReadError)  # server closed / connection dropped mid-body


def install_dir(app_root: Path = REPO_ROOT) -> Path | None:
    """<dir> of a setup-made install (<dir>\\app is the app root, <dir>\\Uninstall.exe exists), else None."""
    return app_root.parent if app_root.name == "app" and (app_root.parent / "Uninstall.exe").is_file() else None


Spawner = Callable[[Sequence[str], dict[str, str]], None]


def _spawn_detached(cmd: Sequence[str], env: dict[str, str]) -> None:
    """Own process group / session (hidden, outside any job of this process on Windows), so it outlives the server
    it stops."""
    kw: dict[str, Any] = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                          "close_fds": True, "env": env}
    try:
        subprocess.Popen(list(cmd), **kw, **detached_kwargs(breakaway=True))
    except OSError:
        if not IS_WINDOWS:
            raise
        subprocess.Popen(list(cmd), **kw, **detached_kwargs())  # the job forbids breakaway


class Updater:
    """Owner-triggered update state machine: idle -> checking -> up_to_date | available -> downloading -> ready
    -> installing; any step may end in `error` (the current install is untouched)."""

    def __init__(self, settings: Settings, *, download_dir: Path | None = None, platform: str = current_platform(),
                 app_root: Path = REPO_ROOT, spawn: Spawner = _spawn_detached,
                 transport: httpx.BaseTransport | None = None, trusted_keys: Mapping[str, str] = TRUSTED_KEYS) -> None:
        self.s = settings
        self.download_dir = download_dir or Path(tempfile.gettempdir()) / "ResearchOS-update"
        self.platform, self.app_root, self.spawn, self.transport = platform, app_root, spawn, transport
        self.trusted_keys = trusted_keys
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.state = "idle"
        self.release: Release | None = None
        self.received, self.total = 0, 0
        self.error: UpdateError | None = None
        self.installer: Path | None = None

    # ---- settings (mirror prefix: UI choice in <data>/config/update.json wins over researchos.toml) ----
    @property
    def _prefs(self) -> Path:
        return self.s.config_dir / "update.json"

    @property
    def _whats_new(self) -> Path:
        return self.s.config_dir / "whats_new.json"

    def mirror_prefix(self) -> str:
        try:
            return str(json.loads(self._prefs.read_text(encoding="utf-8"))["mirror_prefix"])
        except (OSError, ValueError, KeyError):
            return self.s.update_mirror_prefix

    def set_mirror_prefix(self, prefix: str) -> None:
        prefix = validate_mirror(prefix)
        self._prefs.parent.mkdir(parents=True, exist_ok=True)
        self._prefs.write_text(json.dumps({"mirror_prefix": prefix}), encoding="utf-8")

    def _prefix(self, direct: bool) -> str:
        """The mirror prefix in use ('' = direct): `direct` is the owner's "retry without the mirror" click."""
        return "" if direct else validate_mirror(self.mirror_prefix())

    def _client(self) -> httpx.Client:
        t = self.s.update_timeout_s
        return httpx.Client(transport=self.transport, timeout=httpx.Timeout(t, connect=min(t, 10.0)),
                            follow_redirects=False, trust_env=False,  # followed by `_get` (Review #96)
                            headers={"user-agent": f"ResearchOS-Updater/{__version__}"})

    # ---- public API (called by the HTTP layer) ----
    def status(self) -> dict[str, Any]:
        with self._lock:
            return self._status_unlocked()

    def _status_unlocked(self) -> dict[str, Any]:
        return {
            "current_version": __version__, "state": self.state,
            "latest": asdict(self.release) if self.release else None,
            "progress": {"received": self.received, "total": self.total} if self.state in (
                "downloading", "ready", "installing") else None,
            "error": {"code": self.error.code, "message": self.error.message} if self.error else None,
            "mirror_prefix": self.mirror_prefix(), "feed_url": self.s.update_feed_url,
            "can_install": self._install_target() is not None, "auto_check": False,
            "installer": str(self.installer) if self.installer and self.state in ("ready", "installing") else None,
            "whats_new": self.whats_new(),
        }

    def check(self, *, direct: bool = False) -> dict[str, Any]:
        with self._lock:
            if self.state == "downloading":
                raise UpdateError("update_busy")
            self.state, self.error = "checking", None
        try:
            raw, sig = self._get_feed(self._prefix(direct))
            rel = parse_release(raw, self.s.update_feed_url, sig, self.trusted_keys, self.platform)
        except UpdateError as e:
            self._fail(e)
            raise
        with self._lock:
            self.release = rel
            self.state = "available" if is_newer(rel.version, __version__) else "up_to_date"
            self.installer = self._verified_installer(rel)
            if self.state == "available" and self.installer:
                self.state = "ready"
        return self.status()

    def start_download(self, *, direct: bool = False) -> dict[str, Any]:
        prefix = self._prefix(direct)
        with self._lock:
            if self.state == "downloading":
                raise UpdateError("update_busy")
            if self.state == "ready":
                return self._status_unlocked()
            if self.state not in ("available", "error") or self.release is None or not is_newer(
                    self.release.version, __version__):
                raise UpdateError("update_not_available")
            self.state, self.error, self.received, self.total = "downloading", None, 0, 0
            self._thread = threading.Thread(target=self._download_safe, args=(self.release, prefix), daemon=True,
                                            name="update-download")
            self._thread.start()
            return self._status_unlocked()

    def wait(self, timeout: float | None = None) -> None:
        """Tests: wait for a running download to finish."""
        if self._thread:
            self._thread.join(timeout)

    def install(self) -> dict[str, Any]:
        with self._lock:
            if self.state != "ready" or self.installer is None or self.release is None:
                raise UpdateError("update_not_ready")
            target = self._install_target()
            if target is None:
                raise UpdateError("update_unsupported")
            installer, rel = self.installer, self.release
        try:
            cmd = self._helper(installer, target, rel)
            self._save_whats_new(rel)
            self.spawn(cmd, child_env(self.s.data_dir / "home"))  # no provider keys in the helper or setup
        except OSError as e:
            raise UpdateError("update_launch_failed", type(e).__name__) from e
        with self._lock:
            self.state = "installing"
        return self.status()

    # ---- "What's new": the notes of the installed update, shown once (the web dismisses it) ----
    def whats_new(self) -> dict[str, str] | None:
        try:
            d = json.loads(self._whats_new.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(d, dict) or d.get("version") != __version__:
            return None  # not (yet) running the version the notes belong to
        return {k: str(d.get(k) or "") for k in ("version", "notes", "notes_zh")}

    def dismiss_whats_new(self) -> dict[str, Any]:
        self._whats_new.unlink(missing_ok=True)
        return self.status()

    def _save_whats_new(self, rel: Release) -> None:
        self._whats_new.parent.mkdir(parents=True, exist_ok=True)
        self._whats_new.write_text(json.dumps({"version": rel.version, "notes": rel.notes,
                                               "notes_zh": rel.notes_zh}), encoding="utf-8")

    # ---- internals ----
    def _health_url(self) -> str:
        """Where apply_update.ps1 waits for the new version (this server's own loopback address)."""
        return f"{'https' if self.s.tls_enabled else 'http'}://127.0.0.1:{self.s.port}/api/v1/health"

    def _install_target(self) -> Path | None:
        """Windows: the setup-made install dir; Mac: the replaceable .app (ADR-267); else None."""
        if self.platform == "win32":
            return install_dir(self.app_root)
        return updatable_bundle(self.app_root) if self.platform in MAC_ARCHES else None

    def _helper(self, download: Path, target: Path, rel: Release) -> list[str]:
        """Copy the platform's update helper next to the verified download; returns the command that runs it. The Mac
        helper gets the signed feed's sha256 and checks the zip again right before unpacking it (ADR-270)."""
        version = rel.version
        if self.platform == "win32":
            helper = download.parent / "apply_update.ps1"
            shutil.copyfile(self.app_root / "scripts" / "apply_update.ps1", helper)
            return ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
                    "-ExecutionPolicy", "Bypass", "-File", str(helper), "-Installer", str(download),
                    "-InstallDir", str(target), "-ServerPid", str(os.getpid()), "-Version", version,
                    "-HealthUrl", self._health_url()]
        helper = download.parent / "apply_update.sh"
        shutil.copyfile(self.app_root / "scripts" / "apply_update.sh", helper)
        return ["/bin/sh", str(helper), str(download), str(target), str(os.getpid()), version, self._health_url(),
                str(self.s.data_dir), str(self.s.logs_dir / "update.log"), rel.sha256]

    def _fail(self, e: UpdateError) -> None:
        with self._lock:
            self.state, self.error = "error", e

    def _get_feed(self, prefix: str) -> tuple[bytes, bytes | None]:
        """latest.json and its detached signature (None if the release has none)."""
        feed = self.s.update_feed_url
        with self._client() as c, _mapped(prefix):
            status, body = _bounded(c, prefix + feed, MAX_FEED_BYTES, "update_bad_metadata")
            if status != 200:
                raise UpdateError("update_mirror_failed" if prefix else "update_http_error", str(status))
            sig_status, sig = _bounded(c, prefix + signature_url(feed), MAX_SIG_BYTES, "update_unsigned")
            if sig_status not in (200, 404):
                raise UpdateError("update_mirror_failed" if prefix else "update_http_error", str(sig_status))
            return body, sig if sig_status == 200 else None

    def _target(self, rel: Release) -> Path:
        return self.download_dir / rel.asset

    def _verified_installer(self, rel: Release) -> Path | None:
        """A previously downloaded installer is reused only if its hash still matches."""
        p = self._target(rel)
        return p if p.is_file() and file_sha256(p) == rel.sha256 else None

    def _download_safe(self, rel: Release, prefix: str) -> None:
        try:
            path = self._download(rel, prefix)
        except UpdateError as e:
            self._fail(e)
            return
        with self._lock:
            self.installer, self.state = path, "ready"

    def _download(self, rel: Release, prefix: str) -> Path:
        part = self._target(rel).with_suffix(".part")
        h = hashlib.sha256()
        try:
            with _saving(), self._client() as c, _mapped(prefix), _get(c, prefix + rel.url) as r:
                if r.status_code != 200:
                    code = "update_mirror_failed" if prefix else (
                        "update_asset_missing" if r.status_code == 404 else "update_http_error")
                    raise UpdateError(code, str(r.status_code))
                with self._lock:
                    self.total = int(r.headers.get("content-length") or 0)
                self.download_dir.mkdir(parents=True, exist_ok=True)
                with part.open("wb") as fh:
                    for chunk in _body(r):
                        fh.write(chunk)
                        h.update(chunk)
                        with self._lock:
                            self.received += len(chunk)
                        if self.received > MAX_INSTALLER_BYTES:
                            raise UpdateError("update_bad_metadata", "installer too large")
            if self.total and self.received != self.total:
                raise UpdateError("update_incomplete", f"{self.received}/{self.total}")
            if h.hexdigest() != rel.sha256:
                raise UpdateError("update_checksum_mismatch")
            return part.replace(self._target(rel))
        finally:
            part.unlink(missing_ok=True)


def _bounded(c: httpx.Client, url: str, limit: int, code: str) -> tuple[int, bytes]:
    """(status, body) of a small response, streamed: more than `limit` bytes (announced or received) stops reading
    at once with `code`, so an oversized feed or signature never sits in memory (Review #95). Error bodies are not
    read."""
    with _get(c, url) as r:
        if r.status_code != 200:
            return r.status_code, b""
        if int(r.headers.get("content-length") or 0) > limit:
            raise UpdateError(code, "too large")
        buf = bytearray()
        for chunk in r.iter_bytes(1 << 14):
            buf += chunk
            if len(buf) > limit:
                raise UpdateError(code, "too large")
        return r.status_code, bytes(buf)


@contextmanager
def _get(c: httpx.Client, url: str) -> Iterator[httpx.Response]:
    """The streamed response of GET `url` after at most MAX_REDIRECTS redirects, followed here: httpx's own
    following reads each redirect body whole before the caller's byte limits apply (Review #96), so every redirect
    response is closed unread. More redirects raise `httpx.TooManyRedirects` (mapped by `_mapped`)."""
    req = c.build_request("GET", url)
    for _ in range(MAX_REDIRECTS + 1):
        r = c.send(req, stream=True, follow_redirects=False)
        nxt = r.next_request
        if nxt is None:
            try:
                yield r
            finally:
                r.close()
            return
        r.close()
        req = nxt
    raise httpx.TooManyRedirects("too many redirects", request=req)


def _body(r: httpx.Response) -> Iterator[bytes]:
    """The response body; a connection cut mid-body is `update_incomplete` (not a generic network error)."""
    try:
        yield from r.iter_bytes(1 << 16)
    except _CUT_OFF as e:
        raise UpdateError("update_incomplete", type(e).__name__) from e


@contextmanager
def _saving() -> Iterator[None]:
    """Local file errors while saving the download (the .part file is removed by the caller)."""
    try:
        yield
    except OSError as e:
        raise UpdateError("update_disk_full" if e.errno == errno.ENOSPC else "update_write_failed",
                          type(e).__name__) from e


@contextmanager
def _mapped(prefix: str = "") -> Iterator[None]:
    """Map httpx failures to stable codes (no URL or proxy text reaches the client); through a mirror every
    transport failure is `update_mirror_failed`, so the owner can retry without it."""
    try:
        yield
    except httpx.TimeoutException as e:
        raise UpdateError("update_mirror_failed" if prefix else "update_timeout", type(e).__name__) from e
    except httpx.HTTPError as e:
        raise UpdateError("update_mirror_failed" if prefix else "update_network", type(e).__name__) from e
