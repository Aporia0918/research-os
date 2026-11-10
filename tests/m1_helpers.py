"""Shared helpers for M1 tests: mock providers wired under real provider names, verified test prices,
certification override, in-process worker drain. No network, no paid calls."""
from __future__ import annotations

import sqlite3
from collections.abc import Callable

from researchos.contracts.gateway import ChatRequest, ProviderError
from researchos.services.container import Services
from researchos.services.gateway import catalog, certification
from researchos.services.gateway.prompts import CITED_QA
from researchos.services.gateway.providers.mock import MockProvider
from researchos.services.orchestration import workers
from researchos_worker.loop import WorkerState, run_loop

Responder = Callable[[ChatRequest], str | ProviderError]
PROVIDERS = ("deepseek", "zhipu", "qwen", "anthropic", "openai")


def mock_providers(responders: dict[str, Responder] | None = None) -> dict[str, MockProvider]:
    default: Responder = lambda req: '{"sentences": [], "confidence": 0.5}'  # noqa: E731
    return {p: MockProvider(p, (responders or {}).get(p, default)) for p in PROVIDERS}


def configure_models(conn: sqlite3.Connection, svc: Services, providers: tuple[str, ...] = PROVIDERS,
                     price_cny: float = 1.0, certify: bool = True) -> None:
    """Verified (test) prices in CNY for every default alias whose provider is listed; keys set for them."""
    catalog.seed_defaults(conn)
    for a in catalog.list_all(conn):
        if a["provider"] in providers:
            catalog.upsert_price(conn, {"provider": a["provider"], "model_id": a["model_id"], "currency": "CNY",
                                        "input_per_mtok": price_cny, "output_per_mtok": price_cny * 2,
                                        "official_input_per_mtok": price_cny, "official_output_per_mtok": price_cny * 2,
                                        "effective_date": "2026-10-01", "source": "test fixture", "verified": 1})
            if certify:
                certification.record(conn, "test", a["model_id"], CITED_QA.hash,
                                     {"locate_rate": 1, "support_precision": 1, "refusal_rate": 1})
    for p in providers:
        svc.keystore.set(p, f"sk-test-{p}-0000000000")


def drain(conn: sqlite3.Connection, svc: Services, max_tasks: int = 20) -> int:
    st = WorkerState(workers.register(conn, 0, "test"))
    n = 0
    while n < max_tasks and run_loop(conn, svc, st, poll_s=0.01, once=True):
        n += 1
    return n
