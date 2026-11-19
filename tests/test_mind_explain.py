"""讲给我听 after 记一笔: the point grader, the session (three rounds, one follow-up per point, hints cost debt)
and the HTTP flow. The held-out set D is scored by scripts/judge_eval.py, not here, so no test tunes on it."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest

from researchos.services.mindledger import explain, semantic, session, store

from .conftest import Client

D0 = date(2026, 12, 1)
SE = "标准误是样本均值的标准差。它衡量样本均值在不同抽样之间的波动。样本量越大，标准误越小。"
GOOD = "标准误就是样本均值的标准差，表示样本均值在不同抽样间的波动，样本量越大标准误越小"
TURNED = "标准误是样本均值的标准差，衡量样本均值在不同抽样之间的波动，样本量越大，标准误越大"
DEV_A = Path(__file__).parents[1] / "apps/mobile/tests/fixtures/judge/answers.json"


# ---- the point grader -------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("question", "kind"), [
    ("什么是标准误？", "concept"), ("为什么样本量增大置信区间会变窄？", "cause"),
    ("独立样本t检验怎么做？", "method"), ("报告结论：A组显著短于B组。这句结论靠什么？", "claim"),
])
def test_four_knowledge_types_from_the_question(question: str, kind: str) -> None:
    assert explain.type_of(question) == kind


def test_three_states_per_point() -> None:
    pts = [p.text for p in explain.points_of("什么是标准误？", SE)]
    assert len(pts) == 3
    assert explain.judge_points(pts, GOOD) == ["ok", "ok", "ok"]
    assert explain.judge_points(pts, TURNED)[2] == "turned"  # 越小 said back as 越大: never a pass
    assert explain.outcome(explain.judge_points(pts, TURNED)) == "unsure"
    assert explain.judge_points(pts, "标准误和标准差有关") == ["more", "more", "more"]
    assert explain.shown("turned") == explain.shown("maybe") == "review"


def test_a_matcher_can_only_make_a_point_uncertain() -> None:
    pts = [p.text for p in explain.points_of("什么是标准误？", SE)]
    sure = explain.judge_points(pts, "完全不相干的一句话，讲的是别的事情", lambda ps, a: [0.99] * len(ps))
    assert sure == ["maybe"] * 3 and explain.outcome(sure) == "unsure"


def test_dev_set_partial_and_off_topic_never_pass_or_get_asked_again() -> None:
    """On the phone's dev set A, where LOOSE_POINT was set: only right answers and fluent wrong ones look alike."""
    items = json.loads(DEV_A.read_text("utf-8"))["items"]
    for it in items:
        pts = [p.text for p in explain.points_of(it["q"], it["ref"])]
        for a in it["attempts"]:
            if a["kind"] in ("partial", "off-topic"):
                assert explain.outcome(explain.judge_points(pts, a["text"])) == "fail", a["text"]


def test_follow_up_order_and_limits() -> None:
    assert explain.next_point(["ok", "more", "turned"], [], 1) == 2  # turned round first
    assert explain.next_point(["ok", "more", "maybe"], [], 1) == 1  # then missing
    assert explain.next_point(["ok", "more", "more"], [1], 2) == 2  # each point asked once
    assert explain.next_point(["more", "more"], [0, 1], 2) is None
    assert explain.next_point(["more", "more", "more"], [0], 3) is None  # three rounds at most
    assert explain.merge(["ok", "turned", "more"], ["more", "ok", "maybe"]) == ["ok", "ok", "maybe"]


def test_hint_ladder() -> None:
    p = explain.Point("样本量越大，标准误越小", "concept")
    assert "定义或特征" in explain.hint(p, 0, "")
    assert explain.hint(p, 1, "标准误") == "关键词：「样本量越大」"
    assert explain.hint(p, 2, "").startswith("开头是：「样本量越") and p.text in explain.hint(p, 3, "")


@pytest.mark.parametrize(("help_level", "states", "rounds", "hint", "expected"), [
    ("hint", ["ok", "ok", "ok"], 1, -1, ("clean", "light", 3)),
    ("hint", ["ok", "ok", "ok"], 1, 0, ("clean", "light", 3)),     # naming the gap costs nothing
    ("hint", ["ok", "ok", "more"], 2, -1, ("followed", "light", 2)),
    ("hint", ["ok", "ok", "ok"], 2, 2, ("followed", "medium", 2)),  # half the point given: approach
    ("approach", ["ok", "more", "turned"], 3, -1, ("unsure", "medium", 2)),
    ("own", ["ok", "more", "more"], 3, 3, ("failed", "heavy", 1)),  # the point handed over: an answer debt
])
def test_settle(help_level: str, states: list[str], rounds: int, hint: int, expected: tuple) -> None:
    assert explain.settle(help_level, False, states, rounds, hint) == expected


