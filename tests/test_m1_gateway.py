"""M1 K6: fail-closed catalog, reservation ledger, retry split, single in-flight slot, escalation policy,
certification gate. All providers are mocks; zero network calls."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import UTC, datetime
from typing import Any

import pytest

from researchos.contracts.errors import ApiError
from researchos.contracts.gateway import ChatRequest, ProviderError, TaskType
from researchos.kernel.db import connect
from researchos.services.container import Services
from researchos.services.gateway import ledger
from researchos.services.gateway.gateway import AINotConfigured
from researchos.services.gateway.prompts import PromptTemplate
from researchos.services.gateway.router import Signals

from .m1_helpers import configure_models

P = PromptTemplate("t", "1", "system", "{q}")


def ok_validator(text: str) -> tuple[Signals, Any]:
    obj = json.loads(text)
    return Signals(validators_passed=1.0 if obj.get("ok") else 0.0, self_reported=obj.get("conf")), obj


def call(svc: Services, conn: sqlite3.Connection, **kw: Any) -> Any:
    return svc.gateway.call(
        conn,
        task_type=kw.pop("task_type", TaskType.ROUTINE_TEXT),
        prompt=P,
        variables={"q": "x"},
        validate=kw.pop("validate", ok_validator),
        **kw,
    )


def test_defaults_fail_closed(conn: sqlite3.Connection, svc: Services) -> None:
    svc.keystore.set("deepseek", "sk-test-x-000000")
    with pytest.raises(AINotConfigured) as e:
        call(svc, conn)
    assert "price" in e.value.message  # placeholder prices are unverified -> nothing callable
    assert conn.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0] == 0


def test_unverified_fx_and_price_ratio_reject(conn: sqlite3.Connection, svc: Services) -> None:
    configure_models(conn, svc, ("deepseek",))
    conn.execute("UPDATE model_prices SET currency='USD' WHERE provider='deepseek'")
    assert "FX" in svc.gateway.alias_status(conn, "ROUTINE_TEXT").reason  # type: ignore[union-attr]
    conn.execute("UPDATE model_prices SET currency='CNY', input_per_mtok=official_input_per_mtok*1.31")
    assert "1.3x" in svc.gateway.alias_status(conn, "ROUTINE_TEXT").reason  # type: ignore[union-attr]


def test_successful_call_settles_and_records_routing(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["deepseek"].responder = lambda req: '{"ok": true, "conf": 0.9}'
    r = call(svc, conn, project_id=None, trace_id="tr-1")
    assert r.alias == "ROUTINE_TEXT" and r.decision.action == "accept" and not r.escalated
    led = conn.execute("SELECT state, actual_cny, reserved_cny FROM ledger_entries").fetchall()
    assert len(led) == 1 and led[0][0] == "settled" and 0 < led[0][1] <= led[0][2]
    c = conn.execute("SELECT routing_before, routing_after, trace_id FROM model_calls").fetchone()
    assert json.loads(c[0])["selected_model_alias"] == "ROUTINE_TEXT" and c[2] == "tr-1"
    assert json.loads(c[1])["components"]["validators"] == 1.0


def test_routine_down_uses_sibling_not_premium(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc, ("zhipu", "anthropic"))  # no deepseek key/price
    mocks["zhipu"].responder = lambda req: '{"ok": true}'
    assert call(svc, conn).alias == "ROUTINE_TEXT_GLM"
    assert not mocks["anthropic"].calls


def test_qwen_is_the_third_routine_sibling(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc, ("qwen", "anthropic"))  # no deepseek or zhipu key/price
    mocks["qwen"].responder = lambda req: '{"ok": true}'
    assert call(svc, conn).alias == "ROUTINE_TEXT_QWEN"
    assert not mocks["anthropic"].calls


def test_invalid_twice_escalates_when_premium_enabled(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["deepseek"].responder = lambda req: '{"ok": false}'
    mocks["anthropic"].responder = lambda req: '{"ok": true}'
    r = call(svc, conn)
    assert r.escalated and r.alias == "LONG_DOCUMENT_REASONING" and len(mocks["deepseek"].calls) == 2


def test_premium_switch_off_never_escalates(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    conn.execute(
        "INSERT INTO settings_kv(key,value_json,updated_at) VALUES ('gateway','{\"premium_enabled\":false}','t')"
    )
    mocks["deepseek"].responder = lambda req: '{"ok": false}'
    with pytest.raises(ApiError) as e:
        call(svc, conn)
    assert e.value.code == "ai_output_rejected" and not mocks["anthropic"].calls


def test_self_report_alone_never_triggers_premium(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["deepseek"].responder = lambda req: '{"ok": true, "conf": 0.01}'
    assert call(svc, conn).alias == "ROUTINE_TEXT" and not mocks["anthropic"].calls


def test_force_top_uses_strongest_allowed(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["anthropic"].responder = lambda req: '{"ok": true}'
    assert call(svc, conn, force_top=True).alias == "LONG_DOCUMENT_REASONING"


def test_timeout_keeps_unknown_and_never_retries(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["deepseek"].responder = lambda req: ProviderError("timeout", "slow", maybe_billed=True)
    with pytest.raises(ApiError) as e:
        call(svc, conn)
    assert e.value.code == "ai_outcome_unknown" and len(mocks["deepseek"].calls) == 1
    assert conn.execute("SELECT state FROM ledger_entries").fetchone()[0] == "unknown"
    s = ledger.month_summary(conn)
    assert s["unknown"] > 0 and s["reserved"] >= s["unknown"]  # unknown still counts against the budget


def test_rate_limit_retried_once_then_settles(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    seq = iter([ProviderError("rate_limited", "429", retry_after_s=0.01), '{"ok": true}'])
    mocks["deepseek"].responder = lambda req: next(seq)
    call(svc, conn)
    assert len(mocks["deepseek"].calls) == 2
    assert [r[0] for r in conn.execute("SELECT state FROM ledger_entries")] == ["settled"]


def test_auth_error_releases_reservation(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    mocks["deepseek"].responder = lambda req: ProviderError("auth", "bad key")
    with pytest.raises(ApiError):
        call(svc, conn)
    assert conn.execute("SELECT state FROM ledger_entries").fetchone()[0] == "released"


def test_budget_exhausted_rejects_without_calling(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc, price_cny=1_000_000.0)
    with pytest.raises(ApiError) as e:
        call(svc, conn)
    assert e.value.status == 402 and not mocks["deepseek"].calls


def test_concurrent_reservations_never_overspend(settings: Any, conn: sqlite3.Connection) -> None:
    budget = ledger.Budget(monthly_cny=10.0, per_task_cny=100.0, soft_warning_ratio=0.8)
    ok: list[str] = []

    def worker() -> None:
        c = connect(settings.db_path)
        try:
            ledger.reserve(c, call_id=None, amount=1.5, budget=budget, snapshot={}, project_id=None, task_id=None)  # type: ignore[arg-type]
            ok.append("x")
        except ApiError:
            pass
        finally:
            c.close()

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(ok) == 6 and ledger.month_summary(conn)["reserved"] <= 10.0


def test_duplicate_response_never_double_charges(conn: sqlite3.Connection) -> None:
    b = ledger.Budget(100, 100, 0.8)
    e1 = ledger.reserve(conn, call_id=None, amount=1, budget=b, snapshot={}, project_id=None, task_id=None)  # type: ignore[arg-type]
    e2 = ledger.reserve(conn, call_id=None, amount=1, budget=b, snapshot={}, project_id=None, task_id=None)  # type: ignore[arg-type]
    assert ledger.settle(conn, e1, 0.5, "resp-1") is True
    assert ledger.settle(conn, e2, 0.5, "resp-1") is False
    assert ledger.month_summary(conn)["settled"] == 0.5


def test_month_boundary_is_asia_shanghai() -> None:
    assert ledger.month_key(datetime(2026, 10, 31, 16, 30, tzinfo=UTC)) == "2026-11"
    assert ledger.month_key(datetime(2026, 10, 31, 15, 59, tzinfo=UTC)) == "2026-10"


def test_single_paid_call_slot(conn: sqlite3.Connection) -> None:
    assert ledger.acquire_slot(conn, "a", 30)
    assert not ledger.acquire_slot(conn, "b", 30)
    ledger.release_slot(conn, "a")
    assert ledger.acquire_slot(conn, "b", 30)
    conn.execute("UPDATE gateway_slot SET until='2000-01-01T00:00:00+00:00'")  # crashed holder expires
    assert ledger.acquire_slot(conn, "c", 30)


def test_preflight_blocks_oversized_request(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    conn.execute("UPDATE model_aliases SET context_window=50")
    with pytest.raises(ApiError) as e:
        call(svc, conn)
    assert e.value.code == "request_too_large" and "estimate" in e.value.message
    assert not mocks["deepseek"].calls


def test_evidence_bearing_requires_certification(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc, certify=False)
    with pytest.raises(AINotConfigured) as e:
        call(svc, conn, evidence_bearing=True)
    assert "not certified" in e.value.message and not mocks["deepseek"].calls


def test_dry_run_and_catalog_api_make_no_calls(client: Any, mocks: dict) -> None:
    r = client.post("/api/v1/gateway/dry-run", json={"task_type": "routine_text"})
    assert r.status_code == 200 and r.json()["plan"][0]["usable"] is False
    cat = client.get("/api/v1/gateway/catalog").json()
    assert {a["alias"] for a in cat} >= {"ROUTINE_TEXT", "PREMIUM_AGENT"} and not any(a["usable"] for a in cat)
    assert all(not m.calls for m in mocks.values())


def test_request_shape_reaches_provider(conn: sqlite3.Connection, svc: Services, mocks: dict) -> None:
    configure_models(conn, svc)
    seen: list[ChatRequest] = []
    mocks["deepseek"].responder = lambda req: (seen.append(req), '{"ok": true}')[1]
    call(svc, conn)
    assert seen[0].json_mode and seen[0].messages[0].role == "system"
