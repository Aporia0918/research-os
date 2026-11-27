"""题目结构（计划书 2.4.1）：读题只填这份结构，求解器和算子只读写前提槽，主表达式从不改动。"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

KINDS = ("limit", "integral", "extremum", "linear_system")
SLOT_TYPES = ("point", "side", "lower", "upper", "interval", "abs", "param", "entry")
UNKNOWNS = "xyzw"  # 线性方程组的未知数，最多四元

_T = standard_transformations + (implicit_multiplication_application, convert_xor)
_WORDS = {"π": "pi", "∞": "oo", "√": "sqrt", "ln": "log", "arctan": "atan", "arcsin": "asin", "²": "^2", "³": "^3"}


def to_expr(s: str, names: tuple[str, ...] = (), evaluate: bool = True) -> sp.Expr:
    """题面写法 → SymPy（e、π、∞、√、ln、隐式乘法、^ 都认）。变量一律取实数。"""
    for a, b in _WORDS.items():
        s = s.replace(a, b)
    s = re.sub(r"sqrt(\d+)", r"sqrt(\1)", s.replace("−", "-"))
    local = {"e": sp.E, "E": sp.E, **{n: sp.Symbol(n, real=True) for n in names}}
    return parse_expr(s, local_dict=local, transformations=_T, evaluate=evaluate)


@dataclass(frozen=True)
class Slot:
    """一个前提槽。value 是 JSON 值：point 形如 "0"、"oo"；side 是 "+"、"-" 或 ""（双侧）；interval 是两端点；abs 是布尔。"""

    id: str
    type: str
    value: object
    name: str = ""  # 参数名；矩阵元素位置 "行,列"；绝对值槽里被套住的子式（空表示整个式子）


@dataclass(frozen=True)
class Problem:
    kind: str
    expr: str = ""
    var: str = "x"
    slots: tuple[Slot, ...] = ()
    ask: str = "value"  # value | max | min | solve
    rhs: tuple[str, ...] = ()  # 线性方程组右端，不参与扰动

    def slot(self, sid: str) -> Slot:
        return next(s for s in self.slots if s.id == sid)

    def of(self, type_: str) -> list[Slot]:
        return [s for s in self.slots if s.type == type_]

    def first(self, type_: str) -> Slot | None:
        return next(iter(self.of(type_)), None)

    def with_value(self, sid: str, value: object) -> Problem:
        return replace(self, slots=tuple(replace(s, value=value) if s.id == sid else s for s in self.slots))

    @property
    def names(self) -> tuple[str, ...]:
        return (self.var, *(s.name for s in self.of("param")))

    @property
    def params(self) -> dict[sp.Symbol, sp.Expr]:
        return {sp.Symbol(s.name, real=True): to_expr(str(s.value)) for s in self.of("param")}

    def value(self, text: str) -> sp.Expr:
        """槽里的一个取值（可含参数）代入参数后的 SymPy 数。"""
        return to_expr(text, self.names).subs(self.params)

    def approach(self) -> tuple[sp.Expr, str]:
        """极限的趋近点与方向；趋近无穷时方向无意义，按 "" 处理。"""
        at, side = self.value(str(self.first("point").value)), self.first("side")
        return at, (str(side.value) if side is not None and at.is_finite else "")

    def function(self) -> sp.Expr:
        """代入参数、按绝对值槽去掉或套上绝对值后的被求式。式子里的 Abs(…) 各有一个槽，name 为空的槽管最外层。"""
        f = to_expr(self.expr, self.names)
        for s in self.of("abs"):
            if s.name and not s.value:
                inner = to_expr(s.name, self.names)
                f = f.replace(sp.Abs(inner), inner)
        f = f.subs(self.params)
        return sp.Abs(f) if any(s.value and not s.name for s in self.of("abs")) else f

    @property
    def x(self) -> sp.Symbol:
        return sp.Symbol(self.var, real=True)

    def matrix(self) -> tuple[sp.Matrix, sp.Matrix]:
        cells = {tuple(int(i) - 1 for i in s.name.split(",")): to_expr(str(s.value)) for s in self.of("entry")}
        n = len(self.rhs)
        a = sp.Matrix(n, n, lambda i, j: cells.get((i, j), 0))
        return a, sp.Matrix([to_expr(b) for b in self.rhs])

    def to_json(self) -> dict:
        return {"kind": self.kind, "expr": self.expr, "var": self.var, "ask": self.ask, "rhs": list(self.rhs),
                "slots": [{"id": s.id, "type": s.type, "value": s.value, "name": s.name} for s in self.slots]}

    @staticmethod
    def from_json(d: dict) -> Problem:
        """读题结果先过这里：结构不对直接报错，交给用户手改（计划书 2.4.6 ①）。"""
        p = Problem(kind=d["kind"], expr=str(d.get("expr", "")), var=str(d.get("var", "x")), ask=str(d.get("ask", "value")),
                    rhs=tuple(str(b) for b in d.get("rhs", ())),
                    slots=tuple(Slot(str(s["id"]), str(s["type"]), s["value"], str(s.get("name", ""))) for s in d["slots"]))
        problems = [f"前提类型 {s.type}" for s in p.slots if s.type not in SLOT_TYPES]
        if p.kind not in KINDS:
            problems.append(f"题型 {p.kind}")
        if len({s.id for s in p.slots}) != len(p.slots):
            problems.append("前提编号重复")
        if p.kind == "linear_system":
            n = len(p.rhs)
            if not 1 < n <= len(UNKNOWNS) or len(p.of("entry")) != n * n:
                problems.append("方程组需要 2—4 个方程、系数写满")
        elif not p.expr:
            problems.append("缺少式子")
        if problems:
            raise ValueError("结构不对：" + "、".join(problems))
        if p.expr:
            to_expr(p.expr, p.names)  # 解析不了就在这里失败
        return p
