"""标准答案只由求解器给：SymPy 符号求解，mpmath 独立数值复核（四重门控的门控 2 与门控 4）。"""

from __future__ import annotations

import signal
from contextlib import contextmanager
from dataclasses import dataclass

import mpmath as mp
import sympy as sp
from sympy.calculus.util import maximum, minimum

from .problem import UNKNOWNS, Problem

SECONDS = 2  # 每次 SymPy 调用的时限（计划书 2.4.4）；手机端由网页线程看门狗兜底
FINITE, POS_INF, NEG_INF, DIVERGE, DNE = "num", "oo", "-oo", "diverge", "dne"
UNIQUE, NONE, MANY = "unique", "none", "many"
WORDS = {POS_INF: "∞", NEG_INF: "-∞", DIVERGE: "发散", DNE: "不存在", NONE: "无解", MANY: "无穷多解"}


class IllDefined(Exception):
    """算不出确定的结果：振荡、积分算不出、超时。左右极限不等不算这一类，它的答案是「不存在」。"""


@dataclass(frozen=True)
class Answer:
    kind: str
    value: tuple[sp.Expr, ...] = ()

    def text(self) -> str:
        if self.kind in WORDS:
            return WORDS[self.kind]
        parts = [show(v) for v in self.value]
        return parts[0] if self.kind == FINITE else "，".join(f"{u}={v}" for u, v in zip(UNKNOWNS, parts, strict=False))

    def to_json(self) -> dict:
        return {"kind": self.kind, "value": [sp.sstr(v) for v in self.value], "text": self.text()}


def show(e: sp.Expr) -> str:
    """学生写法：e^2、ln2、√3、π。"""
    s = sp.sstr(e)
    for old, new in (("**", "^"), ("oo", "∞"), ("log(", "ln("), ("exp(", "e^("), ("sqrt", "√"), ("pi", "π"), ("Abs", "abs")):
        s = s.replace(old, new)
    return s.replace("E", "e")


@contextmanager
def deadline(seconds: int = SECONDS):
    """CPython 主线程用 SIGALRM 限时；手机里的 Pyodide 没有信号，交给网页那边的看门狗。"""
    try:
        old = signal.signal(signal.SIGALRM, _timeout)
        signal.alarm(seconds)
    except (AttributeError, ValueError, OSError):
        yield
        return
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def _timeout(*_):
    raise IllDefined("超时")


def as_answer(v: sp.Expr) -> Answer:
    if v == sp.oo:
        return Answer(POS_INF)
    if v == -sp.oo:
        return Answer(NEG_INF)
    if v.has(sp.AccumBounds, sp.Limit, sp.Integral, sp.zoo, sp.nan, sp.I) or not v.is_real:
        raise IllDefined("结果不是确定的实数")
    return Answer(FINITE, (sp.nsimplify(v) if v.is_Float else sp.simplify(v),))


def _limit(p: Problem) -> Answer:
    f, x = p.function(), p.x
    at, side = p.approach()
    if not at.is_finite or side:
        return as_answer(sp.limit(f, x, at, side or "+"))
    right, left = as_answer(sp.limit(f, x, at, "+")), as_answer(sp.limit(f, x, at, "-"))
    return right if right == left else Answer(DNE)


def _integral(p: Problem) -> Answer:
    lo, hi = (p.value(str(p.first(t).value)) for t in ("lower", "upper"))
    v = sp.integrate(p.function().rewrite(sp.Piecewise), (p.x, lo, hi))  # 绝对值先改写成分段，x|x| 这类才积得出
    return Answer(DIVERGE) if v in (sp.oo, -sp.oo, sp.zoo) else as_answer(v)


def _extremum(p: Problem) -> Answer:
    a, b = (p.value(str(t)) for t in p.first("interval").value)
    if not a < b:
        raise IllDefined("区间为空")
    find = maximum if p.ask == "max" else minimum
    return as_answer(find(p.function(), p.x, sp.Interval(a, b)))


def _linear(p: Problem) -> Answer:
    a, b = p.matrix()
    r, ra = a.rank(), a.row_join(b).rank()
    if r < ra:
        return Answer(NONE)
    if r < a.rows:
        return Answer(MANY)
    return Answer(UNIQUE, tuple(sp.nsimplify(v) for v in a.LUsolve(b)))


SOLVERS = {"limit": _limit, "integral": _integral, "extremum": _extremum, "linear_system": _linear}


def solve(p: Problem) -> Answer:
    try:
        with deadline():
            return SOLVERS[p.kind](p)
    except IllDefined:
        raise
    except Exception as e:  # SymPy 解析或求解出错：一律算不良定义，不猜答案
        raise IllDefined(type(e).__name__) from e


# ---- 门控 4：mpmath 独立数值复核 -------------------------------------------------------------------------
def _close(y: mp.mpf, v: mp.mpf, rel: float = 1e-6) -> bool:
    return abs(y - v) <= rel * max(1, abs(v))


def _num(v: sp.Expr) -> mp.mpf:
    return mp.mpf(sp.N(v, mp.mp.dps))


