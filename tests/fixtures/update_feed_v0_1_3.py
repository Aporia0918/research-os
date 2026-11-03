# Frozen excerpt of services/api/researchos/services/ops/updater.py as shipped in 0.1.3 (commit 2400c6c "chore(release):
# version 0.1.3"; the 0.1.3 installer was built from it, see ADR-259/ADR-270). 0.1.3 has no update_feed.py and no
# signature check: its feed parser is parse_release() inside updater.py. Lines 38-120 are copied verbatim (constants,
# UpdateError, Release, URL rules, asset_name, parse_release, is_newer); only the imports are reduced to what those
# lines use. tests/test_update_platforms.py parses new multi-platform feeds with it: installed 0.1.3 clients must
# keep getting the Windows installer. Never edit.
"""0.1.3 update feed parser (ADR-223): latest.json = {version, asset, sha256, url, notes}."""

from __future__ import annotations

import ipaddress
import json
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from packaging.version import InvalidVersion, Version

MAX_FEED_BYTES = 256 * 1024
MAX_INSTALLER_BYTES = 1024 * 1024 * 1024
MAX_NOTES_CHARS = 20000
SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Fixed messages per code; the UI maps the code (update.errors.<code>), never parses the text.
MESSAGES = {
    "update_network": "could not reach the update server",
    "update_timeout": "the update server did not answer in time",
    "update_http_error": "the update server returned an error",
    "update_bad_metadata": "the release metadata (latest.json) is invalid",
    "update_checksum_mismatch": "the downloaded installer does not match its sha256; it was deleted",
    "update_bad_mirror": "mirror prefix must be empty or an https:// URL ending with /",
    "update_not_available": "check for updates first; no newer version is known",
    "update_busy": "an update download is already running",
    "update_not_ready": "download and verify the update first",
    "update_unsupported": "automatic install needs the Windows installed version; run the downloaded setup manually",
    "update_launch_failed": "the installer could not be started; the current version is unchanged",
}


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


def _local(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _allowed_url(url: str) -> bool:
    """https anywhere; plain http only to this machine (a local mirror or the tests' fake release server)."""
    u = urlsplit(url)
    return bool(u.hostname) and (u.scheme == "https" or (u.scheme == "http" and _local(u.hostname or "")))


def validate_mirror(prefix: str) -> str:
    prefix = prefix.strip()
    if prefix and not (prefix.endswith("/") and _allowed_url(prefix) and len(prefix) <= 300):
        raise UpdateError("update_bad_mirror")
    return prefix


def asset_name(version: str) -> str:
    """The installer file name for a version (build_package.py / the NSIS OUTFILE produce the same name)."""
    return f"ResearchOS-Setup-{version}.exe"


def parse_release(raw: bytes, feed_url: str) -> Release:
    """latest.json must name ResearchOS-Setup-<version>.exe, a sha256 and a URL on the feed's own host."""
    try:
        d = json.loads(raw.decode("utf-8"))
        rel = Release(str(d["version"]), str(d["asset"]), str(d["sha256"]).lower(), str(d["url"]),
                      str(d.get("notes") or "")[:MAX_NOTES_CHARS])
        Version(rel.version)
    except (ValueError, KeyError, TypeError, InvalidVersion) as e:
        raise UpdateError("update_bad_metadata", type(e).__name__) from e
    u, feed = urlsplit(rel.url), urlsplit(feed_url)
    ok = (rel.asset == asset_name(rel.version) and SHA256.match(rel.sha256) is not None
          and _allowed_url(rel.url) and u.hostname == feed.hostname and u.path.endswith("/" + rel.asset))
    if not ok:
        raise UpdateError("update_bad_metadata", "fields")
    return rel


def is_newer(latest: str, current: str) -> bool:
    return Version(latest) > Version(current)

