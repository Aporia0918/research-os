"""K6 entry point: every model call goes through Gateway.call (route -> availability -> preflight -> reserve ->
call -> settle -> validate -> accept / retry / escalate). Routing records are persisted before and after."""
from __future__ import annotations

import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from ...contracts.gateway import ChatRequest, Message, ModelProvider, TaskType
from ...kernel.config import Settings
from ...kernel.db import jdump, jload, row, tx
from ...kernel.events import emit
from . import catalog, certification, egress, ledger, router
from .attempt import AttemptCtx, GatewayError, run_attempt
from .keystore import SecretStore
from .prompts import PromptTemplate

# validate(text) -> (signals, parsed payload). Raise ValueError when the output is unusable (schema failure).
Validator = Callable[[str], tuple[router.Signals, Any]]


def _cap(v: Any) -> float | None:
    return None if v is None else float(v)


@dataclass
class GatewayResult:
    payload: Any
    text: str
    alias: str
    provider: str
    model_id: str
    call_ids: list[str]
    decision: router.Decision
    escalated: bool
    labels: list[str] = field(default_factory=list)
    restricted: tuple[str, ...] = ()  # local_only datasets this call carried; dependent calls must inherit (#47)


class AINotConfigured(GatewayError):
    def __init__(self, reasons: dict[str, str]) -> None:
        super().__init__(503, "ai_not_configured", "AI is not configured for this task: " +
                         "; ".join(f"{a}: {r}" for a, r in reasons.items()), details={"reasons": reasons})


