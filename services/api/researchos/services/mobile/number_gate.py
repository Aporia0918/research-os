"""Numbers-and-citation gate (W6 1.11): a plan item that carries a number cannot count as confirmed evidence unless
every number in it is found verbatim in the quote of its page citation. Otherwise (user-added item, edited number,
or a model-written value that is not on the cited page) the item is needs_confirmation ("需确认") and the user must
confirm_match (take it as their own value / accept the source) or reject_match, the same semantics as the citation
tri-state and weak predict matches. Confirming a plan with an open item is 409 citation_gate_open. Deterministic,
no model; a reference for the user, who decides (辅助定位原文、由你判断).
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import utcnow
from ...kernel.events import emit

DECISIONS = ("confirm_match", "reject_match")
_NUM = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\d])")


def numbers(text: str) -> list[str]:
    return _NUM.findall(text or "")


def missing_numbers(text: str, quote: str | None) -> list[str]:
    """Numbers of text that are not found as whole numbers in the quote (all of them when there is no quote)."""
    have = set(numbers(" ".join((quote or "").split())))
    return [n for n in dict.fromkeys(numbers(text)) if n not in have]


def tag(item: dict[str, Any], prev: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {k: v for k, v in item.items() if k != "number_gate"}
    if not numbers(str(item.get("text", ""))):
        return out
    quote = (item.get("citation") or {}).get("quote")
    miss = missing_numbers(str(item["text"]), quote)
    if not miss:
        out["number_gate"] = {"state": "ok", "missing": []}
        return out
    keep = (prev or {}).get("number_gate") or {}
    if prev is not None and prev.get("text") == item.get("text") and keep.get("state") in DECISIONS:
        out["number_gate"] = keep
        return out
    why = "no paper citation" if not quote else "not found verbatim on the cited page"
    out["number_gate"] = {"state": "needs_confirmation", "missing": miss, "label": "需确认",
                          "reason": f"number(s) {', '.join(miss)}: {why}; 辅助参考, 由你判断"}
    return out


def open_items(items: list[dict[str, Any]]) -> list[str]:
    return [i["id"] for i in items if (i.get("number_gate") or {}).get("state") == "needs_confirmation"]


def require_closed(items: list[dict[str, Any]]) -> None:
    if open_items(items):
        raise ApiError(409, "citation_gate_open",
                       "every number without a matching quote on its page needs your confirm or reject first")


def decide(conn: sqlite3.Connection, *, r: dict[str, Any], device_id: str, actor: str, item_id: str,
           decision: str) -> None:
    if r["state"] != "draft":
        raise ApiError(409, "plan_confirmed", "a confirmed plan can no longer be edited")
    if decision not in DECISIONS:
        raise ApiError(422, "bad_decision", "decision must be confirm_match or reject_match")
    items = json.loads(r["items_json"])
    hit = next((i for i in items if i["id"] == item_id), None)
    if hit is None:
        raise ApiError(404, "not_found", "plan item not found")
    gate = hit.get("number_gate") or {}
    if gate.get("state") in (None, "ok"):
        raise ApiError(422, "not_gated", "this item has no number that needs your confirmation")
    now = utcnow()
    hit["number_gate"] = {**gate, "state": decision, "decided_at": now, "device_id": device_id}
    conn.execute("UPDATE mobile_plans SET items_json=?, updated_at=? WHERE id=?", (json.dumps(items), now, r["id"]))
    emit(conn, "mobile_plan.number_decided", actor=actor, entity_type="mobile_plan", entity_id=r["id"],
         data={"item_id": item_id, "decision": decision, "decided_at": now})
