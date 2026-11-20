"""求解器：sympy 求极限，再用高精度数值逼近复核，两者一致才算「已核验」。"""

from __future__ import annotations

import signal
from contextlib import contextmanager

import mpmath as mp
import sympy as sp

from .spec import DNE, Answer, Spec, X, same


class Timeout(Exception):
    pass


@contextmanager
def deadline(seconds: int):
    def _raise(*_):
        raise Timeout

    old = signal.signal(signal.SIGALRM, _raise)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def _symbolic(f: sp.Expr, p: sp.Expr, d: str) -> sp.Expr | None:
    try:
        with deadline(4):
            v = sp.limit(f, X, p, d) if p.is_finite else sp.limit(f, X, p)
    except Exception:
        return None
    if v.has(sp.AccumBounds, sp.Limit, sp.zoo, sp.nan, sp.I) or not (v.is_real or v.is_infinite):
        return None
    return sp.nsimplify(v) if v.is_Float else v


def _numeric(f: sp.Expr, p: sp.Expr, d: str, v: sp.Expr) -> bool:
    """在趋向点附近 10^-4、10^-6、10^-8（或 10^4…10^8）处取值，看是否逼近 v。"""
    g = sp.lambdify(X, f, "mpmath")
    with mp.workdps(60):
        if p.is_finite:
            s = 1 if d == "+" else -1
            xs = [mp.mpf(sp.N(p, 60)) + s * mp.mpf(10) ** -k for k in (4, 6, 8)]
        else:
            s = 1 if p == sp.oo else -1
            xs = [s * mp.mpf(10) ** k for k in (4, 6, 8)]
        try:
            ys = [g(x) for x in xs]
        except Exception:
            return False
        if any(isinstance(y, mp.mpc) and abs(y.imag) > 1e-30 for y in ys):
            return False
        ys = [mp.re(y) for y in ys]
        if v.is_infinite:
            sign = 1 if v == sp.oo else -1
            return all(sign * y > 0 for y in ys) and abs(ys[-1]) > 1e3 and abs(ys[-1]) > abs(ys[0])
        target = mp.mpf(sp.N(v, 60))
        errs = [abs(y - target) for y in ys]
        return errs[-1] < 1e-3 * max(1, abs(target)) and errs[-1] <= errs[0] + mp.mpf(10) ** -40


def _side(f: sp.Expr, p: sp.Expr, d: str) -> sp.Expr | None:
    v = _symbolic(f, p, d)
    return v if v is not None and _numeric(f, p, d, v) else None


def solve(spec: Spec) -> Answer | None:
    """已核验的极限值；DNE 表示左右不等；None 表示算不出或两种方法对不上。"""
    f, p = spec.concrete, spec.at
    if not f.has(X):
        return None
    if p.is_finite and spec.dir == "+-":
        right, left = _side(f, p, "+"), _side(f, p, "-")
        if right is None or left is None:
            return None
        return right if same(right, left) else DNE
    return _side(f, p, spec.dir)
