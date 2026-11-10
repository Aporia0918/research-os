"""Model catalog, prices, FX, policy, usage, dry-run routing (MODEL_ROUTING_SPEC §8). No paid calls here."""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ...contracts.errors import ApiError
from ...contracts.gateway import TaskType
from ...kernel.db import jdump, jload, row, rows, tx, utcnow
from ...kernel.events import emit
from ...services.gateway import catalog, certification, ledger
from ...services.gateway import router as rt
from ...services.gateway.prompts import CITED_QA
from ...services.identity.sessions import Principal
from ..deps import db, principal, services

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway"])


class AliasIn(BaseModel):
    provider: str = Field(pattern="^(deepseek|zhipu|qwen|anthropic|openai)$")
    model_id: str = Field(min_length=1, max_length=120)
    tier: str = Field(pattern="^(routine|premium|fallback|top)$")
    enabled: bool = True
    context_window: int | None = Field(default=None, ge=1)
    max_output_tokens: int | None = Field(default=None, ge=1)


class PriceIn(BaseModel):
    provider: str
    model_id: str
    currency: str = Field(pattern="^[A-Z]{3}$")
    input_per_mtok: float = Field(ge=0)
    output_per_mtok: float = Field(ge=0)
    official_input_per_mtok: float = Field(ge=0)
    official_output_per_mtok: float = Field(ge=0)
    effective_date: str
    source: str = Field(min_length=3, description="where the official price was read (URL + date)")
    verified: bool


class FxIn(BaseModel):
    cny_per_unit: float = Field(gt=0)
    source: str = Field(min_length=3)
    as_of: str
    verified: bool


class PolicyIn(BaseModel):
    premium_enabled: bool = True
    top_enabled: bool = False
    monthly_budget_cny: float = Field(ge=0, le=100_000)
    per_task_budget_cny: float = Field(ge=0)
    soft_warning_ratio: float = Field(default=0.8, gt=0, le=1)
    daily_budget_cny: float | None = Field(default=None, ge=0, description="cap per Asia/Shanghai day; null = none")
    per_project_budget_cny: float | None = Field(default=None, ge=0,
                                                 description="cap per project; calls without a project are refused")
    allowed_models: list[str] | None = Field(default=None, max_length=50,
                                             description="only these model ids may be routed to; null = no list")


class DryRunIn(BaseModel):
    task_type: TaskType
    force_top: bool = False


