"""mobile-guidance: research guidance (counter-questions citing method sentences) and writing guidance (citation check,
methods check against a confirmed plan). Draft -> confirmed with a timestamp; any change after confirm is 409."""
from __future__ import annotations

import io
import sqlite3

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from researchos.services.container import Services

from .conftest import Client
from .m1_helpers import drain
from .test_mobile_api import paper  # noqa: F401  (fixture)
from .test_mobile_plan_sections import _no_method_pdf


def _post(client: Client, path: str, body: dict, code: int = 201) -> dict:
    r = client.post(f"/api/v1/mobile/guidance/{path}", json=body)
    assert r.status_code == code, r.text
    return r.json()


def test_questions_cite_method_sentences_and_lock_after_confirm(client: Client, paper: str,  # noqa: F811
                                                                conn: sqlite3.Connection) -> None:
    g = _post(client, "questions", {"version_id": paper, "idea": "I will filter our EEG and compare with a baseline"})
    assert g["kind"] == "questions" and g["state"] == "draft" and g["status"] == "ok"
    assert g["method"] == "deterministic" and 2 <= len(g["items"]) <= 5
    topics = [i["topic"] for i in g["items"]]
    assert topics[:2] == ["filtering", "controls"]  # the topics the idea mentions come first
    for i in g["items"]:
        assert i["citation"]["page_number"] == 2 and i["question"] and i["decision"] is None
        e = conn.execute("SELECT quote FROM evidence WHERE id=?", (i["citation"]["evidence_id"],)).fetchone()
        assert e is not None and e[0] == i["citation"]["quote"]
    a, b = g["items"][0]["id"], g["items"][1]["id"]
    url = f"/api/v1/mobile/guidance/{g['id']}/decisions"
    bad = client.put(url, json={"decisions": [{"id": a, "decision": "edit"}]})
    assert bad.status_code == 422
    bad = client.put(url, json={"decisions": [{"id": a, "decision": "x"}]})
    assert bad.status_code == 422
    d = client.put(f"/api/v1/mobile/guidance/{g['id']}/decisions", json={"decisions": [
        {"id": a, "decision": "edit", "text": "Is our 0.5-45 Hz filter close enough?"},
        {"id": b, "decision": "ignore"}]})
    assert d.status_code == 200, d.text
    got = {i["id"]: i for i in d.json()["items"]}
    assert got[a]["decision"] == "edit" and got[a]["user_text"].startswith("Is our") and got[b]["decision"] == "ignore"
    c = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm").json()
    assert c["state"] == "confirmed" and c["confirmed_at"]
    assert client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm").json()["confirmed_at"] == c["confirmed_at"]
    late = client.put(url, json={"decisions": [{"id": b, "decision": "adopt"}]})
    assert late.status_code == 409 and late.json()["code"] == "guidance_confirmed"
    assert client.get(f"/api/v1/mobile/guidance/{g['id']}").json()["items"][1]["decision"] == "ignore"


def test_questions_model_flag_without_key_and_no_method_section(client: Client, paper: str,  # noqa: F811
                                                                conn: sqlite3.Connection, svc) -> None:  # type: ignore[no-untyped-def]
    g = _post(client, "questions", {"version_id": paper, "idea": "filter our EEG", "use_model": True})
    assert g["method"] == "deterministic_fallback" and g["items"]
    r = client.post("/api/v1/documents/upload", files={"file": ("review.pdf", _no_method_pdf(), "application/pdf")})
    drain(conn, svc)
    g = _post(client, "questions", {"version_id": r.json()["version_id"], "idea": "filter our EEG"})
    assert g["status"] == "method_section_not_found" and g["items"] == []


def test_claim_split_keeps_decimals() -> None:
    from researchos.services.mobile.guidance import _claims
    assert _claims("A learning rate of 0.001 was used. Then 2.5 s epochs were cut.") == [
        "A learning rate of 0.001 was used.", "Then 2.5 s epochs were cut."]


