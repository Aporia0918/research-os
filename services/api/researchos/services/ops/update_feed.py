"""Update feed (ADR-223/228/266): the stable error codes, URL rules and the parser of `latest.json` = {version,
asset, sha256, url, notes, notes_zh?, platforms?}. A feed is accepted only after its detached Ed25519 signature (over
the whole file) verified (update_signing) and only if the top level names ResearchOS-Setup-<version>.exe, a sha256
and an https URL on the feed's own host. The top level is the Windows installer, exactly as 0.1.3/0.1.4 clients read
it; `platforms` (ignored by them) maps a platform key ("darwin-arm64", "darwin-x86_64") to {asset, sha256, url} under
the same rules. A Mac client reads only its own entry and never falls back to the .exe."""

from __future__ import annotations

import ipaddress
import json
import platform as _platform
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from packaging.version import InvalidVersion, Version

from .update_signing import TRUSTED_KEYS, SignatureError, verify

MAX_FEED_BYTES = 256 * 1024
MAX_NOTES_CHARS = 20000
SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Fixed messages per code; the UI maps the code (update.errors.<code>), never parses the text.
MESSAGES = {
    "update_network": "could not reach the update server",
    "update_timeout": "the update server did not answer in time",
    "update_http_error": "the update server returned an error",
    "update_bad_metadata": "the release metadata (latest.json) is invalid",
    "update_unsigned": "the release metadata is not signed; it was refused",
    "update_bad_signature": "the release metadata signature is not valid; it was refused",
    "update_checksum_mismatch": "the downloaded installer does not match its sha256; it was deleted",
    "update_incomplete": "the download stopped before it was complete; it was deleted, nothing was changed",
    "update_disk_full": "not enough disk space for the update download; nothing was changed",
    "update_write_failed": "the update download could not be saved; nothing was changed",
    "update_asset_missing": "the release does not offer its installer for download (yet)",
    "update_bad_mirror": "mirror prefix must be empty or an https:// URL ending with /",
    "update_mirror_failed": "the download mirror failed; try again without the mirror",
    "update_not_available": "check for updates first; no newer version is known",
    "update_busy": "an update download is already running",
    "update_not_ready": "download and verify the update first",
    "update_unsupported": "automatic install needs the Windows installed version; run the downloaded setup manually",
    "update_platform_missing": "this release has no update for this computer's platform (yet)",
    "update_launch_failed": "the installer could not be started; the current version is unchanged",
}
_SIGNATURE_CODES = {"unsigned": "update_unsigned", "bad_signature": "update_bad_signature"}


class UpdateError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(MESSAGES[code])
        self.code, self.message, self.detail = code, MESSAGES[code], detail


@dataclass(frozen=True)
class Release:
    version: str
    asset: str
    sha256: str
    url: str
    notes: str
    notes_zh: str = ""


def _local(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def allowed_url(url: str) -> bool:
    """https anywhere; plain http only to this machine (a local mirror or the tests' fake release server)."""
    u = urlsplit(url)
    return bool(u.hostname) and (u.scheme == "https" or (u.scheme == "http" and _local(u.hostname or "")))


def validate_mirror(prefix: str) -> str:
    prefix = prefix.strip()
    if prefix and not (prefix.endswith("/") and allowed_url(prefix) and len(prefix) <= 300):
        raise UpdateError("update_bad_mirror")
    return prefix


MAC_ARCHES = {"darwin-arm64": "arm64", "darwin-x86_64": "x86_64"}  # the feed's platform keys


def current_platform(sys_platform: str = sys.platform, machine: str = _platform.machine()) -> str:
    """"darwin-arm64" / "darwin-x86_64" on a Mac (by CPU), else `sys.platform` ("win32", "linux", ...)."""
    if sys_platform != "darwin":
        return sys_platform
    return "darwin-arm64" if machine in ("arm64", "aarch64") else "darwin-x86_64"


def asset_name(version: str, platform: str = "win32") -> str:
    """The update file name of a version for a platform: the Windows installer (build_package.py / the NSIS OUTFILE)
    or the Mac app zip (build_mac_app.py)."""
    arch = MAC_ARCHES.get(platform)
    return f"ResearchOS-{version}-mac-{arch}.zip" if arch else f"ResearchOS-Setup-{version}.exe"


def signature_url(feed_url: str) -> str:
    """The detached signature is published next to the feed: latest.json -> latest.json.sig."""
    return feed_url + ".sig"


def _notes(d: dict[str, object], key: str) -> str:
    return str(d.get(key) or "")[:MAX_NOTES_CHARS]


def _entry(d: dict[str, object], version: str, notes: tuple[str, str]) -> Release:
    """{asset, sha256, url} (the top level or a `platforms` entry) of `version`; a non-object raises TypeError."""
    return Release(version, str(d["asset"]), str(d["sha256"]).lower(), str(d["url"]), *notes)


def _check(rel: Release, feed_url: str, platform: str) -> None:
    u, feed = urlsplit(rel.url), urlsplit(feed_url)
    ok = (rel.asset == asset_name(rel.version, platform) and SHA256.match(rel.sha256) is not None
          and allowed_url(rel.url) and u.hostname == feed.hostname and u.path.endswith("/" + rel.asset))
    if not ok:
        raise UpdateError("update_bad_metadata", "fields")


def parse_release(raw: bytes, feed_url: str, signature: bytes | None,
                  trusted: Mapping[str, str] = TRUSTED_KEYS, platform: str = "win32") -> Release:
    """Verify the signature over the exact feed bytes, then validate the fields: the top level (the Windows
    installer) and every known `platforms` entry (unknown keys are left to later clients). A Mac platform key returns
    its entry, missing -> `update_platform_missing`; any other platform the top level."""
    try:
        verify(raw, signature, trusted)
    except SignatureError as e:
        raise UpdateError(_SIGNATURE_CODES[e.kind]) from e
    try:
        d = json.loads(raw.decode("utf-8"))
        version, notes = str(d["version"]), (_notes(d, "notes"), _notes(d, "notes_zh"))
        Version(version)
        platforms = d.get("platforms", {})
        if not isinstance(platforms, dict):
            raise TypeError("platforms")
        entries: dict[str, Release] = {"win32": _entry(d, version, notes)} | {
            k: _entry(v, version, notes) for k, v in platforms.items() if k in MAC_ARCHES}
    except (ValueError, KeyError, TypeError, InvalidVersion) as e:
        raise UpdateError("update_bad_metadata", type(e).__name__) from e
    for key, rel in entries.items():
        _check(rel, feed_url, key)
    if platform not in MAC_ARCHES:
        return entries["win32"]
    if platform not in entries:
        raise UpdateError("update_platform_missing", platform)
    return entries[platform]


def is_newer(latest: str, current: str) -> bool:
    return Version(latest) > Version(current)
