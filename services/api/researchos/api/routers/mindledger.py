"""思维账本 endpoints: record a borrow (app or browser extension), repay without AI, and the pre-exam report."""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...services.identity.sessions import Principal
from ...services.mindledger import judge, store
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
        return 201, {**out, "created": created}

    _, body = idempotent(request, conn, "mindledger.entries.create", data.model_dump(mode="json"), run)
    result: dict[str, Any] = body
    return result


@router.get("/due")
def due(p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    return store.due(conn, p.user_id, date.today())


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
def report(exam: date, topic: str | None = Query(None, max_length=80), p: Principal = Depends(principal),
           conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    return store.report(conn, p.user_id, date.today(), exam, topic)
