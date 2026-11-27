"""学生答案 → 答案，再与标准答案比对。比对用 Math-Verify 做符号等价（计划书 2.4 ⑤），不比文字。"""

from __future__ import annotations

import logging
import re

import sympy as sp

from .problem import UNKNOWNS, to_expr
from .solve import DIVERGE, DNE, FINITE, MANY, NEG_INF, NONE, POS_INF, UNIQUE, Answer

_WORDS = [(r"^(无穷多解|无数解|无数个解|无穷多个解)$", MANY), (r"^(无解|没有解)$", NONE),
          (r"^(发散|不收敛|不存在|积分发散)$", DIVERGE), (r"^(-|负)(∞|oo|无穷大?)$", NEG_INF),
          (r"^(\+|正)?(∞|oo|无穷大?)$", POS_INF)]

try:  # 手机里没装上 Math-Verify 时退回 SymPy 比对，结果标出用的是哪条路
    from math_verify import parse as _mv_parse
    from math_verify import verify as _mv_verify

    VERIFIER = "math-verify"
    logging.getLogger("math_verify").setLevel(logging.ERROR)  # 超时由手机端看门狗负责，这条提醒不用每次都打
except ImportError:  # pragma: no cover
    VERIFIER = "sympy"


def _number(t: str) -> sp.Expr | None:
    try:
        v = to_expr(t)
    except Exception:
        v = None
    if v is None or not getattr(v, "is_number", False):
        if VERIFIER != "math-verify":
            return None
        got = _mv_parse(f"${t}$", parsing_timeout=None)  # LaTeX 写法：\frac{1}{2}、e^{2}
        v = got[0] if got and isinstance(got[0], sp.Basic) else None
    return v if v is not None and v.is_number else None


def parse_answer(text: str, kind: str) -> Answer | None:
    """kind 是题型：极限说「不存在」指左右不等（DNE），积分说「不存在」指发散。"""
    t = text.strip().replace(" ", "").replace("＝", "=").rstrip("。.")
    for pattern, k in _WORDS:
        if re.match(pattern, t):
            return Answer(DNE if kind == "limit" and k == DIVERGE else k)
    if kind == "linear_system":
        named = dict(re.findall(r"([xyzw])=([^,，;；]+)", t))
        parts = [named[u] for u in UNKNOWNS if u in named] or re.split(r"[,，;；]", t.strip("()（）"))
        vals = [_number(s) for s in parts]
        return Answer(UNIQUE, tuple(vals)) if vals and None not in vals else None
    v = _number(text.strip().rstrip("。."))  # 保留空格：「tan 1」要读成 tan(1)
    if v is None:
        return None
    return Answer(POS_INF) if v == sp.oo else Answer(NEG_INF) if v == -sp.oo else Answer(FINITE, (v,))


def equal(a: sp.Expr, b: sp.Expr) -> bool:
    if VERIFIER == "math-verify":
        return bool(_mv_verify([a], [b], timeout_seconds=None))
    try:
        return abs(complex(sp.N(a - b, 30))) < 1e-9
    except TypeError:
        return sp.simplify(a - b) == 0


def same(a: Answer | None, b: Answer | None) -> bool:
    if a is None or b is None or a.kind != b.kind or len(a.value) != len(b.value):
        return False
    return all(equal(u, v) for u, v in zip(a.value, b.value, strict=True))