@router.get("/catalog")
def get_catalog(
    request: Request, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> list[dict[str, Any]]:
    gw = services(request).gateway
    out = []
    for a in catalog.list_all(conn):
        st = gw.alias_status(conn, a["alias"])
        transport = st.transport if st else "direct"
        price_provider = "relay" if transport == "relay" else a["provider"]
        price = row(
            conn.execute("SELECT * FROM model_prices WHERE provider=? AND model_id=?", (price_provider, a["model_id"]))
        )
        out.append(
            {
                **a,
                "enabled": bool(a["enabled"]),
                "usable": bool(st and st.usable),
                "reason": st.reason if st else "unknown",
                "price": price,
                "transport": transport,
                "certification": certification.status(conn, a["model_id"], CITED_QA.hash),
            }
        )
    return out


@router.put("/aliases/{alias}")
def put_alias(
    alias: str, data: AliasIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, bool]:
    catalog.upsert_alias(conn, {"alias": alias, **data.model_dump()})
    emit(conn, "gateway.alias_changed", actor=p.actor, entity_type="alias", entity_id=alias, data=data.model_dump())
    return {"ok": True}


@router.put("/prices")
def put_price(
    data: PriceIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, bool]:
    catalog.upsert_price(conn, data.model_dump())
    emit(
        conn,
        "gateway.price_changed",
        actor=p.actor,
        entity_type="model",
        entity_id=data.model_id,
        data={"verified": data.verified, "source": data.source},
    )
    return {"ok": True}


@router.put("/fx/{currency}")
def put_fx(
    currency: str, data: FxIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, bool]:
    if currency == "CNY":
        raise ApiError(422, "fx_identity", "CNY is the ledger currency")
    catalog.upsert_fx(conn, currency, data.cny_per_unit, data.source, data.as_of, data.verified)
    return {"ok": True}


@router.get("/policy")
def get_policy(
    request: Request, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, Any]:
    pol, bud = services(request).gateway.policy(conn)
    return {
        "premium_enabled": pol.premium_enabled,
        "top_enabled": pol.top_enabled,
        "monthly_budget_cny": bud.monthly_cny,
        "per_task_budget_cny": bud.per_task_cny,
        "soft_warning_ratio": bud.soft_warning_ratio,
        "daily_budget_cny": bud.daily_cny,
        "per_project_budget_cny": bud.per_project_cny,
        "allowed_models": list(pol.allowed_models) if pol.allowed_models is not None else None,
        "low": pol.low,
        "high": pol.high,
    }


@router.put("/policy")
def put_policy(
    data: PolicyIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, bool]:
    """Budget/permission changes: user only (agents and models have no route here)."""
    with tx(conn):
        cur = row(conn.execute("SELECT value_json FROM settings_kv WHERE key='gateway'"))
        merged = {**((jload(cur["value_json"]) if cur else None) or {}), **data.model_dump()}
        conn.execute(
            "INSERT INTO settings_kv(key,value_json,updated_at) VALUES ('gateway',?,?) ON CONFLICT(key) DO "
            "UPDATE SET value_json=excluded.value_json, revision=revision+1, updated_at=excluded.updated_at",
            (jdump(merged), utcnow()),
        )
        emit(
            conn,
            "gateway.policy_changed",
            actor=p.actor,
            entity_type="settings",
            entity_id="gateway",
            data=data.model_dump(),
        )
    return {"ok": True}


@router.get("/usage")
def usage(
    month: str | None = None, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, Any]:
    m = month or ledger.month_key()
    by_model = rows(
        conn.execute(
            "SELECT c.provider, c.model_id, COUNT(*) AS calls, COALESCE(SUM(l.actual_cny),0) AS settled_cny, "
            "COALESCE(SUM(CASE WHEN l.state IN ('reserved','unknown') THEN l.reserved_cny END),0) AS open_cny "
            "FROM ledger_entries l JOIN model_calls c ON c.id=l.call_id WHERE l.month=? "
            "GROUP BY c.provider, c.model_id",
            (m,),
        )
    )
    recent = rows(
        conn.execute(
            "SELECT id, task_type, alias, model_id, status, input_tokens, output_tokens, error_code, "
            "created_at FROM model_calls ORDER BY created_at DESC LIMIT 30"
        )
    )
    return {"month": m, **ledger.month_summary(conn, m), "by_model": by_model, "recent_calls": recent}


@router.post("/dry-run")
def dry_run(
    data: DryRunIn, request: Request, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, Any]:
    """Routing plan for a task type, with each candidate's availability. Never calls a provider."""
    gw = services(request).gateway
    pol, _ = gw.policy(conn)
    plan = []
    for level, alias in enumerate(rt.candidates(data.task_type, data.force_top)):
        for cand in (alias, *rt.SIBLINGS.get(alias, ())):
            st = gw.alias_status(conn, cand)
            allowed = bool(st) and rt.tier_allowed(st.tier if st else "", pol, data.force_top)
            plan.append(
                {
                    "level": level,
                    "alias": cand,
                    "model_id": st.model_id if st else None,
                    "tier": st.tier if st else None,
                    "tier_allowed": allowed,
                    "usable": bool(st and st.usable),
                    "reason": None
                    if (st and st.usable and allowed)
                    else (st.reason if st and st.reason else "tier disabled"),
                }
            )
    return {"task_type": data.task_type.value, "force_top": data.force_top, "plan": plan}
