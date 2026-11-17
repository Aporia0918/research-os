"""Null-world exams as tasks: they wait for approval, run only inside read roots and store the report as the result.
The read-only detect route guesses the columns for the person to confirm."""

from __future__ import annotations

import runpy
import shutil
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from researchos.kernel.config import Settings
from researchos.services.container import Services
from researchos.services.effects import roots

from .conftest import Client
from .m1_helpers import drain

DEMO = Path(__file__).resolve().parents[1] / "examples" / "nullworld"


@pytest.fixture
def demo(tmp_path: Path, conn: sqlite3.Connection, settings: Settings) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    for f in ("_knn.py", "leaky.py"):
        shutil.copy(DEMO / f, root / f)
    runpy.run_path(str(DEMO / "make_data.py"))["write_demo"](root / "ecg_features.csv")
    roots.set_roots(conn, settings.data_dir, [{"path": str(root), "access": "read"}], "owner")
    return root


def _payload(demo: Path, **kw: Any) -> dict[str, Any]:
    return {
        "script": str(demo / "leaky.py"),
        "data": str(demo / "ecg_features.csv"),
        "group": "subject",
        "label": "af",
        **kw,
    }


def _approve(client: Client, task_id: str) -> None:
    h = client.get("/api/v1/approvals/subject-hash", params={"subject_type": "task", "subject_id": task_id}).json()
    r = client.post(
        "/api/v1/approvals", json={"subject_type": "task", "subject_id": task_id, "expected_hash": h["hash"]}
    )
    assert r.status_code == 201, r.text


def _run(client: Client, conn: sqlite3.Connection, svc: Services, kind: str, payload: dict[str, Any]) -> Any:
    t = client.post("/api/v1/tasks", json={"kind": kind, "payload": payload}).json()
    assert t["state"] == "awaiting_approval"
    assert drain(conn, svc) == 0  # nothing runs before the owner approves
    _approve(client, t["id"])
    drain(conn, svc)
    return client.get(f"/api/v1/tasks/{t['id']}").json()


def test_exam_task_waits_for_approval_and_fails_the_leaky_demo(
    client: Client, conn: sqlite3.Connection, svc: Services, demo: Path
) -> None:
    t = _run(client, conn, svc, "nullworld.exam", _payload(demo, runs=19))
    assert t["state"] == "succeeded", t
    assert t["result"]["verdict"]["outcome"] == "fail" and len(t["result"]["nulls"]) == 19


def test_power_task_reports_rows(client: Client, conn: sqlite3.Connection, svc: Services, demo: Path) -> None:
    t = _run(client, conn, svc, "nullworld.power", _payload(demo, runs=5, effects=[1.2]))
    assert t["state"] == "succeeded", t
    assert [r["effect"] for r in t["result"]["rows"]] == [1.2] and t["result"]["rows"][0]["runs"] == 5


def test_paths_outside_read_roots_never_run(
    client: Client, conn: sqlite3.Connection, svc: Services, demo: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    shutil.copy(demo / "leaky.py", outside / "leaky.py")
    t = _run(client, conn, svc, "nullworld.exam", _payload(demo, script=str(outside / "leaky.py")))
    assert t["state"] == "failed" and t["error_code"] == "outside_roots", t


def test_payload_is_checked_before_approval(client: Client, demo: Path) -> None:
    r = client.post("/api/v1/tasks", json={"kind": "nullworld.exam", "payload": _payload(demo, runs=3)})
    assert r.status_code == 422 and r.json()["code"] == "invalid_payload"
    r = client.post("/api/v1/tasks", json={"kind": "nullworld.exam", "payload": _payload(demo, shell="rm -rf /")})
    assert r.status_code == 422


def test_allow_reaches_the_exam_and_is_part_of_what_is_approved(
    client: Client, conn: sqlite3.Connection, svc: Services, demo: Path
) -> None:
    import csv

    data = demo / "ecg_features.csv"
    rows = list(csv.DictReader(data.open(newline="")))
    with data.open("w", newline="") as f:
        w = csv.DictWriter(f, [*rows[0], "af_flag"])
        w.writeheader()
        w.writerows({**r, "af_flag": r["af"]} for r in rows)

    plain = _run(client, conn, svc, "nullworld.exam", _payload(demo, runs=19))
    assert [s["column"] for s in plain["result"]["suspects"]] == ["af_flag"]
    vouched = _run(client, conn, svc, "nullworld.exam", _payload(demo, runs=19, allow=["af_flag"]))
    assert vouched["payload"]["allow"] == ["af_flag"] and vouched["result"]["suspects"] == []
    r = client.post("/api/v1/tasks", json={"kind": "nullworld.exam", "payload": _payload(demo, allow=["a", "a"])})
    assert r.status_code == 422


def test_detect_guesses_columns_inside_read_roots_only(client: Client, demo: Path, tmp_path: Path) -> None:
    r = client.post("/api/v1/null-world/detect", json={"data": str(demo / "ecg_features.csv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["groups"][0]["column"] == "subject" and body["labels"][0]["column"] == "af"
    assert body["features"] == ["rr", "morph"] and body["rows"] > 0
    outside = tmp_path / "elsewhere.csv"
    shutil.copy(demo / "ecg_features.csv", outside)
    r = client.post("/api/v1/null-world/detect", json={"data": str(outside)})
    assert r.status_code >= 400 and r.json()["code"] == "outside_roots"
