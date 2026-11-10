"""W6 hypothesis (minimal): on a CONFIRMED plan only; status set by the user only (4 values, history kept);
comparison shows paper value + page vs log value / 日志未记录 / 无论文依据; numbers not on the cited page -> 需确认."""
from __future__ import annotations

from .conftest import Client
from .test_mobile_api import _log, paper  # noqa: F401  (fixture)

URL = "/api/v1/mobile/hypotheses"


def _confirmed_plan(client: Client, paper: str, extra: str | None = None) -> dict:  # noqa: F811
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    if extra:
        edits = [{"id": i["id"], "category": i["category"], "text": i["text"]} for i in p["items"]]
        edits.append({"category": "controls", "text": extra})
        p = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": edits}).json()
    r = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert r.status_code == 200, r.text
    return r.json()


def test_hypothesis_needs_confirmed_plan(client: Client, paper: str) -> None:  # noqa: F811
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    r = client.post(URL, json={"plan_id": p["id"], "text": "x", "plan_item_ids": [p["items"][0]["id"]]})
    assert r.status_code == 409 and r.json()["code"] == "plan_not_confirmed"


def test_status_only_by_user_with_history(client: Client, paper: str) -> None:  # noqa: F811
    p = _confirmed_plan(client, paper)
    item = next(i for i in p["items"] if i.get("citation"))
    h = client.post(URL, json={"plan_id": p["id"], "text": "Filtering changes accuracy",
                               "plan_item_ids": [item["id"]]}).json()
    assert h["status"] == "pending" and h["status_label"] == "待验证" and h["history"] == []
    bad = client.post(f"{URL}/{h['id']}/status", json={"status": "proven"})
    assert bad.status_code == 422 and bad.json()["code"] == "bad_status"
    for s, label in (("supported", "支持"), ("refuted", "不支持"), ("insufficient", "证据不足")):
        h = client.post(f"{URL}/{h['id']}/status", json={"status": s}).json()
        assert h["status_label"] == label and h["status_set_at"]
    assert [x["to"] for x in h["history"]] == ["supported", "refuted", "insufficient"]
    assert all(x["at"] and x["device_id"] for x in h["history"])
    listed = client.get(URL, params={"plan_id": p["id"]}).json()
    assert [x["id"] for x in listed] == [h["id"]]


def test_compare_rows_page_not_recorded_and_no_paper(client: Client, paper: str) -> None:  # noqa: F811
    p = _confirmed_plan(client, paper, extra="Use a quiet room")
    cited = next(i for i in p["items"] if i.get("citation") and "Hz" in i["citation"]["quote"])
    user = next(i for i in p["items"] if i["source"] == "user")
    h = client.post(URL, json={"plan_id": p["id"], "text": "Sampling rate matters",
                               "plan_item_ids": [cited["id"], user["id"]]}).json()
    lg = _log(client, text="[SAMPLE] nothing measured today", kind="text")
    out = client.post(f"{URL}/{h['id']}/compare", json={"log_ids": [lg["id"]]}).json()
    a, b = out["comparison"]["rows"]
    assert a["page_number"] >= 1 and a["paper_value"] and a["label"] == "日志未记录"
    assert b["label"] == "无论文依据" and b["page_number"] is None
    lg2 = _log(client, text="[SAMPLE] Recorded at 128 Hz", kind="text")
    out = client.post(f"{URL}/{h['id']}/compare", json={"log_ids": [lg2["id"]]}).json()
    assert out["comparison"]["rows"][0]["log_values"][0]["value"].endswith("Hz")
    assert out["status"] == "pending"  # comparing never sets a status


def test_numbers_not_on_cited_page_need_confirmation(client: Client, paper: str) -> None:  # noqa: F811
    p = _confirmed_plan(client, paper)
    item = next(i for i in p["items"] if i.get("citation"))
    h = client.post(URL, json={"plan_id": p["id"], "text": "Accuracy rises above 97531",
                               "plan_item_ids": [item["id"]]}).json()
    assert h["number_check"]["state"] == "needs_confirmation" and h["number_check"]["label"] == "需确认"
    assert "97531" in h["number_check"]["missing"]
    r = client.post(URL, json={"plan_id": p["id"], "text": "x", "plan_item_ids": ["nope"]})
    assert r.status_code == 404
