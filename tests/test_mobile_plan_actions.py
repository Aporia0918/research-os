"""W6 2.3: key actions (model call / data out / share) in a plan need the user's approve or reject before the plan can
be confirmed; the decision records time and device; 409 after confirm. Only a gate, nothing is run or sent."""
from __future__ import annotations

from researchos.services.mobile import plan_actions

from .conftest import Client
from .test_mobile_api import paper  # noqa: F401  (fixture)


def _plan_with_actions(client: Client, vid: str) -> dict:
    p = client.post("/api/v1/mobile/plans", json={"version_id": vid}).json()
    items = [{"category": "materials", "text": "Upload the raw EEG to the lab server"},
             {"category": "materials", "text": "Ask a cloud model (LLM) to label artifacts"},
             {"category": "controls", "text": "baseline window 200 ms"},
             {"category": "materials", "text": "notebook", "key_action": "share"}]
    r = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": items})
    assert r.status_code == 200, r.text
    return r.json()


def test_unapproved_key_action_blocks_confirm_then_approve_then_locked(client: Client, paper: str) -> None:  # noqa: F811
    p = _plan_with_actions(client, paper)
    kinds = [i.get("key_action") for i in p["items"]]
    assert kinds == ["send_data_out", "run_model_call", None, "share"]
    assert all(i["approval"]["state"] == "needs_approval" for i in p["items"] if i.get("key_action"))
    r = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert r.status_code == 409 and r.json()["code"] == "plan_action_unapproved"
    url = f"/api/v1/mobile/plans/{p['id']}/items/{{}}/approval"
    assert client.post(url.format(p["items"][2]["id"]), json={"decision": "approve"}).status_code == 422
    assert client.post(url.format(p["items"][0]["id"]), json={"decision": "maybe"}).status_code == 422
    assert client.post(url.format("pit_nope"), json={"decision": "approve"}).status_code == 404
    for i, d in ((0, "approve"), (1, "reject"), (3, "approve")):
        got = client.post(url.format(p["items"][i]["id"]), json={"decision": d})
        assert got.status_code == 200, got.text
        a = got.json()["items"][i]["approval"]
        assert a["state"] == ("approved" if d == "approve" else "rejected") and a["decided_at"] and a["device_id"]
    # merged W6: item 2 ("200 ms", no citation) is also behind the numbers gate; close it too
    num = f"/api/v1/mobile/plans/{p['id']}/items/{p['items'][2]['id']}/number"
    assert client.post(num, json={"decision": "confirm_match"}).status_code == 200
    c = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert c.status_code == 200 and c.json()["state"] == "confirmed"
    late = client.post(url.format(p["items"][1]["id"]), json={"decision": "approve"})
    assert late.status_code == 409 and late.json()["code"] == "plan_confirmed"


def test_edit_resets_approval_and_rules() -> None:
    first = plan_actions.tag({"id": "a", "text": "upload data"})
    assert first["approval"]["state"] == "needs_approval"
    done = {**first, "approval": {"state": "approved", "decided_at": "t", "device_id": "d"}}
    assert plan_actions.tag({"id": "a", "text": "upload data"}, None, done)["approval"]["state"] == "approved"
    assert plan_actions.tag({"id": "a", "text": "upload all data"}, None, done)["approval"]["state"] == "needs_approval"
    assert plan_actions.detect("band-pass 1-40 Hz") is None
    assert plan_actions.detect("结果分享给合作者") == "share"
