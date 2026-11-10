"""零世界考试 over HTTP. Only the read-only first step lives here: guess the group and label columns of a table
inside a read root, so the phone can ask the person to confirm them. Exams themselves run as approval-gated tasks
(kinds nullworld.exam and nullworld.power) through the generic tasks API."""

from __future__ import annotations

import sqlite3
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...contracts.errors import ApiError
from ...services.effects import roots
from ...services.identity.sessions import Principal
from ...services.nullworld import Table, TableError, detect
from ...services.nullworld.table import numeric_features
from ..deps import db, principal

router = APIRouter(prefix="/api/v1/null-world", tags=["null-world"])

MAX_BYTES = 50 * 1024 * 1024


class DetectIn(BaseModel):
    data: str = Field(min_length=1, max_length=1000)


@router.post("/detect")
def detect_columns(
    body: DetectIn, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, Any]:
    path = roots.resolve(conn, body.data, "read", must_exist=True)
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ApiError(422, "bad_input", "data must be a table file of at most 50 MB")
    try:
        table = Table.parse(path.read_bytes())
    except TableError as e:
        raise ApiError(422, "bad_input", str(e)) from e
    s = detect(table)
    group = s.groups[0].column if s.groups else None
    label = s.labels[0].column if s.labels else None
    return {
        "data": str(path),
        "rows": len(table.rows),
        "columns": list(table.header),
        "groups": [asdict(c) for c in s.groups],
        "labels": [asdict(c) for c in s.labels],
        "features": numeric_features(table, *(c for c in (group, label) if c)),
    }
