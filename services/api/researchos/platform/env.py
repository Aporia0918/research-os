"""Process environment hygiene (HARDENING #5, #17).

- At process start the API/worker drop every inherited variable that is not on a small OS allowlist (after the
  keystore captured provider keys into memory), and point HOME/TEMP/config dirs into the app data dir.
- Child processes (experiments, tools) never inherit: they get `child_env()` = allowlist + explicit extras, and
  extras whose NAME looks like a credential are refused.
"""
from __future__ import annotations

import os
import re
from collections.abc import Mapping
from pathlib import Path

from . import IS_WINDOWS

OS_ALLOWLIST = frozenset({
    "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM",
    # GPU runtime selection is not a secret and is needed by CUDA children
    "CUDA_VISIBLE_DEVICES", "CUDA_PATH",
})
# Kept in the TRUSTED process only (read by the keystore / config loader), never passed to children.
TRUSTED_ONLY = re.compile(
    r"^(RESEARCHOS_.*|DEEPSEEK_API_KEY|ZHIPU_API_KEY|DASHSCOPE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)$"
)
SECRET_NAME = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)", re.IGNORECASE)


class UnsafeEnvError(ValueError):
    pass


def _redirects(home: Path) -> dict[str, str]:
    tmp = home / "tmp"
    home.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)
    out = {"HOME": str(home), "TEMP": str(tmp), "TMP": str(tmp), "TMPDIR": str(tmp),
           "XDG_CONFIG_HOME": str(home / ".config"), "XDG_CACHE_HOME": str(home / ".cache"),
           "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONNOUSERSITE": "1"}
    if IS_WINDOWS:
        out.update({"USERPROFILE": str(home), "APPDATA": str(home / "AppData"),
                    "LOCALAPPDATA": str(home / "LocalAppData")})
    return out


def scrub_process_env(home: Path, environ: dict[str, str] | None = None) -> list[str]:
    """Remove inherited variables except the OS allowlist and trusted-process config. Returns removed names
    (names only; values are never logged)."""
    env = os.environ if environ is None else environ
    removed = [k for k in list(env) if k.upper() not in OS_ALLOWLIST and not TRUSTED_ONLY.match(k.upper())]
    for k in removed:
        env.pop(k, None)
    env.update(_redirects(home))
    return sorted(removed)


def child_env(home: Path, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """Environment for a child process: allowlisted OS vars + redirects + explicit extras (no credentials)."""
    out = {k: v for k, v in os.environ.items() if k.upper() in OS_ALLOWLIST}
    out.update(_redirects(home))
    for k, v in (extra or {}).items():
        if SECRET_NAME.search(k) or TRUSTED_ONLY.match(k.upper()):
            raise UnsafeEnvError(f"refusing to pass credential-like variable {k!r} to a child process")
        out[k] = v
    return out


def assert_child_env_clean(env: Mapping[str, str]) -> None:
    bad = [k for k in env if TRUSTED_ONLY.match(k.upper()) or (SECRET_NAME.search(k) and k.upper() not in OS_ALLOWLIST)]
    if bad:
        raise UnsafeEnvError(f"credential-like variables in child env: {bad}")