def _check_limit(p: Problem, ans: Answer) -> bool:
    g = sp.lambdify(p.x, p.function(), "mpmath")
    at, side = p.approach()

    def path(s: int) -> list[mp.mpf]:
        """沿一侧逼近的三个点。离得越近相减抵消越厉害，精度随深度加（10^-30 处用 160 位）。"""
        out = []
        for k in ((8, 15, 30) if at.is_finite else (6, 10, 20)):
            with mp.workdps(40 + 4 * k):
                y = g(_num(at) + s * mp.mpf(10) ** -k if at.is_finite else s * mp.mpf(10) ** k)
                if abs(mp.im(y)) > mp.mpf(10) ** -20 * max(1, abs(mp.re(y))):
                    raise ValueError("逼近路上取到了复数")  # 例如负数的非整数次幂，实数范围里没有定义
                out.append(+mp.re(y))
        return out

    sides = ([1] if side == "+" else [-1] if side == "-" else [1, -1]) if at.is_finite else [1 if at == sp.oo else -1]
    paths = [path(s) for s in sides]
    if ans.kind == DNE:  # 左右各自复核，两侧数值确实分开
        return len(paths) == 2 and abs(paths[0][-1] - paths[1][-1]) > 1e-6
    for ys in paths:
        if ans.kind in (POS_INF, NEG_INF):
            sign = 1 if ans.kind == POS_INF else -1
            if not (all(sign * y > 0 for y in ys) and abs(ys[0]) < abs(ys[1]) < abs(ys[2]) and abs(ys[2]) > 10):
                return False
            continue
        v = _num(ans.value[0])
        errs = [abs(y - v) for y in ys]
        if not (_close(ys[-1], v) or (errs[0] > errs[1] > errs[2] and errs[2] < 1e-3 * max(1, abs(v)))):
            return False
    return True


def _roots(e: sp.Expr, x: sp.Symbol, where: sp.Set) -> list[sp.Expr]:
    found = sp.solveset(e, x, where)
    return [r for r in found if r.is_real] if isinstance(found, sp.FiniteSet) else []


def _check_integral(p: Problem, ans: Answer) -> bool:
    f, x = p.function(), p.x
    lo, hi = (p.value(str(p.first(t).value)) for t in ("lower", "upper"))
    g = sp.lambdify(x, f, "mpmath")
    inner = sorted(float(s) for s in sp.singularities(f, x, sp.Interval.open(lo, hi)).intersect(sp.Interval(lo, hi))
                   if s.is_real) if f.is_rational_function(x) else []
    kinks = [_num(k) for a in f.atoms(sp.Abs) for k in _roots(a.args[0], x, sp.Interval.open(lo, hi))]

    def cut(eps: mp.mpf) -> mp.mpf:
        a = _num(lo) + eps if lo.is_finite else -1 / eps
        b = _num(hi) - eps if hi.is_finite else 1 / eps
        pts = [a, *(q for s in inner for q in (mp.mpf(s) - eps, mp.mpf(s) + eps)), b]
        return mp.fsum(mp.quad(g, [pts[i], pts[i + 1]]) for i in range(0, len(pts), 2))

    if ans.kind == DIVERGE:
        small, big = abs(cut(mp.mpf(10) ** -3)), abs(cut(mp.mpf(10) ** -7))
        return big > 2 * small and big > 10
    if inner:
        return False
    a = _num(lo) if lo.is_finite else -mp.inf
    b = _num(hi) if hi.is_finite else mp.inf
    return _close(mp.quad(g, [a, *sorted(kinks), b]), _num(ans.value[0]))  # 绝对值的拐点处分段，积分才准


def _check_extremum(p: Problem, ans: Answer) -> bool:
    g = sp.lambdify(p.x, p.function(), "mpmath")
    a, b = (_num(p.value(str(t))) for t in p.first("interval").value)
    sign = 1 if p.ask == "max" else -1
    xs = [a + (b - a) * i / 2000 for i in range(2001)]
    best = max(xs, key=lambda t: sign * g(t))
    lo, hi = max(a, best - (b - a) / 2000), min(b, best + (b - a) / 2000)
    for _ in range(80):  # 在最好的采样点附近三分法细化
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (m1, hi) if sign * g(m1) < sign * g(m2) else (lo, m2)
    top = max(g(t) * sign for t in (lo, a, b))
    return _close(sign * top, _num(ans.value[0]))


def _check_linear(p: Problem, ans: Answer) -> bool:
    a, b = p.matrix()
    m = mp.matrix([[_num(v) for v in row] for row in a.tolist()])
    rhs = mp.matrix([_num(v) for v in b])

    def rank(rows: list[list[mp.mpf]]) -> int:  # 自己做一遍高斯消元，不借 SymPy 的秩
        rows, r = [list(row) for row in rows], 0
        for c in range(len(rows[0])):
            piv = max(range(r, len(rows)), key=lambda i: abs(rows[i][c]), default=None)
            if piv is None or abs(rows[piv][c]) < mp.mpf(10) ** -30:
                continue
            rows[r], rows[piv] = rows[piv], rows[r]
            for i in range(r + 1, len(rows)):
                k = rows[i][c] / rows[r][c]
                rows[i] = [u - k * w for u, w in zip(rows[i], rows[r], strict=True)]
            r += 1
        return r

    plain = [[m[i, j] for j in range(m.cols)] for i in range(m.rows)]
    ra, rab = rank(plain), rank([row + [rhs[i]] for i, row in enumerate(plain)])
    if ans.kind == NONE:
        return ra < rab
    if ans.kind == MANY:
        return ra == rab < m.rows
    sol = mp.lu_solve(m, rhs)
    return ra == m.rows and all(_close(sol[i], _num(v)) for i, v in enumerate(ans.value))


CHECKS = {"limit": _check_limit, "integral": _check_integral, "extremum": _check_extremum, "linear_system": _check_linear}


def numeric_agrees(p: Problem, ans: Answer) -> bool:
    try:
        with mp.workdps(60), deadline():
            return bool(CHECKS[p.kind](p, ans))
    except Exception:
        return False
