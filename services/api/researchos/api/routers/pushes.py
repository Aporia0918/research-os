"""多设备推送: what changed on the owner's other devices (召回单, a settled one, a debt from the browser, a note that
uses an AI answer), for this device to show, then mark seen."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...services.identity import pushes
from ...services.identity.sessions import Principal
from ..deps import db, principal

router = APIRouter(prefix="/api/v1/pushes", tags=["pushes"])


class SeenIn(BaseModel):
    ids: list[str] = Field(max_length=100)


class SeenOut(BaseModel):
    seen: int


@router.get("")
def inbox(p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    return pushes.inbox(conn, p.device_id)


@router.post("/seen", response_model=SeenOut)
def seen(data: SeenIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> SeenOut:
    """Marking the same pushes seen again is harmless; another device's pushes are never touched."""
    return SeenOut(seen=pushes.mark_seen(conn, p.device_id, data.ids))
