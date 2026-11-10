"""Android app endpoints: hypotheses on a confirmed plan (W6). The user sets every status; nothing is concluded."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...services.identity.sessions import Principal
from ...services.mobile import hypothesis as hyp
from ..deps import db, idempotent, principal

router = APIRouter(prefix="/api/v1/mobile", tags=["mobile"])


class MobileHypothesisIn(BaseModel):
    plan_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=hyp.MAX_TEXT)
    plan_item_ids: list[str] = Field(min_length=1, max_length=hyp.MAX_ITEMS)


class MobileHypothesisCompareIn(BaseModel):
    log_ids: list[str] = Field(min_length=1, max_length=hyp.MAX_LOGS)


class MobileHypothesisStatusIn(BaseModel):
    status: str = Field(min_length=1, max_length=20)


@router.post("/hypotheses", status_code=201)
def create_hypothesis(data: MobileHypothesisIn, request: Request, p: Principal = Depends(principal),
                      conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """A hypothesis on items of a CONFIRMED plan (409 plan_not_confirmed otherwise); status starts as pending."""
    def run() -> tuple[int, Any]:
        return 201, hyp.create(conn, user_id=p.user_id, actor=p.actor, plan_id=data.plan_id, text=data.text,
                               plan_item_ids=data.plan_item_ids)

    _, body = idempotent(request, conn, "mobile.hypotheses.create", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


@router.get("/hypotheses")
def list_hypotheses(plan_id: str = Query(min_length=1, max_length=64), p: Principal = Depends(principal),
                    conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    return hyp.list_for(conn, p.user_id, plan_id)


@router.post("/hypotheses/{hypothesis_id}/compare")
def compare_hypothesis(hypothesis_id: str, data: MobileHypothesisCompareIn, request: Request,
                       p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Paper value with page next to the log value (or 日志未记录 / 无论文依据). Side by side only."""
    def run() -> tuple[int, Any]:
        return 200, hyp.compare(conn, user_id=p.user_id, actor=p.actor, hid=hypothesis_id, log_ids=data.log_ids)

    _, body = idempotent(request, conn, "mobile.hypotheses.compare", {"id": hypothesis_id, **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result


@router.post("/hypotheses/{hypothesis_id}/status")
def set_hypothesis_status(hypothesis_id: str, data: MobileHypothesisStatusIn, request: Request,
                          p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """The user's choice: pending / supported / refuted / insufficient (422 otherwise), kept with history."""
    def run() -> tuple[int, Any]:
        return 200, hyp.set_status(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor,
                                   hid=hypothesis_id, status=data.status)

    _, body = idempotent(request, conn, "mobile.hypotheses.status", {"id": hypothesis_id, **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result
