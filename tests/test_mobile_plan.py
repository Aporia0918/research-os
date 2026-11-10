"""mobile-plan: pre-experiment plan drafted from method text; every paper item has a page citation proven by the
Evidence write path; draft -> confirmed with a timestamp; edits only while draft; owner scope."""
from __future__ import annotations

import sqlite3

from .conftest import Client
from .test_mobile_api import paper  # noqa: F401  (fixture)


def _draft(client: Client, vid: str) -> dict:
    r = client.post("/api/v1/mobile/plans", json={"version_id": vid})
    assert r.status_code == 201, r.text
    return r.json()


def test_draft_has_cited_items_in_all_categories(client: Client, paper: str, conn: sqlite3.Connection) -> None:  # noqa: F811
    p = _draft(client, paper)
    assert p["state"] == "draft" and p["method"] == "deterministic" and p["confirmed_at"] is None
    assert p["status"] == "ok"
    cats = {i["category"] for i in p["items"]}
    assert {"variables", "controls"} <= cats
    for i in p["items"]:
        c = i["citation"]
        assert c["page_number"] == 2
        e = conn.execute("SELECT quote, page_index FROM evidence WHERE id=?", (c["evidence_id"],)).fetchone()
        assert e is not None and e[0] == c["quote"]
    assert any("1-40 Hz" in i["text"] for i in p["items"] if i["category"] == "variables")
    assert any("baseline" in i["citation"]["quote"] for i in p["items"] if i["category"] == "controls")


def test_edit_then_confirm_then_locked(client: Client, paper: str) -> None:  # noqa: F811
    p = _draft(client, paper)
    first = p["items"][0]
    items = [{"id": first["id"], "category": first["category"], "text": "edited text"},
             {"category": "materials", "text": "64-channel cap (own lab)"}]
    r = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": items})
    assert r.status_code == 200, r.text
    got = r.json()["items"]
    assert got[0]["edited"] and got[0]["citation"] == first["citation"]
    assert got[1]["source"] == "user" and got[1]["citation"] is None
    assert got[1]["number_gate"]["state"] == "needs_confirmation"  # 64 has no paper source (W6 1.11 gate)
    n = client.post(f"/api/v1/mobile/plans/{p['id']}/items/{got[1]['id']}/number", json={"decision": "confirm_match"})
    assert n.status_code == 200, n.text
    c = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert c.status_code == 200 and c.json()["state"] == "confirmed" and c.json()["confirmed_at"]
    again = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm").json()
    assert again["confirmed_at"] == c.json()["confirmed_at"]
    r = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": items})
    assert r.status_code == 409 and r.json()["code"] == "plan_confirmed"


def test_bad_item_and_missing_plan(client: Client, paper: str) -> None:  # noqa: F811
    p = _draft(client, paper)
    r = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": [{"category": "x", "text": "y"}]})
    assert r.status_code == 422
    assert client.get("/api/v1/mobile/plans/mplan_nope").status_code == 404
    assert client.get(f"/api/v1/mobile/plans/{p['id']}").json()["id"] == p["id"]


def test_use_model_without_key_falls_back(client: Client, paper: str) -> None:  # noqa: F811
    r = client.post("/api/v1/mobile/plans", json={"version_id": paper, "use_model": True})
    assert r.status_code == 201 and r.json()["method"] == "deterministic_fallback"
