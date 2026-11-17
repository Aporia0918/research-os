"""Experiment log entries from the phone. Owner-scoped (user_id); the phone's client_id makes offline-queue retries
idempotent even when a retry carries a new Idempotency-Key."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import new_id, row, rows, utcnow
from ...kernel.events import emit
from ..content.blobs import BlobStore

MAX_TEXT = 5000
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# declared MIME -> (kind, file extension, accepted leading magic bytes; empty = container formats not sniffed)
ALLOWED: dict[str, tuple[str, str, tuple[bytes, ...]]] = {
    "image/jpeg": ("photo", "jpg", (b"\xff\xd8\xff",)),
    "image/png": ("photo", "png", (b"\x89PNG",)),
    "image/webp": ("photo", "webp", (b"RIFF",)),
    "audio/aac": ("voice", "aac", (b"\xff\xf1", b"\xff\xf9", b"ID3")),
    "audio/mp4": ("voice", "m4a", ()),
    "audio/mpeg": ("voice", "mp3", (b"ID3", b"\xff\xfb", b"\xff\xf3")),
    "audio/webm": ("voice", "webm", (b"\x1a\x45\xdf\xa3",)),
    "audio/ogg": ("voice", "ogg", (b"OggS",)),
    "audio/wav": ("voice", "wav", (b"RIFF",)),
}


@dataclass
class Attachment:
    data: bytes
    mime: str


def _check_attachment(kind: str, att: Attachment) -> str:
    mime = att.mime.split(";")[0].strip().lower()
    spec = ALLOWED.get(mime)
    if spec is None:
        raise ApiError(415, "unsupported_attachment", f"attachment type must be one of {sorted(ALLOWED)}")
    if spec[0] != kind:
        raise ApiError(422, "kind_mismatch", f"a {mime} attachment needs kind '{spec[0]}'")
    if len(att.data) == 0:
        raise ApiError(422, "empty_attachment", "attachment is empty")
    if len(att.data) > MAX_ATTACHMENT_BYTES:
        raise ApiError(413, "attachment_too_large", f"attachment limit is {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB")
    if spec[2] and not any(att.data.startswith(m) for m in spec[2]):
        raise ApiError(422, "attachment_content_mismatch", f"file content does not look like {mime}")
    return spec[1]


def public(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r[k] for k in ("id", "client_id", "kind", "text", "captured_at", "attachment_mime", "attachment_size",
                              "attachment_sha256", "duration_ms", "created_at")}


def store_attachment(blobs: BlobStore, kind: str, att: Attachment | None) -> tuple[str, str] | None:
    """Validate + write the blob BEFORE the DB transaction (content-addressed, so a replay reuses the file)."""
    if att is None:
        return None
    ext = _check_attachment(kind, att)
    return blobs.put(att.data, ext)


def create_in_tx(conn: sqlite3.Connection, *, user_id: str, device_id: str, actor: str, client_id: str, kind: str,
                 text: str, captured_at: str | None, att: Attachment | None, blob: tuple[str, str] | None,
                 duration_ms: int | None) -> tuple[bool, dict[str, Any]]:
    if kind not in ("text", "photo", "voice"):
        raise ApiError(422, "bad_kind", "kind must be text, photo or voice")
    if len(text) > MAX_TEXT:
        raise ApiError(422, "text_too_long", f"text limit is {MAX_TEXT} characters")
    if kind != "text" and att is None:
        raise ApiError(422, "attachment_required", f"kind '{kind}' needs an attachment")
    if kind == "text" and not text.strip():
        raise ApiError(422, "empty_entry", "a text entry needs text")
    prior = row(conn.execute("SELECT * FROM mobile_logs WHERE user_id=? AND client_id=?", (user_id, client_id)))
    if prior is not None:
        return False, public(prior)
    lid = new_id("mlog")
    conn.execute(
        "INSERT INTO mobile_logs(id,user_id,device_id,client_id,kind,text,captured_at,attachment_path,attachment_mime,"
        "attachment_size,attachment_sha256,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (lid, user_id, device_id, client_id, kind, text, captured_at, blob[1] if blob else None,
         att.mime if att else None, len(att.data) if att else None, blob[0] if blob else None, duration_ms, utcnow()))
    emit(conn, "mobile_log.created", actor=actor, entity_type="mobile_log", entity_id=lid,
         data={"kind": kind, "has_attachment": att is not None})
    created = row(conn.execute("SELECT * FROM mobile_logs WHERE id=?", (lid,)))
    assert created is not None
    return True, public(created)


def get(conn: sqlite3.Connection, user_id: str, log_id: str) -> dict[str, Any]:
    r = row(conn.execute("SELECT * FROM mobile_logs WHERE id=? AND user_id=?", (log_id, user_id)))
    if r is None:
        raise ApiError(404, "not_found", "log entry not found")
    return r


def list_for(conn: sqlite3.Connection, user_id: str, limit: int) -> list[dict[str, Any]]:
    return [public(r) for r in rows(conn.execute(
        "SELECT * FROM mobile_logs WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (user_id, limit)))]
