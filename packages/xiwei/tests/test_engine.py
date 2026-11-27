"""引擎的验收测试：补充方案 1.5 的三个算例、2.6 的信息增益数字、退化核对，以及门控和读题的不变量。"""

from __future__ import annotations

import json

import pytest
import sympy as sp

from xiwei import bkt
from xiwei.api import api_generate, api_grade, api_read, call
from xiwei.diagnose import diagnose
from xiwei.engine import ROUNDS, changed, gate, generate
from xiwei.grade import parse_answer, same
from xiwei.operators import changes
from xiwei.problem import Problem
from xiwei.read import read
from xiwei.solve import DNE, FINITE, numeric_agrees, solve

SAMPLES = [
    "求极限 lim(x→0) sin(x)/x",
    r"这道题 $\lim_{x \to 0^+} \frac{|x|}{x}$ 答案是 1",
    r"$\int_0^{\pi} \sin x \, dx$ = 2",
    "求 f(x) = x^2-2x 在 [0, 3] 上的最大值",
    "解方程组 x+2y=5, 3x+4y=6",
    "∫ 从 -1 到 1，被积函数 x dx",
    r"$\int_{1}^{\infty} \frac{1}{x^2} dx$",
    "设 k=3，求极限 lim(x→∞) e^x/x^k",
    "求极限 lim(x→3) (x^2-9)/(x-3)",
]


def pair(original: str, sid_type: str, new: object) -> tuple[Problem, Problem]:
    p, _ = read(original)
    return p, p.with_value(p.first(sid_type).id, new)


def verdict(p: Problem, q: Problem, text: str) -> dict:
    return diagnose(q, p, parse_answer(text, q.kind))


# ---- 补充方案 1.5 算例 ----------------------------------------------------------------------------
def test_example1_point():
    p, q = pair("求极限 lim(x→0) (e^(2x)-1)/x", "point", "1")
    assert same(solve(q), parse_answer("e^2-1", "limit"))
    assert verdict(p, q, "e^2-1")["verdict"] == "correct"
    d = verdict(p, q, "2")
    assert (d["verdict"], [q.slot(s).type for s in d["slots"]]) == ("missed", ["point"])
    assert verdict(p, q, "2e^2")["verdict"] == "error"  # 照搬洛必达，不误判成漏看
    assert verdict(p, q, "e^2")["verdict"] == "calc"


def test_example2_abs_and_side_collide():
    """O3 给分母加绝对值：答 4 时「没看见绝对值」和「左右看反」撞车，转待复核。"""
    p = Problem.from_json({"kind": "limit", "expr": "(x^2-4)/Abs(x-2)", "slots": [
        {"id": "c1", "type": "point", "value": "2"}, {"id": "c2", "type": "side", "value": "-"},
        {"id": "c3", "type": "abs", "value": False, "name": "x - 2"}]})
    q = p.with_value("c3", True)
    assert (solve(p).value, solve(q).value) == ((4,), (-4,))
    d = verdict(p, q, "4")
    assert (d["verdict"], d["slots"]) == ("review", ["c2", "c3"])
    assert (verdict(p, q, "不存在")["verdict"], verdict(p, q, "不存在")["slots"]) == ("missed", ["c2"])
    assert verdict(p, q, "-2")["verdict"] == "calc"


def test_example3_unchanged_abs_is_located():
    p, q = pair("∫ 从 0 到 2，被积函数 |x-1| dx", "upper", "3")
    assert solve(q).value == (sp.Rational(5, 2),)
    assert [q.slot(s).type for s in verdict(p, q, "1")["slots"]] == ["upper"]
    d = verdict(p, q, "1.5")  # Math-Verify 判 1.5 与 3/2 等价
    assert (d["verdict"], [q.slot(s).type for s in d["slots"]]) == ("missed", ["abs"])
    assert verdict(p, q, "2")["verdict"] == "calc"


# ---- 补充方案 2.5—2.6：观测模型与信息增益 -----------------------------------------------------------------
def test_degenerates_to_bkt():
    one = bkt.Probe({"a": (0,)})
    assert round(bkt.update(one, {"a": 0.3}, bkt.CORRECT)["a"], 4) == 0.6927
    assert round(bkt.update(one, {"a": 0.3}, 0)["a"], 4) == 0.1136


