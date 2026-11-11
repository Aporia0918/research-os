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
_PUBLIC = ("id", "client_id", "source", "topic", "question", "answer", "own_idea", "help_level", "weight", "passes",
           "due_on", "created_on", "created_at")


@dataclass(frozen=True)
class NewEntry:
    client_id: str
    question: str
    help_level: str
    answer: str = ""
    own_idea: str = ""
    topic: str = ""
    source: str = "app"


def public(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r[k] for k in _PUBLIC}


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
    try:
        w = rules.weight(e.help_level, thought_first=bool(e.own_idea.strip()))
    except ValueError as err:
        raise ApiError(422, "bad_help_level", str(err)) from err
    prior = row(conn.execute("SELECT * FROM mind_entries WHERE user_id=? AND client_id=?", (user_id, e.client_id)))
    if prior is not None:
        return False, public(prior)
    due = rules.next_due(w, 0, today, exam) if w else None
    eid = new_id("mind")
    conn.execute(
        "INSERT INTO mind_entries(id,user_id,client_id,source,topic,question,answer,own_idea,help_level,weight,"
        "due_on,created_on,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (eid, user_id, e.client_id, e.source, e.topic.strip(), e.question.strip(), e.answer, e.own_idea,
         e.help_level, w, due.isoformat() if due else None, today.isoformat(), utcnow()))
    emit(conn, "mindledger.entry_created", actor=actor, entity_type="mind_entry", entity_id=eid,
         data={"help_level": e.help_level, "weight": w, "source": e.source})
    return True, get(conn, user_id, eid)


def get(conn: sqlite3.Connection, user_id: str, entry_id: str) -> dict[str, Any]:
    r = row(conn.execute("SELECT * FROM mind_entries WHERE id=? AND user_id=?", (entry_id, user_id)))
    if r is None:
        raise ApiError(404, "entry_not_found", "entry not found")
    return public(r)


def due(conn: sqlite3.Connection, user_id: str, today: date) -> list[dict[str, Any]]:
    """Repayments due today or overdue, heaviest debt first. The reference answer is withheld until graded."""
    order = "CASE weight WHEN 'heavy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END"
    return [{k: v for k, v in public(r).items() if k != "answer"} for r in rows(conn.execute(
        f"SELECT * FROM mind_entries WHERE user_id=? AND due_on IS NOT NULL AND due_on<=? ORDER BY due_on, {order}",
        (user_id, today.isoformat())))]


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
    conn.execute("UPDATE mind_entries SET passes=?, due_on=? WHERE id=?",
                 (passes, nxt.isoformat() if nxt else None, entry_id))
    emit(conn, "mindledger.repaid" if g.passed else "mindledger.repay_failed", actor=actor, entity_type="mind_entry",
         entity_id=entry_id, data={"method": g.method, "hits": len(g.hits), "points": len(g.points)})
    missed = [p for i, p in enumerate(g.points) if i not in g.hits]
    return {"passed": g.passed, "method": g.method, "points": g.points, "hits": g.hits, "missed": missed,
            "answer": e["answer"], "next_due": nxt.isoformat() if nxt else None, "settled": nxt is None}


def report(conn: sqlite3.Connection, user_id: str, today: date, exam: date, topic: str | None = None) -> dict[str, Any]:
    """考前真实掌握度报告: independence from no-AI attempts only, plus what to repay before the exam, in order."""
    q, args = "SELECT * FROM mind_entries WHERE user_id=?", [user_id]
    if topic:
        q, args = q + " AND topic=?", [*args, topic]
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
    return {"exam": exam.isoformat(), "as_of": today.isoformat(), "topic": topic, "total": len(items),
            "counts": counts, "independence": rules.independence(i["status"] for i in items),
            "repay_before_exam": todo, "not_reachable_before_exam": later}
