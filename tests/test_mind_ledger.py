"""思维账本: rules, storage (with a moving clock), the model-assisted grader, and the HTTP flow."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

from researchos.contracts.gateway import ChatRequest
from researchos.kernel.config import Settings
from researchos.services.container import Services
from researchos.services.mindledger import judge, rules, store

from .conftest import Client
from .m1_helpers import configure_models, mock_providers

D0 = date(2026, 12, 1)
EXT_ORIGIN = "chrome-extension://mindledgertestid"
# The same body apps/extension/test/capture.test.mjs builds from a sample chat page.
EXT_ENTRY = json.loads((Path(__file__).parents[1] / "apps/extension/test/fixtures/entry.json").read_text("utf-8"))
DERIV = "导数是函数在某点的瞬时变化率。几何上它是切线的斜率。求导要先写出差商再取极限。"


def day(n: int) -> date:
    return D0 + timedelta(days=n)


# ---- rules ----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("level", "thought", "expected"), [
    ("own", False, None), ("hint", False, "light"), ("approach", False, "medium"), ("answer", False, "heavy"),
    ("answer", True, "medium"), ("approach", True, "light"), ("hint", True, "light"),
])
def test_weight_more_thinking_less_debt(level: str, thought: bool, expected: str | None) -> None:
    assert rules.weight(level, thought) == expected


def test_schedules_match_the_plan() -> None:
    assert rules.next_due("light", 0, D0) == day(3)
    assert rules.next_due("light", 1, day(3)) is None
    assert [rules.next_due("medium", 0, D0), rules.next_due("medium", 1, day(1))] == [day(1), day(3)]
    assert rules.next_due("heavy", 0, D0) == day(1)
    assert rules.next_due("heavy", 1, day(1)) == day(8)  # recheck 7 days after the first pass
    assert rules.next_due("heavy", 2, day(8)) is None


def test_exam_week_pulls_everything_forward() -> None:
    exam = day(5)
    assert rules.next_due("light", 0, day(3), exam) == day(4)   # would land on day 6, after the exam
    assert rules.next_due("light", 0, D0, day(30)) == day(3)    # exam far away: unchanged
    assert rules.front_load(day(2), D0, exam) == day(2)         # already before the exam: unchanged
    assert rules.retry_due(day(4), exam) == day(4)              # never past exam eve, never in the past


def test_verdict_is_deterministic() -> None:
    assert rules.verdict(2, 3) and rules.verdict(3, 5) and not rules.verdict(1, 3) and not rules.verdict(0, 0)


# ---- grader ---------------------------------------------------------------------------------------------------

def test_deterministic_grader_counts_key_points() -> None:
    good = judge.grade_deterministic(DERIV, "导数就是瞬时变化率，几何意义是切线斜率。")
    bad = judge.grade_deterministic(DERIV, "不记得了")
    assert len(good.points) == 3 and good.hits == [0, 1] and good.passed and good.method == "deterministic"
    assert bad.hits == [] and not bad.passed


# ---- storage with a moving clock --------------------------------------------------------------------------------

def _entry(conn: sqlite3.Connection, cid: str, level: str, today: date = D0, **kw: Any) -> dict[str, Any]:
    with conn:
        return store.create(conn, "u1", "user:u1", store.NewEntry(cid, kw.pop("q", f"题目 {cid}"), level,
                                                                  answer=DERIV, **kw), today)[1]


def _repay(conn: sqlite3.Connection, eid: str, text: str, today: date) -> dict[str, Any]:
    with conn:
        return store.record_attempt(conn, "u1", "user:u1", eid, text, judge.grade_deterministic(DERIV, text), today)


def test_heavy_debt_full_cycle(conn: sqlite3.Connection) -> None:
    e = _entry(conn, "c1", "answer")
    assert (e["weight"], e["due_on"]) == ("heavy", day(1).isoformat())
    assert store.due(conn, "u1", D0) == []
    assert [d["id"] for d in store.due(conn, "u1", day(1))] == [e["id"]]
    assert "answer" not in store.due(conn, "u1", day(1))[0]          # no peeking before repaying

    miss = _repay(conn, e["id"], "不记得了", day(1))
    assert not miss["passed"] and miss["next_due"] == day(2).isoformat() and len(miss["missed"]) == 3
    ok = _repay(conn, e["id"], "瞬时变化率，切线斜率", day(2))
    assert ok["passed"] and ok["next_due"] == day(9).isoformat()
    done = _repay(conn, e["id"], "瞬时变化率，切线的斜率，差商取极限", day(9))
    assert done["settled"] and store.get(conn, "u1", e["id"])["due_on"] is None


def test_own_idea_is_not_a_debt_and_retries_are_idempotent(conn: sqlite3.Connection) -> None:
    own = _entry(conn, "c2", "own")
    assert own["weight"] is None and own["due_on"] is None
    with conn:
        created, again = store.create(conn, "u1", "user:u1", store.NewEntry("c2", "别的", "answer"), D0)
    assert not created and again["id"] == own["id"]


def test_attempts_are_append_only(conn: sqlite3.Connection) -> None:
    e = _entry(conn, "c3", "hint")
    _repay(conn, e["id"], "不记得了", day(3))
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("UPDATE mind_attempts SET passed=1")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("DELETE FROM mind_attempts")


def test_pre_exam_report(conn: sqlite3.Connection) -> None:
    exam = day(6)
    _entry(conn, "a", "own", topic="高数")
    heavy = _entry(conn, "b", "answer", topic="高数")
    light = _entry(conn, "c", "hint", topic="高数")
    _entry(conn, "d", "approach", topic="英语")
    _repay(conn, light["id"], "瞬时变化率，切线斜率", day(3))   # light settles in one pass
    _repay(conn, heavy["id"], "不记得了", day(1))                # heavy fails once, comes back tomorrow

    r = store.report(conn, "u1", day(2), exam, "高数")
    assert r["total"] == 3 and r["counts"] == {"own": 1, "settled": 1, "shaky": 1, "untested": 0}
    assert r["independence"] == round(2 / 3, 3)                   # own + settled, no-AI attempts only
    assert [i["id"] for i in r["repay_before_exam"]] == [heavy["id"]]
    assert store.report(conn, "u1", day(2), exam)["total"] == 4


# ---- model-assisted grading through the gateway -----------------------------------------------------------------

def _grader(req: ChatRequest) -> str:
    return json.dumps({"points": ["瞬时变化率", "切线斜率", "差商的极限"], "hits": [0, 1]})


@pytest.fixture
def mocks() -> dict[str, Any]:
    return dict(mock_providers({p: _grader for p in ("deepseek", "zhipu", "anthropic", "openai")}))


def test_model_names_hits_rules_decide(conn: sqlite3.Connection, svc: Services) -> None:
    configure_models(conn, svc)
    g = judge.grade(conn, svc.gateway, question="什么是导数", reference=DERIV, attempt="随便写写", weight="heavy")
    assert g.method == "model" and g.hits == [0, 1] and g.passed  # 2 of 3 >= 60%, decided by rules.verdict


def test_unconfigured_model_falls_back(conn: sqlite3.Connection, svc: Services) -> None:
    g = judge.grade(conn, svc.gateway, question="什么是导数", reference=DERIV, attempt="不记得了")
    assert g.method == "deterministic" and not g.passed


def _calls(svc: Services) -> int:
    return sum(len(getattr(p, "calls", ())) for p in svc.gateway.providers.values())


GOOD = "导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限"


@pytest.mark.parametrize(("weight", "attempt", "method", "calls"), [
    ("light", GOOD, "deterministic", 0),        # clear pass: the free grader is enough
    ("medium", "不会", "deterministic", 0),     # too short to pass: nothing a model could change
    ("medium", "导数大概和变化有关系吧", "model", 1),  # unsure: worth one call
    ("heavy", GOOD, "model", 1),                # heavy debts always get the model
])
def test_compute_follows_debt(conn: sqlite3.Connection, svc: Services, weight: str, attempt: str, method: str,
                              calls: int) -> None:
    configure_models(conn, svc)
    g = judge.grade(conn, svc.gateway, question="什么是导数", reference=DERIV, attempt=attempt, weight=weight)
    assert (g.method, _calls(svc)) == (method, calls)


def test_free_grader_never_passes_what_a_marker_would_fail() -> None:
    """On the hand-written sample, whatever the free grader settles alone matches the human label (no false pass)."""
    cases = json.loads((Path(__file__).parent / "fixtures/mindledger/repayments.json").read_text("utf-8"))["cases"]
    alone = [(c, judge.grade_deterministic(c["ref"], c["attempt"])) for c in cases]
    alone = [(c, g) for c, g in alone if not judge.needs_model("medium", g, c["attempt"])]
    assert len(alone) == 11 and all(g.passed == c["human"] for c, g in alone)


def test_ledger_content_stays_in_china(conn: sqlite3.Connection, svc: Services) -> None:
    configure_models(conn, svc, providers=("anthropic", "openai"))  # only overseas vendors usable
    g = judge.grade(conn, svc.gateway, question="什么是导数", reference=DERIV, attempt="随便写写", weight="heavy")
    assert g.method == "deterministic" and _calls(svc) == 0
    assert svc.gateway.domestic("deepseek") and not svc.gateway.domestic("anthropic")
    svc.settings.relay_for = ["deepseek"]
    svc.gateway.providers["relay"] = svc.gateway.providers["deepseek"]
    assert not svc.gateway.domestic("deepseek")  # a domestic model reached through the relay leaves China


# ---- HTTP --------------------------------------------------------------------------------------------------------

def test_http_flow_from_extension(client: Client) -> None:
    body = {"client_id": "ext-1", "question": "什么是导数", "answer": DERIV, "help_level": "answer",
            "source": "extension", "topic": "高数"}
    r = client.post("/api/v1/mind-ledger/entries", json=body)
    assert r.status_code == 201 and r.json()["created"] and r.json()["weight"] == "heavy"
    again = client.post("/api/v1/mind-ledger/entries", json=body)
    assert again.status_code == 201 and not again.json()["created"]
    eid = r.json()["id"]

    a = client.post(f"/api/v1/mind-ledger/entries/{eid}/attempts", json={"text": "瞬时变化率，切线斜率",
                                                                          "use_model": False})
    assert a.status_code == 200 and a.json()["passed"] and a.json()["answer"] == DERIV

    rep = client.get("/api/v1/mind-ledger/report", params={"exam": (date.today() + timedelta(days=5)).isoformat()})
    assert rep.status_code == 200 and rep.json()["counts"]["shaky"] == 1
    bad = client.post("/api/v1/mind-ledger/entries", json={**body, "client_id": "x", "help_level": "copy"})
    assert bad.status_code == 422
    assert client.get("/api/v1/mind-ledger/due").status_code == 200


def test_http_requires_sign_in(anon: Client) -> None:
    assert anon.get("/api/v1/mind-ledger/due").status_code == 401


@pytest.fixture
def ext_origin(settings: Settings) -> str:
    settings.public_origins = [*settings.public_origins, EXT_ORIGIN]  # set before the app reads its origins
    return EXT_ORIGIN


def test_extension_body_accepted_from_an_allowed_extension_origin(ext_origin: str, client: Client) -> None:
    r = client.post("/api/v1/mind-ledger/entries", json={"client_id": "ext-1", **EXT_ENTRY},
                    headers={"origin": ext_origin})
    assert r.status_code == 201, r.text
    assert (r.json()["source"], r.json()["weight"]) == ("extension", "medium")  # wrote an idea first: one step lighter
    blocked = client.post("/api/v1/mind-ledger/entries", json={"client_id": "ext-2", **EXT_ENTRY},
                          headers={"origin": "chrome-extension://someoneelse"})
    assert blocked.status_code == 403


# ---- boards, marks and recalls (the computer knows what the phone's book knows) ----------------------------------

def test_boards_kinds_marks_and_due_order(conn: sqlite3.Connection) -> None:
    _, a = store.create(conn, "u1", "u1", store.NewEntry("c-a", "什么是导数", "hint", topic="高数"), D0)
    _, b = store.create(conn, "u1", "u1", store.NewEntry("c-b", "这个 p 值说明了什么", "hint", board="科研",
                                                         used_in="第二章"), D0)
    _, c = store.create(conn, "u1", "u1", store.NewEntry("c-c", "AI 给的引用：Smith 2020", "answer", board="科研",
                                                         kind="citation"), D0)
    assert (c["weight"], c["due_on"], c["kind"]) == ("heavy", D0.isoformat(), "citation")  # a citation is due now
    assert b["used_in"] == "第二章" and not b["red"]
    store.mark(conn, "u1", "u1", b["id"], red=True)
    ids = [e["id"] for e in store.due(conn, "u1", day(3))]
    assert ids[0] == b["id"]  # red goes first
    assert [e["id"] for e in store.due(conn, "u1", day(3), "科研")] == [b["id"], c["id"]]
    store.mark(conn, "u1", "u1", a["id"], dropped_on=day(1))
    assert a["id"] not in [e["id"] for e in store.due(conn, "u1", day(3))]
    with pytest.raises(Exception):
        store.create(conn, "u1", "u1", store.NewEntry("c-x", "q", "hint", board="工作"), D0)


def test_failed_attempt_marks_red_and_a_pass_clears_it(conn: sqlite3.Connection) -> None:
    _, e = store.create(conn, "u1", "u1", store.NewEntry("c-r", "什么是导数", "hint", answer=DERIV), D0)
    store.record_attempt(conn, "u1", "u1", e["id"], "不会", judge.grade_deterministic(DERIV, "不会"), day(3))
    assert store.get(conn, "u1", e["id"])["red"]
    store.record_attempt(conn, "u1", "u1", e["id"], GOOD, judge.grade_deterministic(DERIV, GOOD), day(4))
    assert not store.get(conn, "u1", e["id"])["red"]


def test_recall_once_then_accept_reopens_with_the_paper_as_reference(conn: sqlite3.Connection) -> None:
    _, e = store.create(conn, "u1", "u1", store.NewEntry("c-q", "午睡和记忆", "hint", answer="午睡会提高记忆。",
                                                         board="科研", used_in="组会幻灯片"), D0)
    kw = {"claim": "午睡会提高记忆。", "paper": "论文乙", "page": 3, "quote": "午睡会降低记忆。"}
    r1 = store.add_recall(conn, "u1", "u1", e["id"], **kw)
    r2 = store.add_recall(conn, "u1", "u1", e["id"], **kw)
    assert r1["id"] == r2["id"]
    [open_] = store.recalls(conn, "u1")
    assert (open_["used_in"], open_["answer"], open_["page"]) == ("组会幻灯片", "午睡会提高记忆。", 3)
    store.settle_recall(conn, "u1", "u1", r1["id"], "accepted", day(5))
    got = store.get(conn, "u1", e["id"])
    assert (got["answer"], got["due_on"]) == ("午睡会降低记忆。", day(5).isoformat())
    assert store.recalls(conn, "u1") == []


def test_http_marks_and_recalls(client: Client) -> None:
    body = {"client_id": "m-1", "question": "午睡和记忆", "help_level": "hint", "answer": "午睡会提高记忆。",
            "board": "科研", "used_in": "第三章"}
    r = client.post("/api/v1/mind-ledger/entries", json=body)
    assert r.status_code == 201 and r.json()["board"] == "科研"
    eid = r.json()["id"]
    m = client.patch(f"/api/v1/mind-ledger/entries/{eid}", json={"red": True})
    assert m.status_code == 200 and m.json()["red"] is True
    rc = client.post(f"/api/v1/mind-ledger/entries/{eid}/recalls",
                     json={"claim": "午睡会提高记忆。", "paper": "论文乙", "page": 2, "quote": "午睡会降低记忆。"})
    assert rc.status_code == 201
    listed = client.get("/api/v1/mind-ledger/recalls").json()
    assert [x["used_in"] for x in listed] == ["第三章"]
    s = client.post(f"/api/v1/mind-ledger/recalls/{rc.json()['id']}", json={"state": "dismissed"})
    assert s.status_code == 200 and client.get("/api/v1/mind-ledger/recalls").json() == []
    assert client.post(f"/api/v1/mind-ledger/recalls/{rc.json()['id']}", json={"state": "maybe"}).status_code == 422
