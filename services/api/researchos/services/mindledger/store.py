"""思维账本 storage. Owner-scoped by user_id; (user_id, client_id) makes offline and extension retries idempotent."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import new_id, row, rows, utcnow
from ...kernel.events import emit
from . import rules
from .judge import Grade

MAX_TEXT = 8000
SOURCES = ("app", "extension", "manual")
BOARDS = ("学习", "科研", "生活")
KINDS = ("conclusion", "citation")  # 结论债 (repaid by the null-world exam), 引用债 (repaid by finding the original)
_PUBLIC = ("id", "client_id", "source", "board", "kind", "topic", "question", "answer", "own_idea", "help_level",
           "weight", "passes", "due_on", "created_on", "created_at", "used_in", "red", "dropped_on")


@dataclass(frozen=True)
class NewEntry:
    client_id: str
    question: str
    help_level: str
    answer: str = ""
    own_idea: str = ""
    topic: str = ""
    source: str = "app"
    board: str = "学习"
    kind: str | None = None
    used_in: str = ""


def public(r: dict[str, Any]) -> dict[str, Any]:
    out = {k: r[k] for k in _PUBLIC}
    out["red"] = bool(r["red"])
    return out


def _day(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def create(conn: sqlite3.Connection, user_id: str, actor: str, e: NewEntry, today: date,
           exam: date | None = None) -> tuple[bool, dict[str, Any]]:
    if e.source not in SOURCES:
        raise ApiError(422, "bad_source", f"source must be one of {SOURCES}")
    if not e.question.strip():
        raise ApiError(422, "empty_question", "an entry needs the question")
    if any(len(x) > MAX_TEXT for x in (e.question, e.answer, e.own_idea)):
        raise ApiError(422, "text_too_long", f"text limit is {MAX_TEXT} characters")
    if e.board not in BOARDS or (e.kind is not None and e.kind not in KINDS):
        raise ApiError(422, "bad_board", f"board must be one of {BOARDS}, kind one of {KINDS}")
    try:
        w = rules.weight(e.help_level, thought_first=bool(e.own_idea.strip()))
    except ValueError as err:
        raise ApiError(422, "bad_help_level", str(err)) from err
    if e.kind:  # a conclusion or citation the user did not check is always heavy and due now (as on the phone)
        w = "heavy"
    prior = row(conn.execute("SELECT * FROM mind_entries WHERE user_id=? AND client_id=?", (user_id, e.client_id)))
    if prior is not None:
        return False, public(prior)
    due = (today if e.kind else rules.next_due(w, 0, today, exam)) if w else None
    eid = new_id("mind")
    conn.execute(
        "INSERT INTO mind_entries(id,user_id,client_id,source,board,kind,topic,question,answer,own_idea,help_level,"
        "weight,due_on,created_on,created_at,used_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (eid, user_id, e.client_id, e.source, e.board, e.kind, e.topic.strip(), e.question.strip(), e.answer,
         e.own_idea, e.help_level, w, due.isoformat() if due else None, today.isoformat(), utcnow(), e.used_in.strip()))
    emit(conn, "mindledger.entry_created", actor=actor, entity_type="mind_entry", entity_id=eid,
         data={"help_level": e.help_level, "weight": w, "source": e.source})
    return True, get(conn, user_id, eid)


def get(conn: sqlite3.Connection, user_id: str, entry_id: str) -> dict[str, Any]:
    r = row(conn.execute("SELECT * FROM mind_entries WHERE id=? AND user_id=?", (entry_id, user_id)))
    if r is None:
        raise ApiError(404, "entry_not_found", "entry not found")
    return public(r)


def due(conn: sqlite3.Connection, user_id: str, today: date, board: str | None = None) -> list[dict[str, Any]]:
    """Repayments due today or overdue: red (讲不出来) first, then the earlier day, then the heavier debt. Dropped
    debts are gone. The reference answer is withheld until graded."""
    order = "red DESC, due_on, CASE weight WHEN 'heavy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END"
    q = "SELECT * FROM mind_entries WHERE user_id=? AND due_on IS NOT NULL AND due_on<=? AND dropped_on IS NULL"
    args = [user_id, today.isoformat()]
    if board:
        q, args = q + " AND board=?", [*args, board]
    found = rows(conn.execute(f"{q} ORDER BY {order}", args))
    return [{k: v for k, v in public(r).items() if k != "answer"} for r in found]


def mark(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str, *, red: bool | None = None,
         used_in: str | None = None, dropped_on: date | None = None) -> dict[str, Any]:
    """What changed on the phone after the entry was sent: 讲不出来, 用在哪里, 这个不用了 (off the schedule)."""
    get(conn, user_id, entry_id)
    sets: dict[str, Any] = {}
    if red is not None:
        sets["red"] = int(red)
    if used_in is not None:
        sets["used_in"] = used_in.strip()[:200]
    if dropped_on is not None:
        sets["dropped_on"] = dropped_on.isoformat()
    if sets:
        cols = ", ".join(f"{k}=?" for k in sets)
        conn.execute(f"UPDATE mind_entries SET {cols} WHERE id=?", (*sets.values(), entry_id))
        emit(conn, "mindledger.marked", actor=actor, entity_type="mind_entry", entity_id=entry_id,
             data={"fields": sorted(sets)})
    return get(conn, user_id, entry_id)


def add_recall(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str, *, claim: str, paper: str,
               page: int, quote: str) -> dict[str, Any]:
    """A recall found on the phone (the rules there checked the quote against the page). The same one twice is one."""
    get(conn, user_id, entry_id)
    prior = row(conn.execute("SELECT * FROM mind_recalls WHERE entry_id=? AND paper=? AND page=? AND quote=?",
                             (entry_id, paper, page, quote)))
    if prior is None:
        rid = new_id("mrec")
        conn.execute("INSERT INTO mind_recalls(id,entry_id,user_id,claim,paper,page,quote,created_at) "
                     "VALUES (?,?,?,?,?,?,?,?)", (rid, entry_id, user_id, claim, paper, page, quote, utcnow()))
        emit(conn, "mindledger.recalled", actor=actor, entity_type="mind_entry", entity_id=entry_id,
             data={"page": page})
        return dict(conn.execute("SELECT * FROM mind_recalls WHERE id=?", (rid,)).fetchone())
    return prior


def recalls(conn: sqlite3.Connection, user_id: str, state: str = "open") -> list[dict[str, Any]]:
    """召回单 for the computer: the recalled sentence, the AI answer it came from and where the user used it."""
    return rows(conn.execute(
        "SELECT r.id, r.entry_id, r.claim, r.paper, r.page, r.quote, r.state, r.created_at, e.board, e.topic, "
        "e.question, e.answer, e.used_in FROM mind_recalls r JOIN mind_entries e ON e.id=r.entry_id "
        "WHERE r.user_id=? AND r.state=? ORDER BY r.created_at DESC", (user_id, state)))


def settle_recall(conn: sqlite3.Connection, user_id: str, actor: str, recall_id: str, state: str,
                  today: date) -> dict[str, Any]:
    """接受: the debt opens again today (the paper's sentence is the new reference). 已看过: it just closes."""
    if state not in ("accepted", "dismissed"):
        raise ApiError(422, "bad_state", "state must be accepted or dismissed")
    r = row(conn.execute("SELECT * FROM mind_recalls WHERE id=? AND user_id=?", (recall_id, user_id)))
    if r is None:
        raise ApiError(404, "recall_not_found", "recall not found")
    conn.execute("UPDATE mind_recalls SET state=? WHERE id=?", (state, recall_id))
    if state == "accepted":
        conn.execute("UPDATE mind_entries SET answer=?, due_on=?, red=0, dropped_on=NULL WHERE id=?",
                     (r["quote"], today.isoformat(), r["entry_id"]))
    emit(conn, "mindledger.recall_settled", actor=actor, entity_type="mind_entry", entity_id=r["entry_id"],
         data={"state": state})
    return {**r, "state": state}


def record_attempt(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str, text: str, g: Grade,
                   today: date, exam: date | None = None) -> dict[str, Any]:
    e = get(conn, user_id, entry_id)
    if e["due_on"] is None:
        raise ApiError(409, "nothing_to_repay", "this entry has nothing left to repay")
    passes = e["passes"] + g.passed
    nxt = rules.next_due(e["weight"], passes, today, exam) if g.passed else rules.retry_due(today, exam)
    conn.execute("INSERT INTO mind_attempts(id,entry_id,user_id,text,points,hits,passed,method,attempted_on,"
                 "created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (new_id("matt"), entry_id, user_id, text, json.dumps(g.points, ensure_ascii=False), json.dumps(g.hits),
                  int(g.passed), g.method, today.isoformat(), utcnow()))
    conn.execute("UPDATE mind_entries SET passes=?, due_on=?, red=? WHERE id=?",
                 (passes, nxt.isoformat() if nxt else None, int(not g.passed), entry_id))
    emit(conn, "mindledger.repaid" if g.passed else "mindledger.repay_failed", actor=actor, entity_type="mind_entry",
         entity_id=entry_id, data={"method": g.method, "hits": len(g.hits), "points": len(g.points)})
    missed = [p for i, p in enumerate(g.points) if i not in g.hits]
    return {"passed": g.passed, "method": g.method, "points": g.points, "hits": g.hits, "missed": missed,
            "answer": e["answer"], "next_due": nxt.isoformat() if nxt else None, "settled": nxt is None}


