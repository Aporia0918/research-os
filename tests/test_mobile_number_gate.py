"""W6 1.11 numbers-and-citation gate: a numeric plan item needs its numbers verbatim on the cited page, else the user
must confirm_match / reject_match before the plan can be confirmed (409 citation_gate_open). Covers model-written
values (gap 4) and the existing guidance near/weak gate."""
from __future__ import annotations

from researchos.services.mobile import number_gate

from .conftest import Client
from .test_mobile_api import paper  # noqa: F401  (fixture)


def test_paper_items_pass_edited_number_is_gated(client: Client, paper: str) -> None:  # noqa: F811
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    numeric = [i for i in p["items"] if number_gate.numbers(i["text"])]
    assert numeric and all(i["number_gate"]["state"] == "ok" for i in numeric)
    first = numeric[0]
    fake = first["text"] + " and 999 trials"
    items = [{"id": i["id"], "category": i["category"], "text": fake if i["id"] == first["id"] else i["text"]}
             for i in p["items"]]
    got = client.put(f"/api/v1/mobile/plans/{p['id']}/items", json={"items": items}).json()
    hit = next(i for i in got["items"] if i["id"] == first["id"])
    assert hit["number_gate"]["state"] == "needs_confirmation" and hit["number_gate"]["missing"] == ["999"]
    assert hit["number_gate"]["label"] == "需确认"
    r = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert r.status_code == 409 and r.json()["code"] == "citation_gate_open"
    url = f"/api/v1/mobile/plans/{p['id']}/items/{{}}/number"
    assert client.post(url.format(hit["id"]), json={"decision": "adopt"}).status_code == 422
    ok_item = next(i for i in got["items"] if i["id"] != hit["id"])
    assert client.post(url.format(ok_item["id"]), json={"decision": "confirm_match"}).status_code == 422
    d = client.post(url.format(hit["id"]), json={"decision": "reject_match"})
    assert d.status_code == 200
    assert next(i for i in d.json()["items"] if i["id"] == hit["id"])["number_gate"]["decided_at"]
    c = client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    assert c.status_code == 200, c.text
    assert client.post(url.format(hit["id"]), json={"decision": "confirm_match"}).status_code == 409


def test_model_value_not_on_page_is_needs_confirmation() -> None:
    quote = "Signals were band-pass filtered between 1 and 40 Hz and sampled at 128 Hz."
    model_item = {"id": "x", "text": "Band-pass 1-40 Hz, sampled at 256 Hz", "citation": {"quote": quote}}
    tagged = number_gate.tag(model_item)
    assert tagged["number_gate"]["state"] == "needs_confirmation" and tagged["number_gate"]["missing"] == ["256"]
    assert number_gate.tag({**model_item, "text": "1-40 Hz at 128 Hz"})["number_gate"]["state"] == "ok"
    assert "number_gate" not in number_gate.tag({"id": "y", "text": "baseline correction", "citation": None})
    assert number_gate.missing_numbers("0.5 s", "epochs of 0.5 s") == []
    assert number_gate.missing_numbers("5 s", "epochs of 0.5 s") == ["5"]


def test_guidance_near_match_still_blocks_confirm(client: Client, paper: str) -> None:  # noqa: F811
    g = client.post("/api/v1/mobile/guidance/citation-check",
                    json={"version_id": paper, "text": "EEG was band-pass filtered at 1-30 Hz with a baseline."}).json()
    if any(i.get("needs_confirmation") for i in g["items"]):
        r = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm", json={"decisions": []})
        assert r.status_code == 409 and r.json()["code"] == "guidance_match_unconfirmed"
