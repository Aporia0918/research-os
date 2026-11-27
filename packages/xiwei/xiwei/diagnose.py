"""错答反推漏看条件（补充方案第一部分）：对每个前提逐个「拿掉或取反」，用求解器算出没看见它时的答案（前提消融答案集），
学生答错时用 Math-Verify 逐一比对，定位漏看的前提；多个前提撞车、或撞上公开常见错误时标待复核，都不命中算计算错误。
"""

from __future__ import annotations

from dataclasses import dataclass

import sympy as sp

from .bkt import CORRECT, OTHER, Probe
from .grade import same
from .operators import KC
from .problem import Problem
from .render import LABELS, slot_text
from .solve import DIVERGE, DNE, FINITE, MANY, NEG_INF, NONE, POS_INF, Answer, IllDefined, as_answer, solve

_NUMS = tuple(Answer(FINITE, (sp.Integer(v),)) for v in (0, 1, -1))
_FILL = {"limit": (Answer(POS_INF), Answer(NEG_INF), Answer(DNE), *_NUMS), "integral": (Answer(DIVERGE), *_NUMS),
         "extremum": _NUMS, "linear_system": (Answer(NONE), Answer(MANY))}  # 选项凑不满时按题型补


@dataclass(frozen=True)
class Miss:
    slot: str
    kc: str
    why: str
    answer: Answer


def _readings(q: Problem, p: Problem) -> list[tuple[str, str, Problem]]:
    """每个前提「没看见」的读法：被改动的槽还原成原题取值；其余按类型拿掉或取反。只动这一个槽。"""
    out = []
    at, side = q.approach() if q.kind == "limit" else (None, "")
    for s in q.slots:
        old = p.slot(s.id).value
        if old != s.value:
            out.append((s.id, f"按原题的{slot_text(p, p.slot(s.id))}算", q.with_value(s.id, old)))
        if s.type == "side" and side:
            out.append((s.id, "左右方向看反", q.with_value(s.id, "-" if side == "+" else "+")))
            out.append((s.id, "单侧看成双侧", q.with_value(s.id, "")))
        elif s.type == "abs" and s.value:
            out.append((s.id, "没看见绝对值", q.with_value(s.id, False)))
        elif s.type == "param":
            out.append((s.id, f"{s.name} 的符号看反", q.with_value(s.id, sp.sstr(-sp.sympify(s.value)))))
        elif s.type == "interval":
            out.append((s.id, "没看见区间限制", q.with_value(s.id, ["-oo", "oo"])))
    return out


def misses(q: Problem, p: Problem, truth: Answer) -> list[Miss]:
    """前提消融答案集：求不出的、与正确答案相同的（这道题里看没看见都一样）都剔除。"""
    out = []
    for sid, why, r in _readings(q, p):
        try:
            a = solve(r)
        except IllDefined:
            continue
        if not same(a, truth):
            out.append(Miss(sid, KC[q.slot(sid).type], why, a))
    return out


def _limit_errors(q: Problem) -> list[tuple[str, Answer]]:
    """公开常见错误（原型 data/common_errors.md）：照搬洛必达、直接代入、0/0 当定值、非零数/0 当 ∞。"""
    f, x = q.function(), q.x
    at, side = q.approach()
    out: list[tuple[str, Answer]] = []
    num, den = sp.fraction(sp.together(f))
    plug = f.subs(x, at) if at.is_finite else None
    if plug is not None and plug.is_finite and plug.is_real:
        out.append(("直接把趋近点代进去，没先看式子的形式", Answer(FINITE, (sp.nsimplify(plug),))))
    if den.has(x):
        n0, d0 = (sp.limit(e, x, at, side or "+") for e in (num, den))
        if d0 == 0 and n0 == 0:
            out.append(("把 0/0 当成了定值 0，它是不定式", Answer(FINITE, (sp.Integer(0),))))  # 错因库只收「当定值」
        elif d0 == 0:
            out.append(("把「非零数/0」直接当成 +∞，没看正负和左右", Answer(POS_INF)))
        elif at.is_finite:
            try:
                lh = sp.limit(sp.diff(num, x) / sp.diff(den, x), x, at, side or "+")
                out.append(("已经不是 0/0 了还照搬洛必达", as_answer(lh)))
            except IllDefined:
                pass
    return out


def errors(q: Problem, truth: Answer) -> list[tuple[str, Answer]]:
    if q.kind != "limit":
        return []
    try:
        found = _limit_errors(q)
    except Exception:
        return []
    return [(why, a) for why, a in found if not same(a, truth)]


def _ids(ms: list[Miss]) -> list[Answer]:
    """消融答案去重：同值的答案合并成一个观测，编号就是这里的下标。"""
    out: list[Answer] = []
    for m in ms:
        if not any(same(a, m.answer) for a in out):
            out.append(m.answer)
    return out


def probe(ms: list[Miss]) -> Probe:
    ids = _ids(ms)
    readings: dict[str, list[int]] = {}
    for m in ms:
        readings.setdefault(m.kc, []).append(next(i for i, a in enumerate(ids) if same(a, m.answer)))
    return Probe({k: tuple(v) for k, v in readings.items()})


def diagnose(q: Problem, p: Problem, answer: Answer | None) -> dict:
    """判定规则（补充方案 1.2）。除了判定，还带回正确答案和这道题的观测模型（probe），供掌握度更新用。"""
    truth = solve(q)
    ms = misses(q, p, truth)
    out = {"truth": truth, "probe": probe(ms), "slots": [], "errors": [], "why": []}
    if answer is None:
        return {**out, "verdict": "unparsed", "obs": None}
    if same(answer, truth):
        return {**out, "verdict": "correct", "obs": CORRECT}
    hit = [m for m in ms if same(m.answer, answer)]
    errs = [why for why, a in errors(q, truth) if same(a, answer)]
    if not hit:
        return {**out, "verdict": "error" if errs else "calc", "errors": errs, "obs": OTHER}
    slots = list(dict.fromkeys(m.slot for m in hit))
    return {**out, "verdict": "missed" if len(slots) == 1 and not errs else "review", "slots": slots, "errors": errs,
            "obs": next(i for i, a in enumerate(_ids(ms)) if same(a, answer)), "why": [m.why for m in hit]}


def options(q: Problem, p: Problem, truth: Answer, n: int = 4) -> list[Answer]:
    """选择题选项：正确答案 + 消融答案 + 常见错误，凑不满再补近似的数和同题型的其他结论。"""
    pool = [truth, *(m.answer for m in misses(q, p, truth)), *(a for _, a in errors(q, truth))]
    if truth.kind == FINITE:
        v = truth.value[0]
        pool += [Answer(FINITE, (w,)) for w in (-v, v + 1, v - 1, 2 * v)]
    pool += _FILL[q.kind]
    out: list[Answer] = []
    for a in pool:
        if not any(same(a, b) for b in out):
            out.append(a)
    return out[:n]


def label(q: Problem, sid: str) -> str:
    return f"「{LABELS[q.slot(sid).type]}」{slot_text(q, q.slot(sid))}"
