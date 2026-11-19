"""思维账本 endpoints: record a borrow (app or browser extension), repay without AI, and the pre-exam report."""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...kernel.db import tx
from ...services.identity import pushes
from ...services.identity.sessions import Principal
from ...services.mindledger import explain, judge, semantic, session, store, uses
from ..deps import cid, db, idempotent, principal, services

router = APIRouter(prefix="/api/v1/mind-ledger", tags=["mind-ledger"])
TEXT = Field(default="", max_length=store.MAX_TEXT)


class EntryIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=store.MAX_TEXT)
    help_level: str
    answer: str = TEXT
    own_idea: str = TEXT
    topic: str = Field(default="", max_length=80)
    source: str = "app"
    board: str = "学习"
    kind: str | None = None
    used_in: str = Field(default="", max_length=200)
    exam: date | None = None


class MarkIn(BaseModel):
    red: bool | None = None
    used_in: str | None = Field(default=None, max_length=200)
    dropped_on: date | None = None


class RecallIn(BaseModel):
    claim: str = Field(min_length=1, max_length=store.MAX_TEXT)
    paper: str = Field(min_length=1, max_length=300)
    page: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=store.MAX_TEXT)


class SettleIn(BaseModel):
    state: str


class ExplainIn(BaseModel):
    text: str = Field(min_length=1, max_length=store.MAX_TEXT)
    exam: date | None = None


class AttemptIn(BaseModel):
    text: str = Field(min_length=1, max_length=store.MAX_TEXT)
    use_model: bool = True
    exam: date | None = None


@router.post("/entries", status_code=201)
def create_entry(data: EntryIn, request: Request, p: Principal = Depends(principal),
                 conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    e = store.NewEntry(**data.model_dump(exclude={"exam"}))

    def run() -> tuple[int, Any]:
        created, out = store.create(conn, p.user_id, p.actor, e, date.today(), data.exam)
        if created and e.source == "extension":  # 电脑借、手机还: a debt from the browser reaches the phone
            pushes.fan_out(conn, p.user_id, p.device_id, "entry", out["id"], e.question)
        return 201, {**out, "created": created}

    _, body = idempotent(request, conn, "mindledger.entries.create", data.model_dump(mode="json"), run)
    result: dict[str, Any] = body
    return result


@router.get("/due")
def due(board: str | None = Query(None, max_length=4), p: Principal = Depends(principal),
        conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    return store.due(conn, p.user_id, date.today(), board)


@router.patch("/entries/{entry_id}")
def mark(entry_id: str, data: MarkIn, p: Principal = Depends(principal),
         conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """讲不出来 / 用在哪里 / 这个不用了, sent by the phone after the entry. Sending the same again is harmless."""
    return store.mark(conn, p.user_id, p.actor, entry_id, red=data.red, used_in=data.used_in,
                      dropped_on=data.dropped_on)


@router.post("/entries/{entry_id}/recalls", status_code=201)
def add_recall(entry_id: str, data: RecallIn, p: Principal = Depends(principal),
               conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """A 召回单 from the phone; the owner's other devices get it pushed (the same one twice is pushed once)."""
    with tx(conn):
        before = conn.total_changes
        r = store.add_recall(conn, p.user_id, p.actor, entry_id, **data.model_dump())
        if conn.total_changes > before:
            pushes.fan_out(conn, p.user_id, p.device_id, "recall", r["id"], data.claim)
    return r


@router.get("/recalls")
def recalls(p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    """Open 召回单, newest first, with the answer they came from, where the user used it, and the paragraphs of the
    user's notes that use the recalled sentence (affected, marked yellow on the page)."""
    return [{**r, "affected": uses.affected(conn, r["claim"])} for r in store.recalls(conn, p.user_id)]


@router.post("/recalls/{recall_id}")
def settle_recall(recall_id: str, data: SettleIn, p: Principal = Depends(principal),
                  conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with tx(conn):
        r = store.settle_recall(conn, p.user_id, p.actor, recall_id, data.state, date.today())
        pushes.fan_out(conn, p.user_id, p.device_id, "recall_settled", recall_id, r["claim"])
    return r


@router.post("/entries/{entry_id}/explain")
def explain_round(entry_id: str, data: ExplainIn, request: Request, p: Principal = Depends(principal),
                  conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """讲给我听 right after 记一笔: one round of the student's explanation. Graded before the write transaction;
    the reply says which points are said (通过 / 需补充 / 待复核), the follow-up if any, and at the end the result."""
    pts = session.points(conn, p.user_id, entry_id)
    now = explain.judge_points([x.text for x in pts], data.text, semantic.matcher(),
                               ordered=any(x.type == "method" for x in pts))

    def run() -> tuple[int, Any]:
        return 200, session.round_(conn, p.user_id, p.actor, entry_id, data.text, now, date.today(), data.exam)

    _, body = idempotent(request, conn, f"mindledger.explain.{entry_id}", data.model_dump(mode="json"), run)
    result: dict[str, Any] = body
    return result


@router.post("/entries/{entry_id}/explain/hint")
def explain_hint(entry_id: str, request: Request, p: Principal = Depends(principal),
                 conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """One more level of help (0 names the gap, 3 gives the point); the level reached weighs on the debt."""
    def run() -> tuple[int, Any]:
        return 200, session.hint(conn, p.user_id, p.actor, entry_id)

    _, body = idempotent(request, conn, f"mindledger.explain_hint.{entry_id}", {}, run)
    result: dict[str, Any] = body
    return result


@router.post("/entries/{entry_id}/attempts")
def repay(entry_id: str, data: AttemptIn, request: Request, p: Principal = Depends(principal),
          conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Grade first (a model call must not sit inside the write transaction), then record append-only."""
    e = store.get(conn, p.user_id, entry_id)
    gw = services(request).gateway if data.use_model else None
    g = judge.grade(conn, gw, question=e["question"], reference=e["answer"] or e["question"], attempt=data.text,
                    weight=e["weight"], trace_id=cid(request))

    def run() -> tuple[int, Any]:
        return 200, store.record_attempt(conn, p.user_id, p.actor, entry_id, data.text, g, date.today(), data.exam)

    _, body = idempotent(request, conn, f"mindledger.attempts.{entry_id}", data.model_dump(mode="json"), run)
    result: dict[str, Any] = body
    return result


@router.get("/report")
def report(exam: date, topic: str | None = Query(None, max_length=80), board: str | None = Query(None, max_length=4),
           p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    return store.report(conn, p.user_id, date.today(), exam, topic, board)
