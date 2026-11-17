"""mobile-predict: prediction and adjustment suggestions from a CONFIRMED plan + experiment log entries.
Deterministic, every suggestion cites a paper page; draft -> confirmed, 409 after."""
from __future__ import annotations

import sqlite3

from .conftest import Client
from .test_mobile_api import _log, paper  # noqa: F401  (fixture)


def test_predict_needs_confirmed_plan_cites_pages_and_locks(client: Client, paper: str,  # noqa: F811
                                                            conn: sqlite3.Connection) -> None:
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    a = _log(client, text="Sample data: band-pass filtered 1-30 Hz today", kind="text")
    b = _log(client, text="Sample data: filtered 1-40 Hz", kind="text")
    body = {"plan_id": p["id"], "log_ids": [a["id"], b["id"]]}
    r = client.post("/api/v1/mobile/guidance/predict", json=body)
    assert r.status_code == 409 and r.json()["code"] == "plan_not_confirmed"
    client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    r = client.post("/api/v1/mobile/guidance/predict", json=body)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["kind"] == "predict" and g["state"] == "draft" and g["method"] == "deterministic"
    kinds = [i["kind"] for i in g["items"]]
    assert kinds == ["adjust", "not_recorded", "not_recorded", "consistent"]
    for i in g["items"]:
        assert i["citation"]["page_number"] >= 1 and f"p.{i['citation']['page_number']}" in i["suggestion"]
        e = conn.execute("SELECT quote FROM evidence WHERE id=?", (i["citation"]["evidence_id"],)).fetchone()
        assert e is not None and e[0] == i["citation"]["quote"]
    adj = g["items"][0]
    assert adj["log_id"] == a["id"] and adj["log_value"] == [1, 30] and adj["paper_value"] == [1, 40]
    assert "consider adjusting" in adj["suggestion"]
    url = f"/api/v1/mobile/guidance/{g['id']}/decisions"
    assert client.put(url, json={"decisions": [{"id": adj["id"], "decision": "handled"}]}).status_code == 422
    assert client.put(url, json={"decisions": [{"id": adj["id"], "decision": "adopt"}]}).status_code == 200
    c = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm").json()
    assert c["state"] == "confirmed" and c["confirmed_at"]
    late = client.put(url, json={"decisions": [{"id": adj["id"], "decision": "ignore"}]})
    assert late.status_code == 409 and late.json()["code"] == "guidance_confirmed"


def test_predict_unknown_log_is_404(client: Client, paper: str) -> None:  # noqa: F811
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    r = client.post("/api/v1/mobile/guidance/predict", json={"plan_id": p["id"], "log_ids": ["nope"]})
    assert r.status_code == 404


def test_weak_mismatch_256hz_and_epoch_window_need_confirm(client: Client, paper: str) -> None:  # noqa: F811
    """The two known weak cases from the W5 demo: 256 Hz paired with another dataset's 1024 Hz, and
    '0-1 s' paired with a '0.25 s window'. Both must be kind=weak_match with needs_confirmation, never a
    plain adjust; guidance confirm is 409 until each is confirm_match / reject_match."""
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    a = _log(client, text="[SAMPLE] Recorded at 256 Hz with a 32-channel cap.", kind="text")
    b = _log(client, text="[SAMPLE] Trials epoched 0-1 s after stimulus onset.", kind="text")
    g = client.post("/api/v1/mobile/guidance/predict",
                    json={"plan_id": p["id"], "log_ids": [a["id"], b["id"]]}).json()
    weaks = [i for i in g["items"] if i["kind"] == "weak_match"]
    # At least the Hz and/or second mismatches that are far apart must be weak (paper is EEGNet).
    assert weaks, g["items"]
    for i in weaks:
        assert i.get("needs_confirmation") is True
        assert "弱匹配" in i["suggestion"] and "辅助参考" in i["suggestion"]
        assert i["kind"] != "adjust"
    # confirm blocked while open
    r = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm")
    assert r.status_code == 409 and r.json()["code"] == "guidance_match_unconfirmed"
    url = f"/api/v1/mobile/guidance/{g['id']}/decisions"
    assert client.put(url, json={"decisions": [{"id": weaks[0]["id"], "decision": "adopt"}]}).status_code == 422
    decs = [{"id": i["id"], "decision": "reject_match"} for i in weaks]
    assert client.put(url, json={"decisions": decs}).status_code == 200
    c = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm")
    assert c.status_code == 200 and c.json()["state"] == "confirmed"


def test_weak_mismatch_helper_unit_cases() -> None:
    from researchos.services.mobile.predict import _weak_mismatch
    assert _weak_mismatch([256, 256], [1024, 1024],
                          "Recorded at 256 Hz with a 32-channel cap.",
                          "sampled at 1024 Hz for the MRCP dataset")
    assert _weak_mismatch([0, 1], [0.25, 0.25],
                          "Trials epoched 0-1 s after stimulus onset.",
                          "a 0.25 s window was used")
    assert not _weak_mismatch([1, 30], [1, 40],
                              "band-pass filtered 1-30 Hz today",
                              "The EEG was band-pass filtered at 1-40 Hz")
