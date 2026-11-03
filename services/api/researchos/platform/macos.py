"""macOS install conventions (ADR-263). Pure path functions: tested on Linux with a fake home; macOS NOT RUN.

A bundled install is `<X>.app/Contents/Resources/app` (scripts/build_mac_app.py). Its data and logs live outside the
bundle, so replacing the .app on update keeps them: `~/Library/Application Support/ResearchOS` and
`~/Library/Logs/ResearchOS`. A dev checkout on a Mac keeps `<repo>/data` like Linux.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

APP_NAME = "ResearchOS"


@dataclass(frozen=True)
class UserDirs:
    data: Path
    logs: Path


def app_bundle(app_root: Path) -> Path | None:
    """The `.app` directory when `app_root` is `<X>.app/Contents/Resources/app`, else None."""
    resources = app_root.parent
    contents = resources.parent
    if (app_root.name, resources.name, contents.name) == ("app", "Resources", "Contents") \
            and contents.parent.suffix == ".app":
        return contents.parent
    return None


def user_dirs(home: Path) -> UserDirs:
    return UserDirs(data=home / "Library" / "Application Support" / APP_NAME, logs=home / "Library" / "Logs" / APP_NAME)


def bundled_dirs(app_root: Path, home: Path, platform: str = sys.platform) -> UserDirs | None:
    """Data/log dirs of a bundled Mac install; None for a dev checkout or another OS."""
    return user_dirs(home) if platform == "darwin" and app_bundle(app_root) is not None else None


def updatable_bundle(app_root: Path) -> Path | None:
    """The `.app` the updater may replace in place: a bundled install whose folder is writable and that is not
    running from a mounted disk image (/Volumes) or a Gatekeeper-translocated copy (…/AppTranslocation/…); else None
    (`update_unsupported`: the owner drags the new version into Applications by hand)."""
    app = app_bundle(app_root)
    if app is None or "AppTranslocation" in app.parts or app.parts[1:2] == ("Volumes",):
        return None
    return app if os.access(app.parent, os.W_OK) else None