class Gateway:
    def __init__(self, settings: Settings, keystore: SecretStore, providers: dict[str, ModelProvider]) -> None:
        self.settings, self.keystore, self.providers = settings, keystore, providers

    # ---- configuration ----
    def transport_for(self, vendor: str) -> str:
        """Adapter/key used for a vendor: the relay if configured for it (Settings.relay_for), else the vendor.
        Routing keeps the vendor identity (independent cross-checks need a different vendor, not transport)."""
        if vendor in self.settings.relay_for and "relay" in self.providers:
            return "relay"
        return vendor

    def policy(self, conn: sqlite3.Connection) -> tuple[router.Policy, ledger.Budget]:
        r = row(conn.execute("SELECT value_json FROM settings_kv WHERE key='gateway'"))
        g: dict[str, Any] = (jload(r["value_json"]) if r else None) or {}
        pol = router.Policy(premium_enabled=bool(g.get("premium_enabled", True)),
                            top_enabled=bool(g.get("top_enabled", False)),
                            low=float(g.get("low", 0.60)), high=float(g.get("high", 0.85)),
                            allowed_models=None if g.get("allowed_models") is None
                            else tuple(str(m) for m in g["allowed_models"]))
        bud = ledger.Budget(float(g.get("monthly_budget_cny", self.settings.monthly_budget_cny)),
                            float(g.get("per_task_budget_cny", self.settings.per_task_budget_cny)),
                            float(g.get("soft_warning_ratio", self.settings.soft_warning_ratio)),
                            _cap(g.get("daily_budget_cny")), _cap(g.get("per_project_budget_cny")))
        return pol, bud

    def alias_status(self, conn: sqlite3.Connection, alias: str, prompt: PromptTemplate | None = None,
                     evidence_bearing: bool = False) -> catalog.AliasStatus | None:
        a = row(conn.execute("SELECT provider FROM model_aliases WHERE alias=?", (alias,)))
        if a is None:
            return None
        via = self.transport_for(a["provider"])
        key_ok = via in self.providers and bool(self.keystore.get(via) or via == "mock")
        st = catalog.status(conn, alias, key_ok, "relay" if via == "relay" else "direct")
        if st and st.usable and evidence_bearing and prompt is not None:
            cert = certification.status(conn, st.model_id, prompt.hash)
            if cert not in ("certified", "override"):
                return catalog.AliasStatus(**{**st.__dict__, "usable": False,
                                              "reason": f"model/prompt not certified ({cert}); run the eval suite"})
        return st

    def domestic(self, vendor: str) -> bool:
        """Served from mainland China: a listed domestic vendor reached directly, never through the relay."""
        return vendor in self.settings.domestic_vendors and self.transport_for(vendor) != "relay"

    def location(self, provider: str) -> str:
        """Where a provider's content goes: "local" only for an in-process provider that declares it (mock) or a
        provider the owner listed in trusted_local_providers; the relay is always cloud (review #48)."""
        via = self.transport_for(provider)
        if via == "relay":
            return "cloud"
        if via in self.settings.trusted_local_providers:
            return "local"
        return str(getattr(self.providers.get(via), "location", "cloud"))

    def _pick(self, conn: sqlite3.Connection, alias: str, prompt: PromptTemplate, evidence_bearing: bool,
              pol: router.Policy, force_top: bool, reasons: dict[str, str],
              exclude_provider: str | None = None, egress_block: str = "",
              domestic_only: bool = False) -> catalog.AliasStatus | None:
        for cand in (alias, *router.SIBLINGS.get(alias, ())):
            st = self.alias_status(conn, cand, prompt, evidence_bearing)
            if st is None:
                reasons[cand] = "unknown alias"
            elif egress_block and self.location(st.provider) != "local":
                reasons[cand] = egress_block
            elif domestic_only and not self.domestic(st.provider):
                reasons[cand] = f"{st.provider} is not a domestic vendor called directly; this content stays in China"
            elif st.provider == exclude_provider:
                reasons[cand] = f"same provider as the writer ({exclude_provider}); independent check needs another"
            elif not router.tier_allowed(st.tier, pol, force_top):
                reasons[cand] = f"{st.tier} tier disabled"
            elif pol.allowed_models is not None and st.model_id not in pol.allowed_models:
                reasons[cand] = f"model {st.model_id} is not on the owner's allowed-models list"
            elif not st.usable:
                reasons[cand] = st.reason or "unusable"
            else:
                return st
        return None

    # ---- call ----
    def call(self, conn: sqlite3.Connection, *, task_type: TaskType, prompt: PromptTemplate, variables: dict[str, str],
             validate: Validator, project_id: str | None = None, task_id: str | None = None,
             trace_id: str | None = None, force_top: bool = False, evidence_bearing: bool = False,
             max_output_tokens: int = 1200, exclude_provider: str | None = None,
             data_refs: Sequence[egress.DataRef] = (), domestic_only: bool = False) -> GatewayResult:
        """`data_refs`: datasets / plans / runs whose content the variables carry (egress gate, ADR-159).
        `domestic_only`: only domestic vendors called directly (no relay, no escalation abroad)."""
        pol, bud = self.policy(conn)
        system, user = prompt.render(**variables)
        messages = (Message("system", system), Message("user", user))
        block, restricted = self._egress(conn, data_refs, messages, task_type, (project_id, task_id, trace_id))
        route = router.candidates(task_type, force_top)
        reasons: dict[str, str] = {}
        call_ids: list[str] = []
        escalated = False
        for level, alias in enumerate(route):
            st = self._pick(conn, alias, prompt, evidence_bearing, pol, force_top, reasons, exclude_provider, block,
                            domestic_only)
            if st is None and level == 0:  # both routine providers down -> emergency fallback (never default)
                st = self._pick(conn, router.EMERGENCY, prompt, evidence_bearing, pol, False, reasons,
                                exclude_provider, block, domestic_only)
            if st is None:
                if not escalated:
                    break  # premium is escalation-only: an unconfigured routine model never jumps to premium
                continue
            result = self._run_level(conn, st, messages, prompt, validate, bud, pol, level, len(route), force_top,
                                     call_ids, escalated, (project_id, task_id, trace_id, task_type, max_output_tokens))
            if result is not None:
                result.restricted = restricted
                return result
            escalated = True
        if call_ids:
            raise GatewayError(422, "ai_output_rejected", "no allowed model produced a valid answer",
                               details={"call_ids": call_ids, "reasons": reasons})
        if block:
            with tx(conn, join=True):
                emit(conn, "gateway.egress_blocked", actor="system", project_id=project_id, correlation_id=trace_id,
                     data={"datasets": list(restricted), "task_type": task_type.value})
            raise GatewayError(403, "egress_blocked", block, details={"reasons": reasons})
        raise AINotConfigured(reasons)

    @staticmethod
    def _egress(conn: sqlite3.Connection, refs: Sequence[egress.DataRef], messages: tuple[Message, ...],
                task_type: TaskType, ids: tuple[str | None, str | None, str | None]) -> tuple[str, tuple[str, ...]]:
        """The one egress decision per call: ("", ()) = any provider, else the reason that limits it to local models
        and the restricted datasets (returned on the result so dependent calls inherit them)."""
        project_id, task_id, trace_id = ids
        d = egress.check(conn, refs, [m.content for m in messages])
        if not d.local_only:
            return "", ()
        with tx(conn, join=True):
            emit(conn, "gateway.egress_restricted", actor=f"task:{task_id}" if task_id else "system",
                 project_id=project_id, correlation_id=trace_id,
                 data={"datasets": list(d.datasets), "how": d.how, "task_type": task_type.value})
        return egress.describe(d), d.datasets

    def _run_level(self, conn: sqlite3.Connection, st: catalog.AliasStatus, messages: tuple[Message, ...],
                   prompt: PromptTemplate, validate: Validator, bud: ledger.Budget, pol: router.Policy, level: int,
                   n_levels: int, force_top: bool, call_ids: list[str], escalated: bool,
                   meta: tuple[str | None, str | None, str | None, TaskType, int]) -> GatewayResult | None:
        """Up to two attempts on one model. Returns a result, None to escalate, or raises on hard failure."""
        project_id, task_id, trace_id, task_type, max_out = meta
        at_max = level == n_levels - 1
        failures = 0
        for attempt in (1, 2):
            before = {"task_type": task_type.value, "selected_model_alias": st.alias, "level": level,
                      "attempt": attempt, "escalation_allowed": not at_max, "force_top": force_top,
                      "maximum_escalation_level": n_levels - 1}
            req = ChatRequest(st.model_id, messages, min(max_out, st.max_output_tokens or max_out), json_mode=True)
            ctx = AttemptCtx(task_type.value, prompt.name, prompt.hash, project_id, task_id, trace_id, before)
            cid, resp = run_attempt(conn, self.providers[self.transport_for(st.provider)],
                                    self.keystore.get(self.transport_for(st.provider)) or "",
                                    st, req, ctx, bud)
            call_ids.append(cid)
            try:
                signals, payload = validate(resp.text)
            except ValueError:
                signals, payload = router.Signals(validators_passed=0.0, evidence_coverage=0.0), None
            failures += int(signals.validators_passed < 1.0)
            budget_ok = ledger.month_summary(conn)["settled"] < bud.monthly_cny
            d = router.decide(signals, attempt_on_model=attempt, validation_failures=failures, budget_ok=budget_ok,
                              at_max_level=at_max, policy=pol)
            self._record_after(conn, cid, st, resp.input_tokens, resp.output_tokens, signals, d, escalated)
            if d.action == "accept":
                labels = [] if d.confidence >= pol.high else ["below_high_threshold"]
                return GatewayResult(payload, resp.text, st.alias, st.provider, st.model_id, list(call_ids), d,
                                     escalated, labels)
            if d.action == "fail":
                raise GatewayError(422, "ai_output_rejected", d.reason, details={"call_ids": call_ids})
            if d.action == "escalate":
                return None
        return None

    @staticmethod
    def _record_after(conn: sqlite3.Connection, cid: str, st: catalog.AliasStatus, tin: int, tout: int,
                      s: router.Signals, d: router.Decision, escalated: bool) -> None:
        after = {"model_used": st.model_id, "input_tokens": tin, "output_tokens": tout,
                 "validation_passed": s.validators_passed == 1.0, "confidence_after_call": d.confidence,
                 "components": d.components, "decision": d.action, "reason": d.reason, "escalated": escalated}
        with tx(conn):
            conn.execute("UPDATE model_calls SET routing_after=? WHERE id=?", (jdump(after), cid))
