"""规则读题：AI 回答里的 LaTeX（\\lim、\\int）和打字写法 → 题目结构。读不出就交给用户手改。

截图和自由描述要靠大模型按同一结构填（计划书 2.4.1），那一步在手机端，有钥匙才走；这里是没有钥匙时的兜底。
"""

from __future__ import annotations

import re

import sympy as sp

from .problem import UNKNOWNS, Problem, Slot, to_expr

_PARAM = re.compile(r"(?:设|令|其中|已知)\s*((?:[A-Za-z]\s*=\s*[-+]?[\d./]+\s*[,，、和及]?\s*)+)")
_LIM = re.compile(r"lim\s*[({_]?\s*\{?\s*([a-zα-ω])\s*(?:→|->|\\to)\s*([^)}\s]+?)\s*\}?\s*[)}]?\s+(.+)", re.S)
_INT = re.compile(r"∫\s*(?:从\s*)?([^\s^到]+)\s*(?:\^|到)\s*([^\s，,]+)\s*[，,]?\s*(?:被积函数\s*)?(.+?)\s*d([a-z])\b")
_EXT = re.compile(r"f\(([a-z])\)\s*=\s*(.+?)\s*在\s*[\[［]\s*([^,，\]]+)\s*[,，]\s*([^\]］]+?)\s*[\]］]\s*"
                  r"上的?\s*(最大值|最小值)")
_EQ = re.compile(r"[-+]?\s*\d*\s*[xyzw](?:\s*[-+]\s*\d*\s*[xyzw])+\s*=\s*[-+]?\s*[\d./]+")
_LATEX = re.compile(r"\$\$(.+?)\$\$|\\\[(.+?)\\\]|\$(.+?)\$|\\\((.+?)\\\)", re.S)
_CLAIM = re.compile(r"\\boxed\{([^{}]+)\}|(?:答案|结果|极限|积分|最大值|最小值)(?:是|为|等于)[:：]?\s*\$?([^\s$，。,]+)")

# AI 解答里出现的方法 → 方法标签；算子声明会让哪些方法失效（计划书 2.4.5 的「方法失效」项）
METHODS = {"等价无穷小": "equivalent", "sinx~x": "equivalent", "洛必达": "lhopital", "L'Hôpital": "lhopital",
           "直接代入": "substitute", "代入": "substitute", "奇函数": "odd_symmetry", "对称": "odd_symmetry",
           "牛顿-莱布尼茨": "newton_leibniz", "原函数": "newton_leibniz", "驻点": "critical", "导数为零": "critical",
           "端点": "endpoint", "逆矩阵": "inverse", "克拉默": "cramer", "Cramer": "cramer", "消元": "elimination"}


def methods(text: str) -> list[str]:
    return sorted({tag for word, tag in METHODS.items() if word.lower() in text.lower()})


def _params(text: str) -> tuple[list[Slot], str]:
    m = _PARAM.search(text)
    if not m:
        return [], text
    pairs = re.findall(r"([A-Za-z])\s*=\s*([-+]?[\d./]+)", m.group(1))
    return [Slot(f"p{i}", "param", v, k) for i, (k, v) in enumerate(pairs, 1)], text.replace(m.group(0), " ")


def _slots(slots: list[Slot], params: list[Slot]) -> tuple[Slot, ...]:
    """统一编号 c1、c2…：先题目自身的前提，再参数。"""
    return tuple(Slot(f"c{i}", s.type, s.value, s.name) for i, s in enumerate([*slots, *params], 1))


def _point(raw: str) -> tuple[str, str]:
    """「0⁺」「0^{+}」「+∞」→（趋近点，方向）。方向是 "+"、"-" 或 ""。"""
    raw = re.sub(r"[\^{}\s]", "", raw.replace("∞", "oo").replace("⁺", "+").replace("⁻", "-")).removeprefix("+")
    m = re.fullmatch(r"(.+?)([+-])", raw)
    return (m.group(1), m.group(2)) if m else (raw, "")


def _abs(f: str, var: str, wrapped: bool) -> list[Slot]:
    """绝对值前提：最外层一个（有没有都留槽，算子可以加上），式子里每个 |…| 各一个。"""
    inner = sorted({sp.sstr(a.args[0]) for a in to_expr(f, (var,)).atoms(sp.Abs)})
    return [Slot("", "abs", wrapped), *(Slot("", "abs", True, w) for w in inner)]


