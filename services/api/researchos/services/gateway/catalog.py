"""Model catalog (aliases -> provider model ids), prices and FX as CONFIG DATA (MODEL_ROUTING_SPEC §2, §8).

Fail closed (HARDENING #6): an alias is usable only if enabled, its provider key is configured, its price row is
verified with input/output + official prices, effective price <= 1.3x official, and (for non-CNY) a verified FX rate
exists. Defaults are placeholders marked unverified, so nothing is callable until the owner confirms prices.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

from ...kernel.db import Row, row, rows, tx, utcnow

# (alias, provider, model_id placeholder, tier). Per USER OVERRIDE: routine = DeepSeek + GLM + Qwen; premium = Claude +
# OpenAI.
DEFAULT_ALIASES: tuple[tuple[str, str, str, str], ...] = (
    ("ROUTINE_TEXT", "deepseek", "deepseek-v4", "routine"),
    ("ROUTINE_TEXT_GLM", "zhipu", "glm-5.3-flash", "routine"),
    ("ROUTINE_TEXT_QWEN", "qwen", "qwen3.8-flash", "routine"),
    ("DOCUMENT_OCR", "zhipu", "glm-ocr", "routine"),
    ("ROUTINE_VISION", "zhipu", "glm-5.3-flash", "routine"),
    ("VISUAL_CODING", "zhipu", "glm-5v-turbo", "routine"),
    ("COMPLEX_MULTIMODAL", "openai", "gpt-6.1-sol", "premium"),
    ("LONG_DOCUMENT_REASONING", "anthropic", "claude-sonnet-5-5", "premium"),
    ("PREMIUM_AGENT", "anthropic", "claude-opus-5-5", "premium"),
    ("TOP_OPENAI", "openai", "gpt-6-astra", "top"),
    ("EMERGENCY_CHEAP_FALLBACK", "anthropic", "claude-haiku-5-5", "fallback"),
)
MAX_PRICE_RATIO = 1.3


@dataclass(frozen=True)
class AliasStatus:
    alias: str
    provider: str
    model_id: str
    tier: str
    usable: bool
    reason: str | None
    price: Row | None
    fx: float | None
    context_window: int | None
    max_output_tokens: int | None
    transport: str = "direct"  # "relay": same vendor model via the configured relay (prices under provider "relay")


def seed_defaults(conn: sqlite3.Connection) -> None:
    with tx(conn):
        for alias, prov, mid, tier in DEFAULT_ALIASES:
            conn.execute("INSERT OR IGNORE INTO model_aliases(alias,provider,model_id,tier,enabled,updated_at) "
                         "VALUES (?,?,?,?,?,?)", (alias, prov, mid, tier, 0 if tier == "top" else 1, utcnow()))
        conn.execute("INSERT OR IGNORE INTO fx_rates(currency,cny_per_unit,source,as_of,verified) "
                     "VALUES ('CNY',1.0,'identity','1970-01-01',1)")


def _price_problem(p: Row | None) -> str | None:
    if p is None:
        return "no price configured"
    if not p["verified"]:
        return "price not verified"
    vals = (p["input_per_mtok"], p["output_per_mtok"], p["official_input_per_mtok"], p["official_output_per_mtok"])
    if any(v is None for v in vals):
        return "price incomplete (need effective + official input/output)"
    if p["input_per_mtok"] > MAX_PRICE_RATIO * p["official_input_per_mtok"] or \
            p["output_per_mtok"] > MAX_PRICE_RATIO * p["official_output_per_mtok"]:
        return "effective price exceeds 1.3x official price"
    return None


def status(conn: sqlite3.Connection, alias: str, key_ok: bool, transport: str = "direct") -> AliasStatus | None:
    a = row(conn.execute("SELECT * FROM model_aliases WHERE alias=?", (alias,)))
    if a is None:
        return None
    price_provider = "relay" if transport == "relay" else a["provider"]
    p = row(conn.execute("SELECT * FROM model_prices WHERE provider=? AND model_id=?", (price_provider, a["model_id"])))
    fx_row = row(conn.execute("SELECT * FROM fx_rates WHERE currency=?", (p["currency"],))) if p else None
    reason = None if a["enabled"] else "disabled"
    reason = reason or (None if key_ok else f"no API key for {price_provider}") or _price_problem(p)
    if reason is None and (fx_row is None or not fx_row["verified"]):
        reason = f"no verified FX rate for {p['currency'] if p else '?'}"
    return AliasStatus(a["alias"], a["provider"], a["model_id"], a["tier"], reason is None, reason, p,
                       float(fx_row["cny_per_unit"]) if fx_row else None, a["context_window"], a["max_output_tokens"],
                       transport)


def list_all(conn: sqlite3.Connection) -> list[Row]:
    return rows(conn.execute("SELECT * FROM model_aliases ORDER BY alias"))


def upsert_price(conn: sqlite3.Connection, data: dict[str, Any]) -> None:
    cols = ("provider", "model_id", "currency", "input_per_mtok", "output_per_mtok", "official_input_per_mtok",
            "official_output_per_mtok", "effective_date", "source", "verified")
    with tx(conn):
        conn.execute(f"INSERT OR REPLACE INTO model_prices({','.join(cols)},updated_at) VALUES ({','.join('?' * 11)})",
                     (*(data.get(c) for c in cols), utcnow()))


def upsert_alias(conn: sqlite3.Connection, data: dict[str, Any]) -> None:
    with tx(conn):
        conn.execute("INSERT OR REPLACE INTO model_aliases(alias,provider,model_id,tier,enabled,context_window,"
                     "max_output_tokens,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                     (data["alias"], data["provider"], data["model_id"], data["tier"], int(data.get("enabled", 1)),
                      data.get("context_window"), data.get("max_output_tokens"), utcnow()))


def upsert_fx(conn: sqlite3.Connection, currency: str, cny_per_unit: float, source: str, as_of: str,
              verified: bool) -> None:
    with tx(conn):
        conn.execute("INSERT OR REPLACE INTO fx_rates(currency,cny_per_unit,source,as_of,verified) VALUES (?,?,?,?,?)",
                     (currency, cny_per_unit, source, as_of, int(verified)))
