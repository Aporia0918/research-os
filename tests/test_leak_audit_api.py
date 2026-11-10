"""Rule check endpoint (ADR-271): read-only, and a local script must lie inside the owner's read roots (ADR-155)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .conftest import Client
from .test_leak_audit_script import CLEAN, EXAMPLE_1


def _counts(conn: sqlite3.Connection) -> tuple[int, ...]:
    return tuple(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("plans", "tasks", "events"))


def test_script_audit_endpoint_is_read_only(client: Client, conn: sqlite3.Connection) -> None:
    before = _counts(conn)
    r = client.post("/api/v1/leak-audit/script", json={"source": EXAMPLE_1, "filename": "eeg.py"})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["status"] == "red" and rep["findings"][0]["code"] == "R1.random_split"
    assert rep["findings"][0]["line"] == 11 and rep["executed"] is False
    assert client.post("/api/v1/leak-audit/script", json={"source": CLEAN}).json()["status"] == "green"
    assert client.post("/api/v1/leak-audit/script", json={}).status_code == 422  # neither source nor path
    assert _counts(conn) == before  # nothing written


def test_script_from_a_read_root_only(client: Client, tmp_path: Path) -> None:
    folder = tmp_path / "user"  # the app's data dir is under tmp_path itself (a protected location)
    folder.mkdir()
    (folder / "train.py").write_text(EXAMPLE_1, encoding="utf-8")
    body = {"path": str(folder / "train.py")}
    assert client.post("/api/v1/leak-audit/script", json=body).status_code == 403
    r = client.put("/api/v1/settings/file-roots", json={"roots": [{"path": str(folder), "access": "read"}]})
    assert r.status_code == 200, r.text
    rep = client.post("/api/v1/leak-audit/script", json=body).json()
    assert rep["status"] == "red" and rep["file"] == "train.py"
