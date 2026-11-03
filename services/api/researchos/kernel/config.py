"""Runtime configuration.

Sources (later wins): built-in defaults -> <data_dir>/config/researchos.toml -> RESEARCHOS_* env vars.
Secrets (provider API keys) are NOT part of this object; see secrets.py.
"""
from __future__ import annotations

import ipaddress
import os
import sys
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

from ..platform.macos import UserDirs, bundled_dirs

REPO_ROOT = Path(__file__).resolve().parents[4]


def _bundled() -> UserDirs | None:
    """Data/log dirs of a bundled Mac install (ADR-263). The account's home comes from the password database, not
    $HOME: the trusted processes point HOME into the data dir after start (platform.env)."""
    if sys.platform != "darwin":
        return None
    import pwd
    return bundled_dirs(REPO_ROOT, Path(pwd.getpwuid(os.getuid()).pw_dir))


def _default_data_dir() -> Path:
    if sys.platform == "win32":
        return Path(r"D:\AI\ResearchOS\data")
    mac = _bundled()
    return mac.data if mac else REPO_ROOT / "data"


def _default_log_dir() -> str:
    mac = _bundled()
    return str(mac.logs) if mac else ""


@dataclass
class Settings:
    data_dir: Path = field(default_factory=_default_data_dir)
    # Network. Loopback by default (baseline §11). Non-loopback requires TLS unless explicitly overridden.
    host: str = "127.0.0.1"
    port: int = 8443
    tls_cert_file: str = ""
    tls_key_file: str = ""
    allow_insecure_lan: bool = False
    # Public origins the browser will use, e.g. "https://ros-pc.tailnet.ts.net:8443". Loopback origins always allowed.
    public_origins: list[str] = field(default_factory=list)
    # Auth
    session_ttl_hours: int = 24 * 14
    session_idle_hours: int = 24 * 3
    pairing_code_ttl_min: int = 10
    # Budget (RMB). Month boundary Asia/Shanghai.
    monthly_budget_cny: float = 100.0
    soft_warning_ratio: float = 0.8
    per_task_budget_cny: float = 5.0
    # Tasks (baseline §6 defaults)
    heartbeat_s: float = 5.0
    lease_s: float = 30.0
    cancel_grace_s: float = 10.0
    task_max_minutes: int = 90
    max_task_attempts: int = 2
    # GPU guard (provisional, calibrate on device)
    gpu_vram_target_ratio: float = 0.75
    gpu_temp_stop_c: float = 83.0
    gpu_temp_grace_s: float = 60.0
    # Import limits
    max_upload_mb: int = 200
    max_pdf_pages: int = 2000
    parse_timeout_s: int = 300
    # Proxies: only honour X-Forwarded-For from loopback when explicitly enabled (e.g. tailscale serve)
    trust_forwarded_for: bool = False
    idempotency_ttl_days: int = 7
    # OpenAI-compatible relay (owner-chosen, e.g. https://relay.example.com/v1). Empty = no relay. Key: env
    # RESEARCHOS_RELAY_API_KEY or secrets.env (never in config files). `relay_for` lists the model vendors whose
    # aliases are sent through the relay (e.g. ["anthropic", "openai"]); the vendor identity is kept for routing.
    relay_base_url: str = ""
    # Owner opt-in for fake-IP proxies (e.g. Clash fake-ip): DNS answers in 198.18.0.0/15 (RFC 2544 benchmark range)
    # are accepted by the SSRF guard. Private/loopback/link-local addresses stay refused. Default off.
    network_allow_fake_ip: bool = False
    # K2 time triggers (saved searches, weekly retraction checks): worker tick interval in seconds.
    trigger_interval_s: float = 60.0
    relay_for: list[str] = field(default_factory=list)
    # Egress gate (ADR-159/162): provider names the owner trusts as LOCAL inference (e.g. an Ollama endpoint on this
    # machine whose downstream processing the owner controls). Everything else is cloud; the relay never counts.
    trusted_local_providers: list[str] = field(default_factory=list)
    # One-click update (ADR-223): only on an explicit "Check for updates" click, never at startup. The feed is the
    # latest release's latest.json; the mirror prefix (e.g. "https://ghfast.top/") is prepended to the feed and the
    # installer URL; the UI choice (config/update.json) overrides it. Timeout applies per connect/read.
    update_feed_url: str = "https://github.com/Felix1451991535/research-os/releases/latest/download/latest.json"
    update_mirror_prefix: str = ""
    update_timeout_s: float = 20.0
    # Low-privilege worker identity (baseline §7). Empty = NOT CONFIGURED (doctor reports it).
    run_as_user: str = ""
    # Logs: "" = <data_dir>/logs; a bundled Mac install defaults to ~/Library/Logs/ResearchOS (ADR-263).
    log_dir: str = field(default_factory=_default_log_dir)
    # Dev
    dev_mode: bool = False
    web_dist: Path = field(default_factory=lambda: REPO_ROOT / "apps" / "web" / "dist")
    templates_dir: Path = field(default_factory=lambda: REPO_ROOT / "templates")
    # Additional template roots (each with its own REVIEWED.json), e.g. plugin or test fixture templates.
    extra_template_dirs: list[str] = field(default_factory=list)
    # Extra Host header values accepted (tests use "testserver"); never needed in normal use.
    extra_allowed_hosts: list[str] = field(default_factory=list)

    # ---- derived paths (data dir layout, baseline §11) ----
    @property
    def raw_dir(self) -> Path: return self.data_dir / "raw"
    @property
    def parsed_dir(self) -> Path: return self.data_dir / "parsed"
    @property
    def db_dir(self) -> Path: return self.data_dir / "db"
    @property
    def db_path(self) -> Path: return self.db_dir / "researchos.db"
    @property
    def runs_dir(self) -> Path: return self.data_dir / "runs"
    @property
    def exports_dir(self) -> Path: return self.data_dir / "exports"
    @property
    def backups_dir(self) -> Path: return self.data_dir / "backups"
    @property
    def config_dir(self) -> Path: return self.data_dir / "config"
    @property
    def cache_dir(self) -> Path: return self.data_dir / "cache"
    @property
    def logs_dir(self) -> Path: return Path(self.log_dir) if self.log_dir else self.data_dir / "logs"
    @property
    def datasets_dir(self) -> Path: return self.data_dir / "datasets"
    @property
    def incoming_dir(self) -> Path: return self.data_dir / "incoming"

    @property
    def tls_enabled(self) -> bool:
        return bool(self.tls_cert_file and self.tls_key_file)

    def ensure_dirs(self) -> None:
        for p in (self.raw_dir, self.parsed_dir, self.db_dir, self.runs_dir, self.exports_dir,
                  self.backups_dir, self.config_dir, self.cache_dir, self.logs_dir,
                  self.datasets_dir, self.incoming_dir):
            p.mkdir(parents=True, exist_ok=True)

    def is_loopback_bind(self) -> bool:
        if self.host in ("localhost",):
            return True
        try:
            return ipaddress.ip_address(self.host).is_loopback
        except ValueError:
            return False

    def allowed_origins(self) -> set[str]:
        scheme = "https" if self.tls_enabled else "http"
        out = {f"{scheme}://127.0.0.1:{self.port}", f"{scheme}://localhost:{self.port}"}
        if self.dev_mode:
            out |= {"http://127.0.0.1:5173", "http://localhost:5173"}
        out |= {o.rstrip("/") for o in self.public_origins}
        return out

    def validate_network(self) -> list[str]:
        """Return fatal problems for the network config (baseline §3/§11: never bare on all NICs)."""
        problems = []
        if not self.is_loopback_bind():
            if not self.tls_enabled and not self.allow_insecure_lan:
                problems.append(
                    f"Refusing to listen on {self.host} without TLS. Configure tls_cert_file/tls_key_file "
                    "(see docs/OPS.md#ipad) or bind 127.0.0.1.")
            if not self.public_origins:
                problems.append("Non-loopback bind requires public_origins (the URL the iPad/desktop will open).")
        for f_ in (self.tls_cert_file, self.tls_key_file):
            if f_ and not Path(f_).is_file():
                problems.append(f"TLS file not found: {f_}")
        return problems


