# Frozen copy of services/api/researchos/services/ops/update_feed.py as shipped in 0.1.4 (commit d9434ff, branch
# release/v0.1.4); only the relative update_signing import is made absolute. tests/test_update_platforms.py parses
# new multi-platform feeds with it: installed 0.1.4 clients must keep getting the Windows installer. Never edit.
"""Update feed (ADR-223/228): the stable error codes, URL rules and the parser of `latest.json` = {version, asset,
sha256, url, notes, notes_zh?}. A feed is accepted only after its detached Ed25519 signature verified (update_signing)
and only if it names ResearchOS-Setup-<version>.exe, a sha256 and an https URL on the feed's own host."""

from __future__ import annotations

import ipaddress
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from packaging.version import InvalidVersion, Version

from researchos.services.ops.update_signing import TRUSTED_KEYS, SignatureError, verify

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


def asset_name(version: str) -> str:
    """The installer file name for a version (build_package.py / the NSIS OUTFILE produce the same name)."""
    return f"ResearchOS-Setup-{version}.exe"


def signature_url(feed_url: str) -> str:
    """The detached signature is published next to the feed: latest.json -> latest.json.sig."""
    return feed_url + ".sig"


def _notes(d: dict[str, object], key: str) -> str:
    return str(d.get(key) or "")[:MAX_NOTES_CHARS]


def parse_release(raw: bytes, feed_url: str, signature: bytes | None,
                  trusted: Mapping[str, str] = TRUSTED_KEYS) -> Release:
    """Verify the signature over the exact feed bytes, then validate the fields."""
    try:
        verify(raw, signature, trusted)
    except SignatureError as e:
        raise UpdateError(_SIGNATURE_CODES[e.kind]) from e
    try:
        d = json.loads(raw.decode("utf-8"))
        rel = Release(str(d["version"]), str(d["asset"]), str(d["sha256"]).lower(), str(d["url"]),
                      _notes(d, "notes"), _notes(d, "notes_zh"))
        Version(rel.version)
    except (ValueError, KeyError, TypeError, InvalidVersion) as e:
        raise UpdateError("update_bad_metadata", type(e).__name__) from e
    u, feed = urlsplit(rel.url), urlsplit(feed_url)
    ok = (rel.asset == asset_name(rel.version) and SHA256.match(rel.sha256) is not None
          and allowed_url(rel.url) and u.hostname == feed.hostname and u.path.endswith("/" + rel.asset))
    if not ok:
        raise UpdateError("update_bad_metadata", "fields")
    return rel


def is_newer(latest: str, current: str) -> bool:
    return Version(latest) > Version(current)