def report(conn: sqlite3.Connection, user_id: str, today: date, exam: date, topic: str | None = None,
           board: str | None = None) -> dict[str, Any]:
    """考前真实掌握度报告: independence from no-AI attempts only, plus what to repay before the exam, in order.
    Optionally one course (topic) and one board (学习 for an exam, 科研 for a group meeting)."""
    q, args = "SELECT * FROM mind_entries WHERE user_id=? AND dropped_on IS NULL", [user_id]
    if topic:
        q, args = q + " AND topic=?", [*args, topic]
    if board:
        q, args = q + " AND board=?", [*args, board]
    entries = rows(conn.execute(q + " ORDER BY created_at", args))
    tried = dict(conn.execute("SELECT entry_id, COUNT(*) FROM mind_attempts WHERE user_id=? GROUP BY entry_id",
                              (user_id,)).fetchall())
    items = []
    for e in entries:
        st = rules.status(e["passes"], tried.get(e["id"], 0), e["weight"])
        due_on = _day(e["due_on"])
        items.append({"id": e["id"], "topic": e["topic"], "question": e["question"], "weight": e["weight"],
                      "status": st, "attempts": tried.get(e["id"], 0),
                      "due_on": rules.front_load(due_on, today, exam).isoformat() if due_on else None})
    counts = {s: sum(i["status"] == s for i in items) for s in ("own", "settled", "shaky", "untested")}
    todo = sorted((i for i in items if i["due_on"] and i["due_on"] < exam.isoformat()),
                  key=lambda i: (i["due_on"], -rules.WEIGHTS.index(i["weight"])))
    later = [i for i in items if i["due_on"] and i["due_on"] >= exam.isoformat()]
    return {"exam": exam.isoformat(), "as_of": today.isoformat(), "topic": topic, "board": board, "total": len(items),
            "counts": counts, "independence": rules.independence(i["status"] for i in items),
            "repay_before_exam": todo, "not_reachable_before_exam": later}
