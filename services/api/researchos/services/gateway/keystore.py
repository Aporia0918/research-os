"""Provider API key storage. Backend-only; never returned to the frontend, never logged, never in git.

Lookup order: environment variable (e.g. DEEPSEEK_API_KEY) -> <data_dir>/config/secrets.env (written by the
Settings page or by hand). The secrets file lives in the data dir, outside the repo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from ...kernel.logsetup import register_secret

PROVIDER_ENV = {
    "deepseek": "DEEPSEEK_API_KEY",
    "zhipu": "ZHIPU_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "relay": "RESEARCHOS_RELAY_API_KEY",  # OpenAI-compatible relay (Settings.relay_base_url)
}


class SecretStore:
    def __init__(self, config_dir: Path):
        self.path = config_dir / "secrets.env"
        self._captured: dict[str, str] = {}

    def capture_env(self) -> None:
        """Move provider keys from os.environ into this trusted object so no child can inherit them."""
        for env_name in PROVIDER_ENV.values():
            val = os.environ.pop(env_name, None)
            if val:
                register_secret(val)
                self._captured[env_name] = val

    def _read_file(self) -> dict[str, str]:
        out: dict[str, str] = {}
        if self.path.is_file():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
        return out

    def get(self, provider: str) -> str | None:
        env_name = PROVIDER_ENV.get(provider)
        return self.get_named(env_name) if env_name else None

    def get_named(self, env_name: str) -> str | None:
        """Any backend secret by variable name (provider keys, plugin secret settings)."""
        val = self._captured.get(env_name) or os.environ.get(env_name) or self._read_file().get(env_name)
        if val:
            register_secret(val)
        return val or None

    def has_named(self, env_name: str) -> bool:
        return bool(self._captured.get(env_name) or os.environ.get(env_name) or self._read_file().get(env_name))

    def status(self) -> dict[str, dict[str, Any]]:
        """Configured yes/no + source only. Never any part of the key."""
        file_vals = self._read_file()
        out = {}
        for prov, env_name in PROVIDER_ENV.items():
            in_env = self._captured.get(env_name) or os.environ.get(env_name)
            src = "env" if in_env else ("file" if file_vals.get(env_name) else None)
            out[prov] = {"configured": src is not None, "source": src}
        return out

    def set(self, provider: str, value: str | None) -> None:
        self.set_named(PROVIDER_ENV[provider], value)

    def set_named(self, env_name: str, value: str | None) -> None:
        vals = self._read_file()
        if value:
            vals[env_name] = value.strip()
            register_secret(value.strip())
        else:
            vals.pop(env_name, None)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("# Research OS backend secrets (provider keys, plugin secrets). Do not commit or share.\n" +
                       "".join(f"{k}={v}\n" for k, v in sorted(vals.items())), encoding="utf-8")
        if sys.platform != "win32":
            os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)