def test_semantic_matcher_stays_off_without_a_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(semantic.ENV, raising=False)
    semantic.matcher.cache_clear()
    assert semantic.matcher() is None and semantic.ENV in semantic.why_not()


# ---- the session -------------------------------------------------------------------------------------------------

def _entry(conn: sqlite3.Connection, help_level: str = "hint", answer: str = SE) -> str:
    _, e = store.create(conn, "u1", "u1", store.NewEntry(f"c-{help_level}-{len(answer)}", "什么是标准误？", help_level,
                                                         answer=answer), D0)
    return str(e["id"])


def _say(conn: sqlite3.Connection, eid: str, text: str) -> dict:
    pts = [p.text for p in session.points(conn, "u1", eid)]
    return session.round_(conn, "u1", "u1", eid, text, explain.judge_points(pts, text), D0)


def test_clean_first_round_finishes_with_a_good_first_rating(conn: sqlite3.Connection) -> None:
    eid = _entry(conn)
    r = _say(conn, eid, GOOD)
    assert (r["done"], r["result"], r["first_rating"], r["red"]) == (True, "clean", 3, False)
    assert [p["state"] for p in r["points"]] == ["ok"] * 3 and r["points"][0]["text"]
    assert store.get(conn, "u1", eid)["first_rating"] == 3
    assert conn.execute("SELECT COUNT(*) FROM mind_attempts").fetchone()[0] == 0  # not a repayment
    with pytest.raises(Exception, match="already finished"):
        _say(conn, eid, GOOD)


def test_follow_ups_hints_and_a_heavier_debt(conn: sqlite3.Connection) -> None:
    eid = _entry(conn, "hint")
    before = store.get(conn, "u1", eid)
    r1 = _say(conn, eid, "标准误是样本均值的标准差")
    assert not r1["done"] and r1["ask"] and r1["asking"] == 1 and "text" not in r1["points"][0]
    h = session.hint(conn, "u1", "u1", eid)
    h = session.hint(conn, "u1", "u1", eid)
    assert (h["level"], h["point"], h["help_level"]) == (1, 1, "hint")
    h = session.hint(conn, "u1", "u1", eid)
    assert h["level"] == 2
    r2 = _say(conn, eid, "它衡量样本均值在不同抽样之间的波动")
    assert not r2["done"] and r2["asking"] == 2
    r3 = _say(conn, eid, "样本量越大，标准误越小")
    assert (r3["done"], r3["round"], r3["result"], r3["weight"], r3["first_rating"]) == (True, 3, "followed",
                                                                                        "medium", 2)
    after = store.get(conn, "u1", eid)
    assert before["weight"] == "light" and after["weight"] == "medium"
    assert after["due_on"] == (D0 + timedelta(days=1)).isoformat()  # medium: first repayment the next day


def test_could_not_explain_marks_red(conn: sqlite3.Connection) -> None:
    eid = _entry(conn, "answer")
    for _ in range(3):
        r = _say(conn, eid, "不太记得了")
        if r["done"]:
            break
    assert (r["result"], r["red"], r["first_rating"]) == ("failed", True, 1)
    assert store.get(conn, "u1", eid)["red"]
    [d] = store.due(conn, "u1", D0 + timedelta(days=1))
    assert d["first_rating"] == 1


def test_no_answer_nothing_to_explain(conn: sqlite3.Connection) -> None:
    _, e = store.create(conn, "u1", "u1", store.NewEntry("c-none", "什么是标准误？", "hint"), D0)
    with pytest.raises(Exception, match="no AI answer"):
        session.points(conn, "u1", e["id"])


# ---- HTTP --------------------------------------------------------------------------------------------------------

def test_http_explain_flow(client: Client) -> None:
    body = {"client_id": "ext-x", "question": "什么是标准误？", "answer": SE, "help_level": "approach",
            "source": "extension"}
    eid = client.post("/api/v1/mind-ledger/entries", json=body).json()["id"]
    r = client.post(f"/api/v1/mind-ledger/entries/{eid}/explain", json={"text": "标准误是样本均值的标准差"})
    assert r.status_code == 200 and r.json()["ask"], r.text
    h = client.post(f"/api/v1/mind-ledger/entries/{eid}/explain/hint")
    assert h.status_code == 200 and h.json()["level"] == 0
    r = client.post(f"/api/v1/mind-ledger/entries/{eid}/explain", json={"text": GOOD})
    assert r.json()["done"] and r.json()["result"] == "followed"
    again = client.post(f"/api/v1/mind-ledger/entries/{eid}/explain", json={"text": GOOD})
    assert again.status_code == 409
    assert client.get("/api/v1/mind-ledger/due").status_code == 200
