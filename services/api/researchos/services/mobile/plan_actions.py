"""Key actions in a pre-experiment plan need the user's approval before they take effect (W6 2.3).

A key action is a step that runs a model call, sends data off the device, or shares something. Such items are tagged
when a plan is drafted or edited (rule match on the item text, or the user's own tag) and start as needs_approval;
nothing here performs the action, this is only the approval gate. The user approves or rejects each one; the
decision records a UTC timestamp and the device id. Confirming a plan with an open key action is 409
plan_action_unapproved; changing a decision after the plan is confirmed is 409 plan_confirmed.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import utcnow
from ...kernel.events import emit

KEY_ACTIONS = ("run_model_call", "send_data_out", "share")
DECISIONS = ("approve", "reject")

_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("run_model_call", re.compile(r"\b(?:model call|call(?:ing)? (?:a|the) model|LLM|GPT|language model|"
                                  r"inference API|cloud model)\b|调用模型", re.I)),
    ("send_data_out", re.compile(r"\b(?:upload\w*|send\w* (?:the )?data|transmit\w*|sent to (?:a|the) server|"
                                 r"cloud storage|off[- ]device)\b|上传|外发|发送数据", re.I)),
    ("share", re.compile(r"\b(?:shar(?:e|ed|ing) (?:with|the|data|results?)|publish\w* (?:the )?data)\b|分享|共享",
                         re.I)),
)


def detect(text: str) -> str | None:
    for kind, rx in _RULES:
        if rx.search(text):
            return kind
    return None


def tag(item: dict[str, Any], user_kind: str | None = None, prev: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the item with key_action/approval set. An unchanged key action keeps its earlier decision; a changed
    text or kind starts over at needs_approval."""
    if user_kind is not None and user_kind not in KEY_ACTIONS:
        raise ApiError(422, "bad_key_action", "key_action must be run_model_call, send_data_out or share")
    kind = user_kind or detect(str(item.get("text", "")))
    if kind is None:
        return {k: v for k, v in item.items() if k not in ("key_action", "approval")}
    if prev is not None and prev.get("key_action") == kind and prev.get("text") == item.get("text"):
        return {**item, "key_action": kind, "approval": prev.get("approval")}
    return {**item, "key_action": kind,
            "approval": {"state": "needs_approval", "decided_at": None, "device_id": None}}


def unapproved(items: list[dict[str, Any]]) -> list[str]:
    return [i["id"] for i in items
            if i.get("key_action") and (i.get("approval") or {}).get("state") == "needs_approval"]


def require_all_decided(items: list[dict[str, Any]]) -> None:
    open_ids = unapproved(items)
    if open_ids:
        raise ApiError(409, "plan_action_unapproved",
                       "every key action (model call, data out, share) needs your approve or reject first")


def decide(conn: sqlite3.Connection, *, r: dict[str, Any], device_id: str, actor: str, item_id: str,
           decision: str) -> None:
    if r["state"] != "draft":
        raise ApiError(409, "plan_confirmed", "a confirmed plan can no longer be edited")
    if decision not in DECISIONS:
        raise ApiError(422, "bad_decision", "decision must be approve or reject")
    items = json.loads(r["items_json"])
    hit = next((i for i in items if i["id"] == item_id), None)
    if hit is None:
        raise ApiError(404, "not_found", "plan item not found")
    if not hit.get("key_action"):
        raise ApiError(422, "not_key_action", "only a key action needs approval")
    now = utcnow()
    hit["approval"] = {"state": "approved" if decision == "approve" else "rejected", "decided_at": now,
                       "device_id": device_id}
    conn.execute("UPDATE mobile_plans SET items_json=?, updated_at=? WHERE id=?", (json.dumps(items), now, r["id"]))
    emit(conn, "mobile_plan.action_decided", actor=actor, entity_type="mobile_plan", entity_id=r["id"],
         data={"item_id": item_id, "key_action": hit["key_action"], "decision": decision, "decided_at": now})
