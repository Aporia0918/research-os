"""Pushes to the owner's other devices (多设备推送): one row per device, fetched by that device; the phone asks when
the ledger opens or comes back to the front, the computer's page every minute. No third-party push service, so a
device that is off or away from the computer's network gets them the next time it asks."""
from __future__ import annotations

import sqlite3
from typing import Any

from ...kernel.db import new_id, rows, utcnow

KINDS = ("recall", "recall_settled", "entry", "used")
MAX_TEXT = 300


def fan_out(conn: sqlite3.Connection, user_id: str, from_device: str, kind: str, entity_id: str, text: str) -> int:
    """To every device of the owner that is not revoked, except the one the change came from."""
    if kind not in KINDS:
        raise ValueError(kind)
    devices = conn.execute("SELECT id FROM devices WHERE user_id=? AND revoked_at IS NULL AND id<>?",
                           (user_id, from_device)).fetchall()
    now = utcnow()
    conn.executemany("INSERT INTO device_pushes(id,user_id,device_id,kind,entity_id,text,created_at) "
                     "VALUES (?,?,?,?,?,?,?)",
                     [(new_id("push"), user_id, d[0], kind, entity_id, text[:MAX_TEXT], now) for d in devices])
    return len(devices)


def inbox(conn: sqlite3.Connection, device_id: str, limit: int = 50) -> list[dict[str, Any]]:
    return rows(conn.execute("SELECT id, kind, entity_id, text, created_at FROM device_pushes "
                             "WHERE device_id=? AND seen_at IS NULL ORDER BY created_at, id LIMIT ?",
                             (device_id, limit)))


def mark_seen(conn: sqlite3.Connection, device_id: str, ids: list[str]) -> int:
    marks = ",".join("?" * len(ids))
    cur = conn.execute(f"UPDATE device_pushes SET seen_at=? WHERE device_id=? AND seen_at IS NULL AND id IN ({marks})",
                       (utcnow(), device_id, *ids)) if ids else None
    return cur.rowcount if cur else 0
