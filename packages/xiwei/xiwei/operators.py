"""数学线五类前提扰动算子（计划书 2.4.2）。算子只提议「改哪个前提槽、改成什么」，答案一律由求解器算。"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass

import sympy as sp

from .problem import Problem, Slot, to_expr

# 前提类型 → 知识成分：掌握追踪按这个粒度更新（计划书 2.6 ①）
KC = {"point": "趋近点", "side": "单侧方向", "interval": "取值范围", "abs": "绝对值与符号", "param": "绝对值与符号",
      "lower": "积分区间", "upper": "积分区间", "entry": "矩阵秩"}


@dataclass(frozen=True)
class Operator:
    code: str
    types: tuple[str, ...]  # 它改哪类前提槽
    breaks: frozenset[str]  # 改完之后哪些方法不能照搬
    propose: Callable[[Problem, Slot], list[object]]


@dataclass(frozen=True)
class Change:
    op: Operator
    slot: str
    type: str
    new: object

    @property
    def kc(self) -> str:
        return KC[self.type]

    def apply(self, p: Problem) -> Problem:
        return p.with_value(self.slot, self.new)


def _s(e: sp.Expr) -> str:
    return sp.sstr(e)


def _approach(p: Problem, s: Slot) -> list[object]:
    """O1：趋近点改成 0、±∞、原值±1（单侧极限不改成无穷）；方向在双侧、左、右之间换。"""
    at, side = p.approach()
    if s.type == "side":
        return [v for v in ("+", "-", "") if v != side] if at.is_finite else []
    c = to_expr(str(s.value), p.names)
    out = [sp.Integer(0), *([] if side else [sp.oo, -sp.oo]), *([c + 1, c - 1] if c.is_finite else [])]
    return [_s(v) for v in dict.fromkeys(out) if v != c]


def _interval(p: Problem, s: Slot) -> list[object]:
    """O2：端点平移一格，或把区间收到最值点的一侧，让最值换个地方取到。

    子区间只要还含着原来的最值点，最值就不会变，这类候选在这里直接剔掉，不浪费门控次数。
    """
    a, b = (p.value(str(t)) for t in s.value)
    f, x, whole = p.function(), p.x, sp.Interval(a, b)
    best = (sp.maximum if p.ask == "max" else sp.minimum)(f, x, whole)
    at = sp.solveset(sp.Eq(f, best), x, whole)
    at = [c for c in at if c.is_real] if isinstance(at, sp.FiniteSet) else []
    sides = [w for c in at for w in ([a, c - 1], [c + 1, b])]
    out = [[a, b - 1], [a + 1, b], *sides, [a - 1, b], [a, b + 1]]
    keep = [(u, v) for u, v in out if u < v and (u, v) != (a, b) and not (a <= u and v <= b and any(u <= c <= v for c in at))]
    return [[_s(u), _s(v)] for u, v in dict.fromkeys(keep)]


def _sign(p: Problem, s: Slot) -> list[object]:
    """O3：加或去绝对值；参数变号。"""
    if s.type == "abs":
        return [not s.value]
    v = to_expr(str(s.value))
    return [_s(-v)] if v != 0 else []


def _bounds(p: Problem, s: Slot) -> list[object]:
    """O4：上下限跨过被积函数零点、改成无穷限、对称到另一侧。"""
    other = p.first("upper" if s.type == "lower" else "lower")
    v, w = to_expr(str(s.value), p.names), to_expr(str(other.value), p.names)
    zeros = sp.solveset(p.function(), p.x, sp.Interval(-10, 10))
    zeros = [z for z in zeros if z.is_real] if isinstance(zeros, sp.FiniteSet) else []
    out = [sp.oo if s.type == "upper" else -sp.oo, -w, 2 * v, sp.Integer(0), *zeros]
    return [_s(c) for c in dict.fromkeys(out) if c != v and c != w and (c.is_infinite or c.is_real)]


def _matrix(p: Problem, s: Slot) -> list[object]:
    """O5：行列式对单个元素是一次函数，解 det=0 得到让矩阵变奇异的取值；本来奇异就加一。"""
    a, _ = p.matrix()
    i, j = (int(k) - 1 for k in s.name.split(","))
    t = sp.Symbol("t")
    m = a.copy()
    m[i, j] = t
    if a.det() == 0:
        return [_s(a[i, j] + 1)]
    roots = [r for r in sp.solve(m.det(), t) if r.is_real and r != a[i, j]]
    return [_s(r) for r in sorted(roots, key=lambda r: (not r.is_integer, abs(r)))]


OPERATORS = (
    Operator("O1", ("point", "side"), frozenset({"equivalent", "lhopital", "substitute"}), _approach),
    Operator("O2", ("interval",), frozenset({"critical", "endpoint"}), _interval),
    Operator("O3", ("abs", "param"), frozenset({"odd_symmetry", "newton_leibniz"}), _sign),
    Operator("O4", ("lower", "upper"), frozenset({"newton_leibniz", "odd_symmetry"}), _bounds),
    Operator("O5", ("entry",), frozenset({"inverse", "cramer"}), _matrix),
)


def operator_for(slot_type: str) -> Operator:
    return next(op for op in OPERATORS if slot_type in op.types)


def changes(p: Problem) -> Iterator[Change]:
    """这道题所有「只改一处」的候选。算子出错的槽直接跳过，不影响别的槽。"""
    for s in p.slots:
        op = operator_for(s.type)
        try:
            news = op.propose(p, s)
        except Exception:
            continue
        yield from (Change(op, s.id, s.type, v) for v in news)