def test_eig_picks_the_disambiguating_question():
    m = {"abs": 0.6, "side": 0.5, "pt": 0.9}
    qa, qb = bkt.Probe({"abs": (0,), "side": (0, 1)}), bkt.Probe({"pt": (0,)})
    assert (round(bkt.info_gain(qa, m), 3), round(bkt.info_gain(qb, m), 3)) == (0.432, 0.196)
    m = bkt.update(qa, m, 0)
    assert {k: round(v, 3) for k, v in m.items()} == {"abs": 0.38, "side": 0.469, "pt": 0.9}
    gains = {name: round(bkt.info_gain(q, m), 3) for name, q in
             {"A": qa, "B": qb, "D": bkt.Probe({"side": (0, 1)}), "E": bkt.Probe({"abs": (0,)})}.items()}
    assert gains == {"A": 0.335, "B": 0.196, "D": 0.427, "E": 0.398}


# ---- 门控与算子的不变量 ----------------------------------------------------------------------------------
@pytest.mark.parametrize("text", SAMPLES)
def test_every_variant_passes_all_four_gates(text):
    p, _ = read(text)
    v = generate(p).variant
    assert v is not None, text
    diff = [s.id for s, t in zip(p.slots, v.problem.slots, strict=True) if s != t]
    assert diff == [v.change.slot] and v.problem.expr == p.expr
    assert changed(solve(p), v.answer) and numeric_agrees(v.problem, v.answer)
    assert v.answer.kind != DNE


def test_gate1_rejects_unchanged_answer():
    p, _ = read("求极限 lim(x→0⁺) |x|/x")
    c = next(c for c in changes(p) if c.type == "point" and c.new == "1")
    assert gate(p, c, solve(p))[0] == 1


def test_exclude_never_repeats():
    p, _ = read("求极限 lim(x→3) (x^2-9)/(x-3)")
    seen: list[str] = []
    for _ in range(3):
        r = api_generate(p.to_json(), exclude=seen)
        if r["variant"] is None:
            break
        assert r["variant"]["key"] not in seen
        seen.append(r["variant"]["key"])
    assert api_generate(p.to_json(), exclude=seen, asked=ROUNDS)["stop"]


# ---- 读题与判分 ----------------------------------------------------------------------------------------
@pytest.mark.parametrize(("text", "point", "side"), [
    ("lim(x→0⁺) 1/x", "0", "+"), (r"$\lim_{x\to 1^-} \frac{1}{x-1}$", "1", "-"), ("lim(x→∞) 1/x", "oo", None),
])
def test_read_splits_point_and_side(text, point, side):
    p, _ = read(text)
    assert p.first("point").value == point
    assert (p.first("side").value if p.first("side") else None) == side


def test_unreadable_text_says_how_to_fix():
    with pytest.raises(ValueError, match="认不出题目"):
        read("今天天气不错")


def test_limit_does_not_exist_is_dne():
    assert parse_answer("不存在", "limit").kind == DNE
    assert same(parse_answer("\\frac{1}{2}", "limit"), parse_answer("0.5", "limit"))
    assert parse_answer("x=1, y=2", "linear_system").value == (1, 2)
    assert parse_answer("3/2", "integral").kind == FINITE


def test_api_round_trip():
    r = api_read(SAMPLES[1])
    g = api_generate(r["problem"], claim=r["claim"], methods=r["methods"])
    assert g["ok"] and g["aiDisagrees"] is False and len(g["variant"]["options"]) >= 3
    gr = api_grade(r["problem"], g["variant"]["problem"], "不存在")  # 把单侧看成双侧
    assert gr["verdict"] == "missed" and gr["mastery"]["单侧方向"] < bkt.P0
    both = api_grade(r["problem"], g["variant"]["problem"], "1")  # 去掉 |x| 和左右看反都得 1
    assert both["verdict"] == "review" and len(both["missed"]) == 2
    right = api_grade(r["problem"], g["variant"]["problem"], g["variant"]["answer"]["text"], choices=4)
    assert right["correct"] and right["mastery"]["单侧方向"] > bkt.P0
    assert json.loads(call("read", json.dumps({"text": "随便写"})))["ok"] is False
    assert "引擎出错" in json.loads(call("grade", "{}"))["error"]


def test_shared_text_keeps_problem_and_ai_claim_apart():
    r = api_read("求极限 lim(x→0⁺) |x|/x，AI 说答案是 -1")
    assert r["problem"]["expr"] == "Abs(x) /x" and r["claim"] == "-1"
    assert api_generate(r["problem"], claim=r["claim"])["aiDisagrees"] is True


@pytest.mark.parametrize("text", SAMPLES)
def test_every_option_reads_back(text):
    """手机上点选项就是把选项文字当答案交上来，所以每个选项都得读得回去，正确选项判对。"""
    r = api_read(text)
    v = api_generate(r["problem"])["variant"]
    verdicts = [api_grade(r["problem"], v["problem"], o["text"], choices=4)["verdict"] for o in v["options"]]
    assert "unparsed" not in verdicts and verdicts.count("correct") == 1