_BOOL = {"1": True, "true": True, "yes": True, "0": False, "false": False, "no": False}


def _coerce(name: str, current: object, raw: object) -> object:
    if isinstance(current, bool):
        if isinstance(raw, bool):
            return raw
        return _BOOL[str(raw).strip().lower()]
    if isinstance(current, int) and not isinstance(current, bool):
        return int(str(raw))
    if isinstance(current, float):
        return float(str(raw))
    if isinstance(current, Path):
        return Path(str(raw))
    if isinstance(current, list):
        if isinstance(raw, list):
            return [str(x) for x in raw]
        return [x.strip() for x in str(raw).split(",") if x.strip()]
    return str(raw)


def load_settings(data_dir: str | Path | None = None, **overrides: object) -> Settings:
    s = Settings()
    env_dd = os.environ.get("RESEARCHOS_DATA_DIR")
    if data_dir is not None:
        s.data_dir = Path(data_dir)
    elif env_dd:
        s.data_dir = Path(env_dd)
    cfg_file = s.data_dir / "config" / "researchos.toml"
    if cfg_file.is_file():
        with cfg_file.open("rb") as fh:
            data = tomllib.load(fh)
        for f in fields(s):
            if f.name in data and f.name != "data_dir":
                setattr(s, f.name, _coerce(f.name, getattr(s, f.name), data[f.name]))
    for f in fields(s):
        if f.name == "data_dir":
            continue
        env = os.environ.get("RESEARCHOS_" + f.name.upper())
        if env is not None:
            setattr(s, f.name, _coerce(f.name, getattr(s, f.name), env))
    for k, v in overrides.items():
        setattr(s, k, v)
    return s