def test_citation_check_three_states(client: Client, paper: str) -> None:  # noqa: F811
    text = ("EEG was band-pass filtered at 1-40 Hz before epoching. EEG was band-pass filtered at 1-30 Hz before "
            "epoching. All participants always took part in every demo recording session. The moon is made of cheese.")
    g = _post(client, "citation-check", {"version_id": paper, "text": text})
    v = [(i["verdict"], i["citation"]["page_number"] if i["citation"] else None) for i in g["items"]]
    assert v[0] == ("exact_match", 2) and not g["items"][0]["needs_confirmation"]
    near = g["items"][1]  # changed number: a candidate to compare, never anchored as evidence, never "verified"
    assert near["verdict"] == "near_match" and near["citation"] is None and near["needs_confirmation"]
    assert near["candidate"]["page_number"] == 2 and "1-40 Hz" in near["candidate"]["quote"] and "30" in near["reason"]
    assert g["items"][3]["verdict"] == "cannot_check" and "not mean" in g["items"][3]["reason"]
    assert all(i["verdict"] in ("exact_match", "near_match", "cannot_check") for i in g["items"])
    bad = client.put(f"/api/v1/mobile/guidance/{g['id']}/decisions",
                     json={"decisions": [{"id": g["items"][1]["id"], "decision": "adopt"}]})
    assert bad.status_code == 422
    wrong = client.put(f"/api/v1/mobile/guidance/{g['id']}/decisions",
                       json={"decisions": [{"id": g["items"][0]["id"], "decision": "confirm_match"}]})
    assert wrong.status_code == 422  # only a near match is confirmed / rejected as a match
    opened = [i["id"] for i in g["items"] if i["needs_confirmation"]]
    early = client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm")
    assert early.status_code == 409 and early.json()["code"] == "guidance_match_unconfirmed", early.text
    d = client.put(f"/api/v1/mobile/guidance/{g['id']}/decisions",
                   json={"decisions": [{"id": i, "decision": "reject_match"} for i in opened]})
    assert d.status_code == 200
    assert client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm").status_code == 200


def _pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in lines:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()
    c.save()
    return buf.getvalue()


