"""讲给我听 storage: one session per entry, rounds append-only. The grading itself is explain.py (pure).

A session never touches mind_attempts: it happens with the AI's answer just read, so it says how well the student
followed, not what they can do alone. At its end it sets the debt's weight (hints cost debt), its first FSRS rating
and, when the student could not explain it, red (讲不出来), which puts it first on the phone.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from datetime import date
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import new_id, row, utcnow
from ...kernel.events import emit
from . import explain, rules
from .store import get


def points(conn: sqlite3.Connection, user_id: str, entry_id: str) -> list[explain.Point]:
    """The points a session grades against: stored once it has started, else split from the AI's answer."""
    s = _session(conn, user_id, entry_id)
    if s is not None:
        return [explain.Point(**p) for p in json.loads(s["points"])]
    e = get(conn, user_id, entry_id)
    if not e["answer"].strip():
        raise ApiError(409, "no_reference", "this entry has no AI answer to explain")
    return explain.points_of(e["question"], e["answer"])


def _session(conn: sqlite3.Connection, user_id: str, entry_id: str) -> dict[str, Any] | None:
    return row(conn.execute("SELECT * FROM mind_explains WHERE entry_id=? AND user_id=?", (entry_id, user_id)))


def _open(conn: sqlite3.Connection, user_id: str, entry_id: str) -> dict[str, Any]:
    s = _session(conn, user_id, entry_id)
    if s is None:
        pts = points(conn, user_id, entry_id)
        conn.execute("INSERT INTO mind_explains(entry_id,user_id,points,states,created_at) VALUES (?,?,?,?,?)",
                     (entry_id, user_id, json.dumps([p.__dict__ for p in pts], ensure_ascii=False),
                      json.dumps(["more"] * len(pts)), utcnow()))
        s = _session(conn, user_id, entry_id)
        assert s is not None
    if s["result"]:
        raise ApiError(409, "explain_finished", "this explanation is already finished")
    return s


def round_(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str, text: str, now: Sequence[str],
           today: date, exam: date | None = None) -> dict[str, Any]:
    """Record one round, graded beforehand (`now`, one state per point), and say what comes next."""
    s = _open(conn, user_id, entry_id)
    states = explain.merge(json.loads(s["states"]), now)
    asked, rounds = json.loads(s["asked"]), s["rounds"] + 1
    conn.execute("INSERT INTO mind_explain_rounds(id,entry_id,round,text,states,created_at) VALUES (?,?,?,?,?,?)",
                 (new_id("mexr"), entry_id, rounds, text, json.dumps(list(now)), utcnow()))
    nxt = None if all(x == "ok" for x in states) else explain.next_point(states, asked, rounds)
    if nxt is not None:
        asked.append(nxt)
    conn.execute("UPDATE mind_explains SET states=?, asked=?, rounds=? WHERE entry_id=?",
                 (json.dumps(states), json.dumps(asked), rounds, entry_id))
    if nxt is None:
        return _finish(conn, user_id, actor, entry_id, today, exam)
    pts = [explain.Point(**p) for p in json.loads(s["points"])]
    return {**_view(pts, states, rounds), "ask": explain.follow_up(pts[nxt], states[nxt]), "asking": nxt}


def hint(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str) -> dict[str, Any]:
    """One level more help on the point being asked (or the first one not said yet). Hints cost debt at the end."""
    s = _open(conn, user_id, entry_id)
    states, asked = json.loads(s["states"]), json.loads(s["asked"])
    at = asked[-1] if asked else next((i for i, x in enumerate(states) if x != "ok"), 0)
    level = min(s["hint"] + 1, explain.MAX_HINT)
    said = "，".join(t for (t,) in conn.execute("SELECT text FROM mind_explain_rounds WHERE entry_id=?", (entry_id,)))
    conn.execute("UPDATE mind_explains SET hint=? WHERE entry_id=?", (level, entry_id))
    emit(conn, "mindledger.explain_hint", actor=actor, entity_type="mind_entry", entity_id=entry_id,
         data={"level": level})
    pt = explain.Point(**json.loads(s["points"])[at])
    return {"level": level, "point": at, "text": explain.hint(pt, level, said),
            "help_level": explain.HINT_HELP[level]}


def _finish(conn: sqlite3.Connection, user_id: str, actor: str, entry_id: str, today: date,
            exam: date | None) -> dict[str, Any]:
    e = dict(conn.execute("SELECT * FROM mind_entries WHERE id=?", (entry_id,)).fetchone())
    s = _session(conn, user_id, entry_id)
    assert s is not None
    states = json.loads(s["states"])
    result, w, rating = explain.settle(e["help_level"], bool(e["own_idea"].strip()), states, s["rounds"], s["hint"])
    w = max(filter(None, (e["weight"], w)), key=rules.WEIGHTS.index, default=None)
    due = e["due_on"]
    if w != e["weight"] and w and not e["passes"] and not e["kind"]:  # heavier now: the first repayment comes sooner
        nd = rules.next_due(w, 0, date.fromisoformat(e["created_on"]), exam)
        due = nd.isoformat() if nd else None
    conn.execute("UPDATE mind_explains SET result=?, finished_at=? WHERE entry_id=?", (result, utcnow(), entry_id))
    conn.execute("UPDATE mind_entries SET weight=?, due_on=?, first_rating=?, red=? WHERE id=?",
                 (w, due, rating, int(result == "failed" or bool(e["red"])), entry_id))
    emit(conn, "mindledger.explained", actor=actor, entity_type="mind_entry", entity_id=entry_id,
         data={"result": result, "rounds": s["rounds"], "hint": s["hint"], "weight": w})
    pts = [explain.Point(**p) for p in json.loads(s["points"])]
    view = _view(pts, states, s["rounds"])
    for v, p in zip(view["points"], pts, strict=True):
        v["text"] = p.text  # finished: now the student sees what each point was
    return {**view, "done": True, "result": result, "weight": w, "first_rating": rating, "due_on": due,
            "red": result == "failed"}


def _view(pts: Sequence[explain.Point], states: Sequence[str], rounds: int) -> dict[str, Any]:
    return {"round": rounds, "done": False, "points": [{"type": p.type, "state": explain.shown(x)}
                                                        for p, x in zip(pts, states, strict=True)]}
