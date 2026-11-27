"""「改一处」变式：候选 → 四重门控 → 目标函数选一道（计划书 2.4.4—2.4.6；选题项按补充方案换成期望信息增益）。"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

import sympy as sp

from . import bkt
from .diagnose import Miss, misses, probe
from .grade import same
from .operators import Change, changes
from .problem import Problem
from .render import LABELS, slot_text, text
from .solve import DNE, Answer, IllDefined, numeric_agrees, solve

TRIES, BUDGET = 3, 8  # 凑够 3 个过门控的候选就停；最多试 8 个，一个都不过就不出题，记「待人工出题」
STOP_BITS, ROUNDS = 0.05, 3  # 信息增益低于 0.05 bit 或一轮出满 3 题就停（补充方案 2.4）
W1, W2, W3, LAMBDA, ALPHA, BETA = 1.0, 1.0, 0.5, 0.2, 0.5, 0.5  # 团队设定的初值（计划书 2.4.5）


@dataclass
class Variant:
    change: Change
    problem: Problem
    answer: Answer
    misses: list[Miss]
    bits: float
    score: float


@dataclass
class Result:
    original: Answer
    variant: Variant | None
    tried: list[dict] = field(default_factory=list)  # 每个过门控的候选：改了哪里、卡在第几道门（0 表示通过）


def key(c: Change) -> str:
    return f"{c.slot}={c.new}"


def changed(a: Answer, b: Answer) -> bool:
    """门控 1：答案确实改变——类别不同直接算变；同类时符号不等价且数值差大于 1e-9。"""
    if a.kind != b.kind:
        return True
    return bool(a.value) and not same(a, b) and any(
        abs(complex(sp.N(u - v, 30))) > 1e-9 for u, v in zip(a.value, b.value, strict=True))


def gate(p: Problem, c: Change, original: Answer) -> tuple[int, Answer | None]:
    """按开销从低到高：门控 3（只比结构）→ 求解（门控 2）→ 门控 1 → 门控 4。返回（卡住的门控号或 0，变式答案）。"""
    q = c.apply(p)
    diff = [s.id for s, t in zip(p.slots, q.slots, strict=True) if s != t]
    if diff != [c.slot] or (p.kind, p.expr, p.rhs) != (q.kind, q.expr, q.rhs):
        return 3, None
    try:
        a = solve(q)
    except IllDefined:
        return 2, None
    if a.kind == DNE:  # 左右极限不等的题留给错答反推用，不拿来当变式
        return 2, None
    if not changed(original, a):
        return 1, None
    return (0, a) if numeric_agrees(q, a) else (4, None)


def cost(p: Problem, c: Change) -> float:
    """改动成本：渲染后题面的记号差 + α·数字复杂度 + β·题面长度变化。"""
    tok = lambda s: re.findall(r"\d+|[a-zA-Zα-ωπ∞]+|\S", s)  # noqa: E731
    a, b = tok(text(p)), tok(text(c.apply(p)))
    edits = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b).get_opcodes()
                if op != "equal")
    nums = [sp.sympify(v) for v in (c.new if isinstance(c.new, list) else [c.new]) if isinstance(v, str) and v not in "+-"]
    messy = sum(1 for v in nums if v.is_number and v.is_finite and (not v.is_integer or abs(v) > 100))
    return edits + ALPHA * messy + BETA * abs(len(b) - len(a)) / 4


def generate(p: Problem, mastery: dict[str, float] | None = None, methods: list[str] | None = None,
             exclude: list[str] | None = None) -> Result:
    """目标函数 W1·类别变 + W2·方法失效 + W3·EIG − λ·成本。先按单槽粗估排序，依次过门控，凑够 TRIES 个再比完整得分。"""
    mastery, used, skip = mastery or {}, set(methods or []), set(exclude or [])
    original = solve(p)  # 原题本身算不出就整题转手动，异常交给调用方
    if original.kind == DNE or not numeric_agrees(p, original):
        raise IllDefined("原题的符号解和数值复核对不上")
    breaks = lambda c: float(bool(c.op.breaks & used))  # noqa: E731
    rough = lambda c: W2 * breaks(c) + W3 * bkt.info_gain(bkt.Probe({c.kc: (0,)}), mastery) - LAMBDA * cost(p, c)  # noqa: E731
    result, passed = Result(original, None), []
    for c in sorted((c for c in changes(p) if key(c) not in skip), key=rough, reverse=True)[:BUDGET]:
        if len(passed) == TRIES:
            break
        failed, a = gate(p, c, original)
        result.tried.append({"op": c.op.code, "slot": c.slot, "new": c.new, "gate": failed})
        if a is None:
            continue
        q = c.apply(p)
        ms = misses(q, p, a)
        bits = bkt.info_gain(probe(ms), mastery) if ms else 0.0
        score = W1 * (a.kind != original.kind) + W2 * breaks(c) + W3 * bits - LAMBDA * cost(p, c)
        passed.append(Variant(c, q, a, ms, bits, score))
    result.variant = max(passed, key=lambda v: v.score, default=None)
    return result


def explain(p: Problem, q: Problem, sid: str) -> str:
    return f"「{LABELS[p.slot(sid).type]}」从 {slot_text(p, p.slot(sid))} 改成了 {slot_text(q, q.slot(sid))}"
