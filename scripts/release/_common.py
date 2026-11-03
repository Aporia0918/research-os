"""Shared helpers of the release scripts (ADR-225). The version is pyproject.toml's (ADR-222, read through
researchos.__version__); the GitHub owner/repo come from the default `Settings.update_feed_url` only."""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlsplit

from researchos import __version__
from researchos.kernel.config import Settings
from researchos.services.ops.update_feed import asset_name

ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIR = ROOT / "release"
# The update-signing private key lives outside the repo (ADR-228); scripts/release/keygen.py creates it.
SIGNING_KEY = Path(os.environ.get("RESEARCHOS_UPDATE_KEY")
                   or Path.home() / ".config" / "researchos" / "keys" / "update-release.pem")
FEED_URL: str = Settings.update_feed_url  # the dataclass default: https://github.com/<o>/<r>/releases/latest/...
_FEED_PATH = re.compile(r"^/([^/]+)/([^/]+)/releases/latest/download/latest\.json$")


def github_repo(feed_url: str = FEED_URL) -> str:
    """'<owner>/<repo>' of a GitHub 'latest release' feed URL."""
    u = urlsplit(feed_url)
    m = _FEED_PATH.match(u.path)
    if u.hostname != "github.com" or m is None:
        raise ValueError(f"not a GitHub latest-release feed URL: {feed_url}")
    return f"{m.group(1)}/{m.group(2)}"


def download_url(version: str, feed_url: str = FEED_URL, platform: str = "win32") -> str:
    """The URL GitHub serves a release asset under: .../releases/download/v<version>/<asset>."""
    return f"https://github.com/{github_repo(feed_url)}/releases/download/v{version}/{asset_name(version, platform)}"


def default_exe(version: str = __version__) -> Path:
    return RELEASE_DIR / asset_name(version)


def sha256_line(digest: str, name: str) -> str:
    """sha256sum format: '<hex>  <name>'."""
    return f"{digest}  {name}\n"


def json_bytes(data: Mapping[str, object]) -> bytes:
    """The published form of a JSON file (latest.json is signed over exactly these bytes)."""
    return (json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode("utf-8")


def write_json(data: Mapping[str, object], path: Path) -> Path:
    path.write_bytes(json_bytes(data))
    return path


def show(cmd: list[str]) -> str:
    return shlex.join(cmd)


def run(cmd: list[str], cwd: Path = ROOT) -> str:
    """Run a command (no shell), fail loudly, return its stdout."""
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
