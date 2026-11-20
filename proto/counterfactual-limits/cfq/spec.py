"""一道极限题的结构化表示，以及答案之间的比较。"""

from __future__ import annotations

from dataclasses import dataclass

import sympy as sp

X = sp.Symbol("x")
DNE = "不存在"  # 极限不存在（左右极限不等）

Answer = sp.Expr | str


@dataclass(frozen=True)
class Spec:
    expr: sp.Expr  # 含 x 与参数符号
    point: sp.Expr  # 有限数、oo 或 -oo
    dir: str = "+-"  # "+-" 双侧，"+" 右极限，"-" 左极限
    params: tuple[tuple[sp.Symbol, sp.Expr], ...] = ()

    @property
    def concrete(self) -> sp.Expr:
        return self.expr.subs(dict(self.params))

    @property
    def at(self) -> sp.Expr:
        """代入参数后的趋向点（趋向点本身可以含参数，如 x→a）。"""
        return self.point.subs(dict(self.params))

    def same_as(self, other: Spec) -> bool:
        return (
            self.dir == other.dir
            and same(self.point, other.point)
            and dict(self.params).keys() == dict(other.params).keys()
            and all(same(v, dict(other.params)[k]) for k, v in self.params)
            and sp.simplify(self.expr - other.expr) == 0
        )


def same(a: Answer, b: Answer, rel: float = 1e-12) -> bool:
    """两个答案是否相等（DNE、±∞ 单独处理，其余先数值后符号）。"""
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    if a.is_infinite or b.is_infinite:
        return a == b
    try:
        da, db = complex(sp.N(a, 30)), complex(sp.N(b, 30))
    except (TypeError, ValueError):
        return sp.simplify(a - b) == 0
    return abs(da - db) <= rel * max(1.0, abs(da), abs(db))


def show(a: Answer) -> str:
    """答案的学生写法：e^2、ln2、∞、不存在。"""
    if isinstance(a, str):
        return a
    s = sp.sstr(a)
    for old, new in (("**", "^"), ("oo", "∞"), ("log", "ln"), ("exp(", "e^("), ("sqrt", "√"), ("pi", "π")):
        s = s.replace(old, new)
    return s.replace("E", "e")
