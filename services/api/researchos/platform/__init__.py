"""Platform adapter (ARCHITECTURE §9). All OS-specific behaviour lives in this package.

Windows code paths are written against documented Win32 APIs but are NOT RUN on the dev box (Linux);
scripts/selftest.ps1 exercises them on the owner's machine. macOS paths (macos.py) are pure functions tested on Linux;
macOS NOT RUN.
"""
from __future__ import annotations

import sys

IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"