def _limit(f: str, var: str, at: str, side: str, wrapped: bool, params: list[Slot]) -> Problem:
    """极限的前提：趋近点、方向（趋近无穷时没有）、绝对值。"""
    finite = sp.sympify(at).is_finite is not False
    slots = [Slot("", "point", at), *([Slot("", "side", side)] if finite else []), *_abs(f, var, wrapped)]
    return Problem("limit", f, var, _slots(slots, params))


def _from_latex(tex: str, params: list[Slot]) -> Problem | None:
    from latex2sympy2_extended import latex2sympy  # Math-Verify 自带的 LaTeX 解析器

    side = re.search(r"\\to\s*[^}]*?\^\{?([+-])\}?", tex)
    tex = re.sub(r"\^([+-])(?![{\w])", r"^{\1}", tex)
    try:
        e = latex2sympy(tex)
    except Exception:
        return None
    if isinstance(e, sp.Limit):
        f, x, at, _ = e.args
        return _limit(sp.sstr(f.args[0] if isinstance(f, sp.Abs) else f), str(x), sp.sstr(at),
                      side.group(1) if side else "", isinstance(f, sp.Abs), params)
    if isinstance(e, sp.Integral) and len(e.limits[0]) == 3:
        x, a, b = e.limits[0]
        f, wrapped = (e.function.args[0], True) if isinstance(e.function, sp.Abs) else (e.function, False)
        return Problem("integral", sp.sstr(f), str(x),
                       _slots([Slot("", "lower", sp.sstr(a)), Slot("", "upper", sp.sstr(b)), *_abs(sp.sstr(f), str(x), wrapped)],
                              params))
    return None


def _plain_body(body: str) -> tuple[str, bool]:
    """去掉题面尾巴（句号、「的值」），认出外层绝对值 |…|。"""
    body = re.split(r"[。；;\n]|的值|等于|=", body.strip())[0].strip().rstrip(".，,")
    if whole := re.fullmatch(r"\|([^|]+)\|", body):
        return whole.group(1), True
    return re.sub(r"\|([^|]+)\|", r" Abs(\1) ", body).strip(), False  # 留空格，x|x| 才读成乘法


def _from_plain(text: str, params: list[Slot]) -> Problem | None:
    if m := _LIM.search(text):
        var, pt, body = m.groups()
        f, wrapped = _plain_body(body)
        return _limit(f, var, *_point(pt), wrapped, params)
    if m := _INT.search(text):
        lo, hi, body, var = m.groups()
        f, wrapped = _plain_body(body)
        return Problem("integral", f, var, _slots([Slot("", "lower", _point(lo)[0]), Slot("", "upper", _point(hi)[0]),
                                                   *_abs(f, var, wrapped)], params))
    if m := _EXT.search(text):
        var, body, a, b, which = m.groups()
        f, wrapped = _plain_body(body)
        return Problem("extremum", f, var, _slots([Slot("", "interval", [a.strip(), b.strip()]), *_abs(f, var, wrapped)],
                                                  params), ask="max" if which == "最大值" else "min")
    eqs = _EQ.findall(text.replace(" ", ""))
    if 2 <= len(eqs) <= len(UNKNOWNS):
        names = tuple(UNKNOWNS[: len(eqs)])
        lhs = [to_expr(e.split("=")[0], names) - to_expr(e.split("=")[1], names) for e in eqs]
        a, b = sp.linear_eq_to_matrix(lhs, [sp.Symbol(n, real=True) for n in names])
        entries = [Slot("", "entry", sp.sstr(a[i, j]), f"{i + 1},{j + 1}") for i in range(a.rows) for j in range(a.cols)]
        return Problem("linear_system", var="", slots=_slots(entries, []), ask="solve", rhs=tuple(sp.sstr(v) for v in b))
    return None


def read(text: str) -> tuple[Problem, str | None]:
    """返回（题目结构，AI 给的答案原文或 None）。认不出抛 ValueError。"""
    params, rest = _params(text)
    blocks = [next(g for g in m.groups() if g) for m in _LATEX.finditer(rest)]
    p = next((q for b in blocks if ("\\lim" in b or "\\int" in b) and (q := _from_latex(b, params))), None)
    try:
        p = p or _from_plain(re.sub(r"\\[()\[\]]|\$", " ", rest), params)
        p = p and Problem.from_json(p.to_json())
    except (ValueError, SyntaxError, TypeError, sp.SympifyError):
        p = None
    if p is None:
        raise ValueError("认不出题目，请按「求极限 lim(x→0) sin(x)/x」这样的写法改一下")
    claims = [c for m in _CLAIM.finditer(text) for c in m.groups() if c]
    return p, (claims[-1] if claims else None)