def test_paraphrase_and_reversed_count_are_never_exact(client: Client, conn: sqlite3.Connection,
                                                       svc: Services) -> None:
    pdf = _pdf(["ECG arrhythmia detection", "", "2 Methods",
                "We collect a test set of 336 records from 328 unique patients.",
                "Each record was annotated by a committee of three board-certified cardiologists."])
    r = client.post("/api/v1/documents/upload", files={"file": ("ecg.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    drain(conn, svc)
    vid = r.json()["version_id"]
    g = _post(client, "citation-check", {"version_id": vid, "text": (
        "Each of the 336 test records was drawn from a different patient.\n"
        "Three heart specialists jointly labelled every recording in the evaluation data.")})
    fake, para = g["items"]
    assert fake["verdict"] != "exact_match" and fake["citation"] is None  # 336 records from 328 patients
    assert fake["verdict"] == "near_match" and fake["needs_confirmation"] and "328" in fake["reason"]
    assert para["verdict"] in ("near_match", "cannot_check")  # a paraphrase is never reported as "not found"
    assert "not_found" not in {i["verdict"] for i in g["items"]}


def test_methods_check_needs_confirmed_plan_and_lists_missing(client: Client, paper: str) -> None:  # noqa: F811
    p = client.post("/api/v1/mobile/plans", json={"version_id": paper}).json()
    text = "We band-pass filtered the EEG between 1 and 40 Hz (1-40 Hz)."
    r = client.post("/api/v1/mobile/guidance/methods-check", json={"plan_id": p["id"], "text": text})
    assert r.status_code == 409 and r.json()["code"] == "plan_not_confirmed"
    client.post(f"/api/v1/mobile/plans/{p['id']}/confirm")
    g = _post(client, "methods-check", {"plan_id": p["id"], "text": text})
    assert g["plan_id"] == p["id"] and len(g["items"]) == len(p["items"])
    by = {i["plan_text"]: i["verdict"] for i in g["items"]}
    assert any("1-40 Hz" in t and v == "present" for t, v in by.items())
    assert any("2 s" in t and v == "missing" for t, v in by.items())
    assert g["items"][0]["verdict"] == "missing"  # missing first
    client.post(f"/api/v1/mobile/guidance/{g['id']}/confirm")
    late = client.put(f"/api/v1/mobile/guidance/{g['id']}/decisions",
                      json={"decisions": [{"id": g["items"][0]["id"], "decision": "handled"}]})
    assert late.status_code == 409
    assert client.post("/api/v1/mobile/guidance/methods-check",
                       json={"plan_id": "mplan_nope", "text": "x"}).status_code == 404
    assert client.get("/api/v1/mobile/guidance/mguide_nope").status_code == 404


def test_number_bound_to_another_entity_is_never_exact(client: Client, conn: sqlite3.Connection,
                                                        svc: Services) -> None:
    """Regression (hard test v2, U-Net): 'It contains 20 ...' is about DIC-HeLa; the claim names PhC-U373."""
    pdf = _pdf(["Cell tracking results", "", "3 Experiments",
                "The first data set PhC-U373 contains glioblastoma cells recorded by phase contrast microscopy.",
                "It contains 35 partially annotated training images.",
                "The second data set DIC-HeLa are HeLa cells on a flat glass recorded by DIC microscopy.",
                "It contains 20 partially annotated training images."])
    r = client.post("/api/v1/documents/upload", files={"file": ("cells.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    drain(conn, svc)
    g = _post(client, "citation-check", {"version_id": r.json()["version_id"], "text":
              "The PhC-U373 dataset contains 20 partially annotated training images."})
    (item,) = g["items"]
    assert item["verdict"] != "exact_match" and item["citation"] is None
    assert item["verdict"] == "near_match" and item["needs_confirmation"] and "phc-u373" in item["reason"]


def test_names_and_negation_rules() -> None:
    from researchos.services.mobile.citation_rules import _names
    from researchos.services.mobile.guidance import _support
    assert _names("The PhC-U373 set has 512x512 images from a Drosophila larva.") == {"phc-u373", "drosophila"}
    _, why = _support("The model does not use dropout layers.", "The model uses dropout layers.")
    assert any("negation" in w for w in why)
    _, why = _support("Pixels near the image border are predicted by mirroring the input image.",
                      "To predict the pixels in the border region, the input image is mirrored.")
    assert why == []


def test_ligature_quote_found_on_its_page_and_table_dumps_skipped() -> None:
    """Regression (hard test v2): a quote with 'fi' matches page text that has the ligature 'ﬁ' (the backend
    normalises with NFKC; the v2 harness did not, which made a correct page look wrong). Table dumps are skipped."""
    from researchos.services.knowledge.text import find_span
    from researchos.services.mobile.citation_rules import _table_like
    assert find_span("of the Drosophila ﬁrst instar larva ventral nerve cord", "Drosophila first instar larva")
    assert _table_like("5 convolution 2D 8 8 * 64 + 8 (1, 64) (1, 1) (C, T, 8) Relu same 6 maxpooling 2D (1, 16)")
    assert not _table_like("The training data is a set of 30 images (512x512 pixels) from serial section microscopy.")


def test_questions_are_tied_to_the_idea_content(client: Client, paper: str) -> None:  # noqa: F811
    """W6 ④: no topic in the idea -> no questions (never a generic template); each question has a page and quotes
    the idea's own number against the paper's number of the same unit."""
    g = _post(client, "questions", {"version_id": paper, "idea": "my idea"})
    assert g["status"] == "ok" and g["items"] == []
    g = _post(client, "questions", {"version_id": paper, "idea": "We will band-pass filter at 0.5-45 Hz"})
    assert g["items"] and all(i["citation"]["page_number"] >= 1 for i in g["items"])
    assert {i["topic"] for i in g["items"]} <= {"filtering", "sampling", "sample_size"}
    f = next(i for i in g["items"] if i["topic"] == "filtering")
    assert "0.5-45 Hz" in f["question"] and f"第 {f['citation']['page_number']} 页" in f["question"]
