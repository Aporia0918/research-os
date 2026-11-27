"""结构 → 学生看到的题面。题面切成片段，带前提编号的片段就是条件卡上要高亮（变式里红框）的地方。"""

from __future__ import annotations

import re

import sympy as sp

from .problem import UNKNOWNS, Problem, Slot, to_expr

Segment = tuple[str, str | None]  # (文字, 前提编号或 None)

LABELS = {"point": "趋近点", "side": "单侧方向", "lower": "积分下限", "upper": "积分上限", "interval": "取值区间",
          "abs": "绝对值与符号", "param": "参数取值", "entry": "系数"}


def pretty(s: str, names: tuple[str, ...] = ()) -> str:
    """一个式子的手写体：2x、x^2、e^x、ln x、√3、π、∞。"""
    try:
        t = sp.sstr(to_expr(s, names, evaluate=False), order="none")
    except Exception:
        return s
    t = _abs(re.sub(r"(?<=[-+] )1\*(?=\d)", "", t))
    for a, b in (("**", "^"), ("oo", "∞"), ("exp(", "e^("), ("log(", "ln("), ("sqrt", "√"), ("pi", "π"),
                 ("atan(", "arctan("), ("asin(", "arcsin(")):
        t = t.replace(a, b)
    t = re.sub(r"\bE\b", "e", t)
    t = re.sub(r"e\^\((\w)\)(?!\^)", r"e^\1", t)
    return re.sub(r"(?<![\^.\d])(\d+)\*(?=[a-zπ(√])", r"\1", t)


def _abs(t: str) -> str:
    """Abs(…) → |…|，括号成对匹配。"""
    while (i := t.find("Abs(")) >= 0:
        depth, j = 0, i + 3
        for j in range(i + 3, len(t)):
            depth += {"(": 1, ")": -1}.get(t[j], 0)
            if depth == 0:
                break
        t = f"{t[:i]}|{t[i + 4:j]}|{t[j + 1:]}"
    return t


def slot_text(p: Problem, s: Slot) -> str:
    v = s.value
    if s.type == "point":
        return f"{p.var}→{pretty(str(v), p.names)}"
    if s.type == "side":
        return {"+": "右极限", "-": "左极限"}.get(str(v), "双侧极限")
    if s.type == "interval":
        return f"[{pretty(str(v[0]), p.names)}, {pretty(str(v[1]), p.names)}]"
    if s.type == "abs":
        if s.name:
            w = pretty(s.name, p.names)
            return f"|{w}|" if v else w
        return f"|{body(p)}|" if v else body(p)
    if s.type == "param":
        return f"{s.name}={pretty(str(v))}"
    return pretty(str(v), p.names)


def body(p: Problem) -> str:
    """被求式的题面（不含最外层绝对值）：去掉了的内层绝对值换成括号。"""
    t = pretty(p.expr, p.names)
    for s in p.of("abs"):
        if s.name and not s.value:
            w = pretty(s.name, p.names)
            t = t.replace(f"|{w}|", w if re.fullmatch(r"[\w.]+", w) else f"({w})")
    return t


def _equations(p: Problem) -> list[Segment]:
    cells = {s.name: s for s in p.of("entry")}
    out: list[Segment] = [("解线性方程组：", None)]
    for i, b in enumerate(p.rhs, 1):
        for j, u in enumerate(UNKNOWNS[: len(p.rhs)], 1):
            s = cells[f"{i},{j}"]
            c = to_expr(str(s.value))
            mag = pretty(str(abs(c)))
            lead = ("-" if c.is_negative else "") if j == 1 else (" - " if c.is_negative else " + ")
            out.append((lead + ("" if mag == "1" else mag), s.id))
            out.append((u, None))
        out.append((f" = {pretty(b)}" + ("；" if i < len(p.rhs) else ""), None))
    return out


def segments(p: Problem) -> list[Segment]:
    if p.kind == "linear_system":
        return _equations(p)
    out: list[Segment] = []
    params = p.of("param")
    if params:
        out.append(("设 ", None))
        for s in params:
            out += [(slot_text(p, s), s.id), ("，", None)]
    whole = next((s for s in p.of("abs") if not s.name), None)
    ids = " ".join(s.id for s in p.of("abs")) or None  # 式子这一段管着所有绝对值槽，前端按空格拆开比对
    expr: Segment = (slot_text(p, whole) if whole else body(p), ids)
    if p.kind == "limit":
        pt, side = p.first("point"), p.first("side")
        out += [("求极限 lim(", None), (slot_text(p, pt), pt.id),
                *([({"+": "⁺", "-": "⁻"}.get(str(side.value), ""), side.id)] if side else []), (") ", None), expr]
    elif p.kind == "integral":
        lo, hi = p.first("lower"), p.first("upper")
        out += [("求定积分 ∫ 从 ", None), (slot_text(p, lo), lo.id), (" 到 ", None), (slot_text(p, hi), hi.id),
                ("，被积函数 ", None), expr, (f" d{p.var}", None)]
    else:
        iv = p.first("interval")
        out += [(f"求 f({p.var}) = ", None), expr, (" 在 ", None), (slot_text(p, iv), iv.id),
                (f" 上的{'最大值' if p.ask == 'max' else '最小值'}", None)]
    return out


def text(p: Problem) -> str:
    return "".join(t for t, _ in segments(p))
