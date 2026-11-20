"""反事实算子：每个候选变式只改动题目里的一个关键条件。"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace

import sympy as sp

from .spec import Spec, X

POINTS = (sp.Integer(0), sp.Integer(1), sp.Integer(-1), sp.Integer(2), sp.oo, -sp.oo)
SIDE = {"+-": "双侧", "+": "右侧", "-": "左侧"}


@dataclass(frozen=True)
class Change:
    kind: str  # point / dir / param / exponent / coefficient / constant / sign / base
    what: str  # 学生看得懂的条件名，如「趋向点」「参数 a」
    old: str
    new: str

    def __str__(self) -> str:
        return f"{self.what}：{self.old} → {self.new}"


def show_point(p: sp.Expr) -> str:
    return {sp.oo: "∞", -sp.oo: "-∞"}.get(p, sp.sstr(p))


def _walk(e: sp.Expr, path: tuple[int, ...] = ()) -> Iterator[tuple[tuple[int, ...], sp.Expr, sp.Expr]]:
    for i, a in enumerate(e.args):
        yield path + (i,), a, e
        yield from _walk(a, path + (i,))


def _put(e: sp.Expr, path: tuple[int, ...], new: sp.Expr) -> sp.Expr:
    if not path:
        return new
    args = list(e.args)
    args[path[0]] = _put(args[path[0]], path[1:], new)
    return e.func(*args)


def _edits(n: sp.Rational, parent: sp.Expr, idx: int) -> Iterator[tuple[sp.Expr, Change]]:
    """一个可见数字能怎么改：指数、底数、减号、系数、常数项。"""
    if isinstance(parent, sp.Pow) and idx == 1:
        if n.is_Integer and abs(n) >= 2:  # 跳过 -1（除号）和 1/2（根号）
            # 负指数在题面上是分母里的正次方，所以标签用绝对值
            yield from ((m, Change("exponent", "指数", str(abs(n)), str(abs(m)))) for m in (n + 1, n - 1) if m != 0)
    elif isinstance(parent, sp.Pow):
        yield n + 1, Change("base", "底数", str(n), str(n + 1))
    elif isinstance(parent, sp.Mul) and n == -1:
        yield sp.Integer(1), Change("sign", "减号", "−", "+")
    elif isinstance(parent, sp.Mul):
        yield from ((m, Change("coefficient", "系数", str(n), str(m))) for m in (n + 1, -n))
    elif isinstance(parent, sp.Add):
        yield from ((m, Change("constant", "常数项", str(n), str(m))) for m in (-n, n + 1) if m != 0)


def _where(spec: Spec) -> Iterator[tuple[Spec, Change]]:
    """改趋向点或单双侧。"""
    p = spec.at
    for q in POINTS:
        if q != p:
            d = spec.dir if q.is_finite and p.is_finite else "+-"
            yield replace(spec, point=q, dir=d), Change("point", "趋向点", show_point(spec.point), show_point(q))
    if p.is_finite:
        for d in SIDE:
            if d != spec.dir:
                yield replace(spec, dir=d), Change("dir", "单侧/双侧", SIDE[spec.dir], SIDE[d])


def _params(spec: Spec) -> Iterator[tuple[Spec, Change]]:
    """改一个参数的取值。"""
    for i, (k, v) in enumerate(spec.params):
        for w in dict.fromkeys((v + 1, -v, 2 * v, sp.Integer(1), sp.Integer(0))):
            if w != v:
                params = spec.params[:i] + ((k, w),) + spec.params[i + 1 :]
                yield replace(spec, params=params), Change("param", f"参数 {k}", str(v), str(w))


def _numbers(spec: Spec) -> Iterator[tuple[Spec, Change]]:
    """改式子里的一个数字。"""
    for path, n, parent in _walk(spec.expr):
        if n.is_Rational:
            for m, c in _edits(n, parent, path[-1]):
                yield replace(spec, expr=_put(spec.expr, path, m)), c


def variants(spec: Spec) -> list[tuple[Spec, Change]]:
    """所有只改一处的候选（去重，去掉不再含 x 的）。"""
    seen, out = set(), []
    for gen in (_where, _params, _numbers):
        for s, c in gen(spec):
            key = (sp.srepr(s.expr), sp.srepr(s.point), s.dir, s.params)
            if key not in seen and s.concrete.has(X):
                seen.add(key)
                out.append((s, c))
    return out
