"""Hypotheses on a CONFIRMED plan (W6 minimal version). The user writes a hypothesis and links it to plan items;
a comparison lists, per linked item, the paper value with its page next to the value found in the chosen log
entries (or 日志未记录); a user-added item without a citation shows 无论文依据. The status is set by the user only:
pending (待验证, default) / supported (支持) / refuted (不支持) / insufficient (证据不足). No model, no statistics,
no automatic conclusion; numbers in the hypothesis text that do not appear verbatim in a linked item's cited page
quote are marked 需确认 (W6 1.11 gate, hypothesis side). Everything here is 辅助参考; the user judges."""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import new_id, row, rows, utcnow
from ...kernel.events import emit
from . import logs
from .compare import extract_params
from .guidance import confirmed_plan

STATUSES = ("pending", "supported", "refuted", "insufficient")
STATUS_LABEL = {"pending": "待验证", "supported": "支持", "refuted": "不支持", "insufficient": "证据不足"}
MAX_TEXT = 500
MAX_ITEMS = 20
MAX_LOGS = 10
NOT_RECORDED = "日志未记录"
NO_PAPER = "无论文依据"
_NUM = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\d])")


def number_check(text: str, cited: list[dict[str, Any]]) -> dict[str, Any]:
    """Numbers in the hypothesis that are not found verbatim in any linked item's cited quote -> 需确认."""
    quotes = " ".join(i["citation"]["quote"] for i in cited if i.get("citation"))
    found = set(_NUM.findall(quotes))
    missing = [n for n in dict.fromkeys(_NUM.findall(text)) if n not in found]
    if not missing:
        return {"state": "ok", "missing": []}
    return {"state": "needs_confirmation", "label": "需确认", "missing": missing,
            "reason": "number not found verbatim on the cited page of a linked plan item"}


def _public(r: dict[str, Any]) -> dict[str, Any]:
    return {"id": r["id"], "plan_id": r["plan_id"], "text": r["text"],
            "plan_item_ids": json.loads(r["plan_item_ids_json"]), "status": r["status"],
            "status_label": STATUS_LABEL[r["status"]], "status_set_at": r["status_set_at"],
            "history": json.loads(r["history_json"]), "number_check": json.loads(r["number_check_json"]),
            "comparison": json.loads(r["comparison_json"]) if r["comparison_json"] else None,
            "created_at": r["created_at"], "updated_at": r["updated_at"]}


def _row(conn: sqlite3.Connection, user_id: str, hid: str) -> dict[str, Any]:
    r = row(conn.execute("SELECT * FROM mobile_hypotheses WHERE id=? AND user_id=?", (hid, user_id)))
    if r is None:
        raise ApiError(404, "not_found", "hypothesis not found")
    return r


def _items(plan: dict[str, Any], ids: list[str]) -> list[dict[str, Any]]:
    by_id = {i["id"]: i for i in plan["items"]}
    unknown = [i for i in ids if i not in by_id]
    if unknown:
        raise ApiError(404, "not_found", "plan item not found")
    return [by_id[i] for i in ids]


def create(conn: sqlite3.Connection, *, user_id: str, actor: str, plan_id: str, text: str,
           plan_item_ids: list[str]) -> dict[str, Any]:
    plan = confirmed_plan(conn, user_id, plan_id)
    text = " ".join(text.split())
    ids = list(dict.fromkeys(plan_item_ids))
    if not text or len(text) > MAX_TEXT or not ids or len(ids) > MAX_ITEMS:
        raise ApiError(422, "bad_hypothesis", "a hypothesis needs 1-500 characters of text and 1-20 plan items")
    items = _items(plan, ids)
    hid, now = new_id("mhyp"), utcnow()
    conn.execute("INSERT INTO mobile_hypotheses(id,user_id,plan_id,text,plan_item_ids_json,status,history_json,"
                 "number_check_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (hid, user_id, plan_id, text, json.dumps(ids), "pending", "[]",
                  json.dumps(number_check(text, items)), now, now))
    emit(conn, "mobile_hypothesis.created", actor=actor, entity_type="mobile_hypothesis", entity_id=hid,
         data={"items": len(ids)})
    return _public(_row(conn, user_id, hid))


def _row_for(item: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    cite = item.get("citation")
    if not cite:
        return {"plan_item_id": item["id"], "item_text": item["text"], "paper_value": None, "page_number": None,
                "label": NO_PAPER, "log_values": []}
    paper = extract_params(cite["quote"])
    units = {p.unit for p in paper}
    found = [{"log_id": e["id"], "value": p.raw} for e in entries for p in extract_params(e["text"])
             if p.unit in units]
    return {"plan_item_id": item["id"], "item_text": item["text"],
            "paper_value": ", ".join(p.raw for p in paper) or None, "page_number": cite["page_number"],
            "label": None if found else NOT_RECORDED, "log_values": found}


def compare(conn: sqlite3.Connection, *, user_id: str, actor: str, hid: str, log_ids: list[str]) -> dict[str, Any]:
    """Side by side only; nothing is concluded and the status does not change."""
    r = _row(conn, user_id, hid)
    plan = confirmed_plan(conn, user_id, r["plan_id"])
    entries = [logs.get(conn, user_id, i) for i in dict.fromkeys(log_ids)]
    items = _items(plan, json.loads(r["plan_item_ids_json"]))
    out = {"log_ids": [e["id"] for e in entries], "rows": [_row_for(i, entries) for i in items],
           "compared_at": utcnow()}
    conn.execute("UPDATE mobile_hypotheses SET comparison_json=?, updated_at=? WHERE id=?",
                 (json.dumps(out), out["compared_at"], hid))
    emit(conn, "mobile_hypothesis.compared", actor=actor, entity_type="mobile_hypothesis", entity_id=hid,
         data={"logs": len(entries)})
    return _public(_row(conn, user_id, hid))


def set_status(conn: sqlite3.Connection, *, user_id: str, device_id: str, actor: str, hid: str,
               status: str) -> dict[str, Any]:
    if status not in STATUSES:
        raise ApiError(422, "bad_status", "status must be pending, supported, refuted or insufficient")
    r = _row(conn, user_id, hid)
    now = utcnow()
    hist = json.loads(r["history_json"]) + [{"from": r["status"], "to": status, "at": now, "device_id": device_id}]
    conn.execute("UPDATE mobile_hypotheses SET status=?, status_set_at=?, status_set_by_device=?, history_json=?, "
                 "updated_at=? WHERE id=?", (status, now, device_id, json.dumps(hist), now, hid))
    emit(conn, "mobile_hypothesis.status_set", actor=actor, entity_type="mobile_hypothesis", entity_id=hid,
         data={"status": status})
    return _public(_row(conn, user_id, hid))


def list_for(conn: sqlite3.Connection, user_id: str, plan_id: str) -> list[dict[str, Any]]:
    return [_public(r) for r in rows(conn.execute(
        "SELECT * FROM mobile_hypotheses WHERE user_id=? AND plan_id=? ORDER BY created_at", (user_id, plan_id)))]
