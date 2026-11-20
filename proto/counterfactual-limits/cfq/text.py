"""题目文字 ⇄ 结构化 Spec。

parse() 是「规则读题」：只认打字输入的固定写法（lim(x→0) …）。
截图、手写、自由描述要走 model.py 的模型读题，接口相同。
"""

from __future__ import annotations

import re

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

from .spec import DNE, Answer, Spec, X

_T = standard_transformations + (implicit_multiplication_application, convert_xor)
_WORDS = {"π": "pi", "∞": "oo", "√": "sqrt", "ln": "log", "arctan": "atan", "arcsin": "asin", "²": "^2", "³": "^3"}
_SIDES = {"+": "+", "⁺": "+", "-": "-", "⁻": "-"}
_LIM = re.compile(r"lim\s*[({]?\s*(\w+)\s*(?:→|->)\s*([^)}]+?)\s*[)}]\s*(.+?)\s*[。.]?\s*$")
_PARAM = re.compile(r"([A-Za-z])\s*=\s*([-+]?[\d./]+)")


def _expr(s: str, local: dict) -> sp.Expr:
    for a, b in _WORDS.items():
        s = s.replace(a, b)
    s = re.sub(r"sqrt(\d+)", r"sqrt(\1)", s)
    return parse_expr(s, local_dict={"e": sp.E, **local}, transformations=_T)


def parse(text: str) -> Spec:
    head, _, body = text.partition("lim")
    params = tuple((sp.Symbol(k), sp.nsimplify(v)) for k, v in _PARAM.findall(head))
    m = _LIM.search("lim" + body)
    if not m:
        raise ValueError(f"认不出极限式：{text}")
    var, point, expr = m.groups()
    local = {var: X, **{str(k): k for k, _ in params}}
    side = "+-"
    if len(point) > 1 and point[-1] in _SIDES and not point.endswith("∞"):
        point, side = point[:-1].rstrip("^"), _SIDES[point[-1]]
    point = point.lstrip("+")
    return Spec(_expr(expr, local), _expr(point, local), side, params)


def parse_answer(text: str, params: tuple = ()) -> Answer | None:
    t = text.strip()
    key = t.replace(" ", "")
    if key in {"不存在", "极限不存在", "DNE"}:
        return DNE
    t = {"正无穷": "∞", "+∞": "∞", "无穷大": "∞", "无穷": "∞", "负无穷": "-∞"}.get(key, t)
    try:
        v = _expr(t, {str(k): k for k, _ in params}).subs(dict(params))
    except Exception:
        return None
    return v if v.is_number else None


def _show_expr(e: sp.Expr) -> str:
    s = sp.sstr(e)
    for a, b in (("**", "^"), ("exp(", "e^("), ("log(", "ln("), ("atan(", "arctan("), ("pi", "π")):
        s = s.replace(a, b)
    s = re.sub(r"\bE\b", "e", s)
    s = re.sub(r"e\^\((\w)\)(?!\^)", r"e^\1", s)  # e^(x) → e^x
    return re.sub(r"(?<!\^)(\d)\*(?=[a-zπ(])", r"\1", s)  # 2*x → 2x


def render(spec: Spec, var: str = "x") -> str:
    """Spec → 学生看到的题面。"""
    head = "，".join(f"{k}={sp.sstr(v)}" for k, v in spec.params)
    p = {sp.oo: "∞", -sp.oo: "-∞"}.get(spec.point, _show_expr(spec.point))
    side = "" if spec.dir == "+-" else spec.dir
    body = _show_expr(spec.expr).replace("x", var) if var != "x" else _show_expr(spec.expr)
    return (f"设 {head}，" if head else "") + f"求极限 lim({var}→{p}{side}) {body}"
