"""mobile-api: experiment log entries (limits, idempotency, owner scope) and the deterministic log-vs-paper
comparison with page citations proven by the Evidence write path; mobile app origins default off."""
from __future__ import annotations

import io
import sqlite3
import uuid

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from researchos.kernel.config import Settings
from researchos.services.container import Services
from researchos.services.mobile.compare import extract_params

from .conftest import Client
from .m1_helpers import drain

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
METHOD_SENTENCE = "EEG was band-pass filtered at 1-40 Hz before epoching."


def _paper() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Demo EEG methods paper")
    y = 800
    for line in ["Demo EEG methods paper", "", "Abstract", "We study a demo task with wearable EEG recordings."]:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()
    y = 800
    for line in ["2. Methods", "Twenty participants took part in the demo recording session.", METHOD_SENTENCE,
                 "Epochs lasted 2 s and were baseline corrected.", "Samples were stored at 4 °C overnight."]:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()
    c.save()
    return buf.getvalue()


def _log(client: Client, **form: str) -> dict:
    form.setdefault("client_id", uuid.uuid4().hex)
    r = client.post("/api/v1/mobile/logs", data=form)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def paper(client: Client, conn: sqlite3.Connection, svc: Services) -> str:
    r = client.post("/api/v1/documents/upload", files={"file": ("demo.pdf", _paper(), "application/pdf")})
    assert r.status_code == 201, r.text
    drain(conn, svc)
    vid: str = r.json()["version_id"]
    assert client.get(f"/api/v1/documents/{vid}").json()["parse_state"] == "parsed"
    return vid


def test_extract_params_ranges_and_units() -> None:
    ps = extract_params("Filtered 0.5–40 Hz, epochs of 2 s, stored at 4 °C, 30 min rest, 2 kHz sampling.")
    assert [(p.low, p.high, p.unit) for p in ps] == [(0.5, 40, "Hz"), (2, 2, "s"), (4, 4, "°C"), (30, 30, "min"),
                                                    (2, 2, "kHz")]
    assert extract_params("version 2.1 of the protocol") == []


def test_text_log_created_and_listed(client: Client) -> None:
    out = _log(client, text="band-pass 0.5-40 Hz", kind="text")
    assert out["created"] is True and out["kind"] == "text"
    assert [x["id"] for x in client.get("/api/v1/mobile/logs").json()] == [out["id"]]


def test_offline_retry_same_client_id_does_not_duplicate(client: Client) -> None:
    a = _log(client, text="first try", client_id="phone-1")
    b = _log(client, text="first try", client_id="phone-1")  # new Idempotency-Key, same client_id
    assert b["id"] == a["id"] and b["created"] is False
    assert len(client.get("/api/v1/mobile/logs").json()) == 1


def test_same_idempotency_key_replays(client: Client) -> None:
    h = {"idempotency-key": "k-1"}
    r1 = client.post("/api/v1/mobile/logs", data={"client_id": "c1", "text": "x y z"}, headers=h)
    r2 = client.post("/api/v1/mobile/logs", data={"client_id": "c1", "text": "x y z"}, headers=h)
    assert r1.json() == r2.json() and r1.json()["created"] is True


