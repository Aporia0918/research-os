"""错答反推：提前算好几种典型错答，学生答错时判断是「漏看了改动的条件」还是别的错。"""

from __future__ import annotations

from dataclasses import dataclass, replace

import sympy as sp

from .perturb import Change
from .solve import solve
from .spec import DNE, Answer, Spec, X, same, show
from .text import parse_answer

GENERIC = {"sign", "reciprocal"}


@dataclass(frozen=True)
class Trap:
    kind: str  # ignore / plug / other_side / sign / reciprocal
    value: Answer
    why: str


def direct(spec: Spec) -> sp.Expr | None:
    """直接把趋向点代进去能得到的值；代不进去（0/0、∞ 等）返回 None。"""
    p = spec.at
    if not p.is_finite:
        return None
    try:
        v = spec.concrete.subs(X, p)
    except Exception:
        return None
    return sp.nsimplify(v) if v.is_real and v.is_finite else None


def needs_work(spec: Spec, answer: Answer) -> bool:
    """变式是否要真算：0/0 这类未定式，或趋向无穷时极限是有限数（要比较增长快慢）。
    能直接代入、「非零数/0」直接判无穷、趋向无穷时直接趋于无穷，都算一眼能看出。"""
    p = spec.at
    if not p.is_finite:
        return not isinstance(answer, str) and bool(answer.is_finite)
    if direct(spec) is not None:
        return False
    num, den = sp.fraction(sp.together(spec.concrete))
    try:
        n, d = num.subs(X, p), den.subs(X, p)
    except Exception:
        return True
    return not (d == 0 and n.is_finite and n != 0)


# 公开常见错误清单里的「不定式当成定值」。0/0→0、0/0→不存在 是 ERIC 论文记录的学生原话；
# 其余取值是 Lamar 大学 Paul's Notes 列出的不定式按最常见的想当然取值落地（见 data/common_errors.md）。
FORM_GUESS: dict[str, list[Answer]] = {
    "0/0": [sp.Integer(0), DNE],
    "∞/∞": [sp.Integer(1)],
    "∞-∞": [sp.Integer(0)],
    "0·∞": [sp.Integer(0)],
    "1^∞": [sp.Integer(1)],
    "0^0": [sp.Integer(1)],
    "∞^0": [sp.Integer(1)],
    "c/0": [sp.oo],  # 1/0 = ∞，不看正负和左右
}


def _lim(e: sp.Expr, spec: Spec) -> Answer | None:
    return solve(Spec(e, spec.at, spec.dir)) if e.has(X) else sp.nsimplify(e)


def _zero(v: Answer | None) -> bool:
    return v is not None and not isinstance(v, str) and v == 0


def _inf(v: Answer | None) -> bool:
    return v == DNE or (v is not None and not isinstance(v, str) and bool(v.is_infinite))


def _quotient_form(num: sp.Expr, den: sp.Expr, spec: Spec) -> str | None:
    n, d = _lim(num, spec), _lim(den, spec)
    if _zero(d):
        return "0/0" if _zero(n) else "c/0" if n is not None and not _inf(n) else None
    return "∞/∞" if _inf(n) and _inf(d) else None


def _power_form(f: sp.Pow, spec: Spec) -> str | None:
    b, e = _lim(f.base, spec), _lim(f.exp, spec)
    if b == 1 and _inf(e):
        return "1^∞"
    if _zero(e):
        return "0^0" if _zero(b) else "∞^0" if _inf(b) else None
    return None


def form(spec: Spec) -> str | None:
    """变式在趋向点处是哪种不定式（或「非零数/0」），用来生成公开清单里的典型错答。"""
    f = spec.concrete
    num, den = sp.fraction(sp.together(f))
    if den.has(X):
        return _quotient_form(num, den, spec)
    if isinstance(f, sp.Pow) and f.exp.has(X):
        return _power_form(f, spec)
    lims = [_lim(t, spec) for t in f.args] if isinstance(f, sp.Add | sp.Mul) else []
    if isinstance(f, sp.Add) and sp.oo in lims and -sp.oo in lims:
        return "∞-∞"
    if isinstance(f, sp.Mul) and any(map(_zero, lims)) and any(map(_inf, lims)):
        return "0·∞"
    return None


def blind_lhopital(variant: Spec) -> Answer | None:
    """改了条件后已不是 0/0，学生仍照搬洛必达（上下分别求导）会得到的值。"""
    num, den = sp.fraction(sp.together(variant.concrete))
    if not den.has(X) or direct(variant) is None:
        return None
    return solve(Spec(sp.diff(num, X) / sp.diff(den, X), variant.at, variant.dir))


def _slips(variant: Spec, answer: Answer) -> list[Trap]:
    """和改动无关的常见失手：直接代入、左右弄反、符号反、倒数。"""
    out = []
    if (v := direct(variant)) is not None:
        out.append(Trap("plug", v, "直接把趋向点代进去，没先看式子是什么形式"))
    if variant.at.is_finite and variant.dir != "+-":
        other = solve(replace(variant, dir="-" if variant.dir == "+" else "+"))
        if other is not None:
            out.append(Trap("other_side", other, "左右方向弄反了"))
    if isinstance(answer, str):
        return out
    if answer.is_finite and answer != 0:
        out += [Trap("sign", -answer, "符号弄反了"), Trap("reciprocal", 1 / answer, "上下颠倒了（算成了倒数）")]
    elif answer.is_infinite:
        out.append(Trap("sign", -answer, "符号弄反了（正负无穷）"))
    return out


def traps(original: Answer, variant: Spec, answer: Answer, change: Change, was_hard: bool) -> tuple[list[Trap], bool]:
    """返回 (去重后的典型错答, 「漏看条件」是否能和其他错因区分开)。was_hard：原题不能直接代入。"""
    raw = [Trap("ignore", original, f"漏看了「{change.what}」从 {change.old} 改成 {change.new}，答的还是原题结果")]
    if was_hard and (b := blind_lhopital(variant)) is not None:
        raw.append(Trap("method", b, f"「{change.what}」改了以后已经不是 0/0，可以直接代入，照搬原题的洛必达就错了"))
    if (fm := form(variant)) is not None:
        why = "把 1/0 直接当成 ∞，没看正负和左右" if fm == "c/0" else f"把 {fm} 当成了一个定值，它是不定式，得变形再算"
        raw += [Trap("form", g, why) for g in FORM_GUESS[fm]]
    raw += _slips(variant, answer)

    # 只有「有出处的具体错因」撞上原题答案才算分不开；取负、倒数这类泛泛的错不挡
    clear = all(t.kind in GENERIC or not same(t.value, original) for t in raw[1:])
    kept: list[Trap] = []
    for t in raw:  # 去掉等于正确答案的；同值的只留第一个
        if not same(t.value, answer) and not any(same(t.value, k.value) for k in kept):
            kept.append(t)
    return kept, clear


def judge(text: str, answer: Answer, trap_list: list[Trap], params: tuple = ()) -> tuple[str, str]:
    """学生答案 → (类别, 一句话反馈)。类别：correct / ignore / 其他错因 / unknown / unreadable。"""
    got = parse_answer(text, params)
    if got is None:
        return "unreadable", "没认出这个答案的写法"
    rel = 2e-3 if "." in text else 1e-9  # 学生写小数时按三位有效数字比
    if same(got, answer, rel):
        return "correct", f"对了，答案是 {show(answer)}"
    for t in trap_list:
        if same(got, t.value, rel):
            return t.kind, t.why
    return "unknown", "答错了，但不像是漏看了改动的条件，是别的地方算错了"