def test_photo_attachment_stored_with_metadata(client: Client, settings: Settings) -> None:
    r = client.post("/api/v1/mobile/logs", data={"client_id": "p1", "kind": "photo", "text": "gel image"},
                    files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["attachment_size"] == len(JPEG) and j["attachment_mime"] == "image/jpeg"
    assert len(j["attachment_sha256"]) == 64
    assert "attachment_path" not in j


@pytest.mark.parametrize("kind,name,data,mime,code", [
    ("photo", "a.exe", b"MZ....", "application/x-msdownload", 415),
    ("voice", "a.jpg", JPEG, "image/jpeg", 422),
    ("photo", "a.jpg", b"not a jpeg at all", "image/jpeg", 422),
])
def test_attachment_rejections(client: Client, kind: str, name: str, data: bytes, mime: str, code: int) -> None:
    r = client.post("/api/v1/mobile/logs", data={"client_id": uuid.uuid4().hex, "kind": kind},
                    files={"file": (name, data, mime)})
    assert r.status_code == code, r.text


def test_attachment_size_limit(client: Client, monkeypatch: pytest.MonkeyPatch) -> None:
    from researchos.services.mobile import logs
    monkeypatch.setattr(logs, "MAX_ATTACHMENT_BYTES", 32)
    r = client.post("/api/v1/mobile/logs", data={"client_id": "big", "kind": "photo"},
                    files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 413


def test_photo_needs_attachment_and_text_needs_text(client: Client) -> None:
    assert client.post("/api/v1/mobile/logs", data={"client_id": "a", "kind": "photo"}).status_code == 422
    assert client.post("/api/v1/mobile/logs", data={"client_id": "b", "kind": "text", "text": " "}).status_code == 422


def test_requires_session(anon: Client) -> None:
    assert anon.post("/api/v1/mobile/logs", data={"client_id": "a", "text": "abc"}).status_code == 401


def test_owner_scope(client: Client, conn: sqlite3.Connection) -> None:
    out = _log(client, text="mine 5 Hz")
    conn.execute("UPDATE mobile_logs SET user_id='someone-else' WHERE id=?", (out["id"],))
    conn.commit()
    assert client.get("/api/v1/mobile/logs").json() == []
    r = client.post("/api/v1/mobile/compare", json={"log_id": out["id"], "version_id": "v"})
    assert r.status_code == 404


def test_compare_finds_mismatch_with_page_citation(client: Client, paper: str, conn: sqlite3.Connection) -> None:
    log = _log(client, text="I used band-pass 0.5-40 Hz, epochs 2 s, stored at 20 °C. Ran 3 trials.")
    r = client.post("/api/v1/mobile/compare", json={"log_id": log["id"], "version_id": paper})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["method"] == "deterministic"
    by = {i["unit"]: i for i in j["items"]}
    hz = by["Hz"]
    assert hz["status"] == "mismatch" and hz["paper_value"] == [1, 40]
    assert hz["citation"]["page_number"] == 2 and "1-40 Hz" in hz["citation"]["quote"]
    assert by["s"]["status"] == "match" and by["s"]["citation"]["page_number"] == 2
    assert by["°C"]["status"] == "mismatch"
    assert by["trials"]["status"] == "not_found" and by["trials"]["citation"] is None
    assert j["mismatches"] == 2
    # the cited quote is a validated Evidence row on that exact page
    ev = client.get(f"/api/v1/evidence/{hz['citation']['evidence_id']}/verify").json()
    assert ev["status"] == "ok", ev
    page = conn.execute("SELECT text FROM pages WHERE version_id=? AND page_index=1", (paper,)).fetchone()[0]
    assert "1-40 Hz" in page


def test_mismatch_picks_closest_same_shape_value() -> None:
    from researchos.services.mobile.compare import Param, _distance
    log = Param(500, 500, "Hz", "500 Hz")
    cands = [Param(1, 40, "Hz", "1-40 Hz"), Param(512, 512, "Hz", "512 Hz"), Param(128, 128, "Hz", "128 Hz")]
    assert min(cands, key=lambda c: _distance(log, c)).raw == "512 Hz"


def test_mismatch_prefers_body_sentence_over_table_row() -> None:
    from researchos.services.mobile.compare import _WORD, _rank, extract_params
    log = "Band-pass filtered 0.5-40 Hz, downsampled to 128 Hz."
    lp = extract_params(log)[0]
    words = set(_WORD.findall(log.lower()))
    table = "P300 ERP 1-40Hz 15 2000 ERN ERP 1-40Hz 26 340 MRCP ERP 0.1-40Hz 13 1100"
    body = "Data were digitally bandpass filtered to 1-40 Hz and downsampled to 128 Hz."
    cands = [(p, {}, s) for s in (table, body) for p in extract_params(s) if p.low != p.high]
    assert min(cands, key=lambda c: _rank(lp, words, c))[2] == body


def test_word_overlap_comes_from_the_parameter_clause_only() -> None:
    from researchos.services.mobile.compare import _clause_words, _rank, extract_params
    log = "Band-pass filtered 0.5-40 Hz, downsampled to 128 Hz, sampled at 500 Hz."
    lp = extract_params(log)[2]
    words = _clause_words(log, lp.raw)
    assert words == {"sampled"}
    a = "Data were band-pass filtered to 1-40 Hz and down-sampled to 128 Hz."
    b = "EEG recordings were digitally sampled at 512 Hz from 64 scalp electrodes."
    cands = [(p, {}, s) for s in (a, b) for p in extract_params(s) if p.low == p.high]
    assert min(cands, key=lambda c: _rank(lp, words, c))[0].raw == "512 Hz"


def test_compare_without_numbers_returns_no_items(client: Client, paper: str) -> None:
    log = _log(client, text="Subject felt tired today.")
    j = client.post("/api/v1/mobile/compare", json={"log_id": log["id"], "version_id": paper}).json()
    assert j["items"] == [] and j["mismatches"] == 0


def test_compare_unknown_paper_404(client: Client) -> None:
    log = _log(client, text="1 Hz")
    assert client.post("/api/v1/mobile/compare", json={"log_id": log["id"], "version_id": "nope"}).status_code == 404


def test_use_model_never_returns_uncited_items(client: Client, paper: str) -> None:
    log = _log(client, text="band-pass 0.5-40 Hz")
    j = client.post("/api/v1/mobile/compare", json={"log_id": log["id"], "version_id": paper,
                                                   "use_model": True}).json()
    assert j["method"] in ("model", "deterministic_fallback", "deterministic")
    assert all(i["citation"] and i["citation"]["page_number"] >= 1 for i in j["items"] if i["status"] != "not_found")


def test_mobile_origins_default_off(settings: Settings) -> None:
    assert "https://localhost" not in settings.allowed_origins()
    settings.mobile_app_origins = True
    o = settings.allowed_origins()
    assert {"https://localhost", "capacitor://localhost"} <= o
    assert not any("0.0.0.0" in x for x in o)


def test_mobile_origin_rejected_by_default_accepted_when_on(client: Client, settings: Settings) -> None:
    h = {"origin": "https://localhost"}
    assert client.post("/api/v1/mobile/logs", data={"client_id": "o1", "text": "abc"}, headers=h).status_code == 403
