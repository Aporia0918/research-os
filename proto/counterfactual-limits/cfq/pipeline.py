"""一道题的完整流程：读题 → 锚定 → 找反事实变式 → 备好错答 → 改写回题面并回读。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import sympy as sp

from .attribute import Trap, direct, needs_work, traps
from .perturb import Change, variants
from .solve import solve
from .spec import Answer, Spec, same
from .text import parse, parse_answer, render

KIND_BONUS = {"param": 1.0, "point": 0.8, "dir": 0.8}  # 题面上写明的条件优先，其次才是式子里的数字


@dataclass
class Variant:
    spec: Spec
    change: Change
    answer: Answer
    traps: list[Trap]
    clear: bool  # 「漏看条件」能否和别的错因分开
    hard: bool  # 变式不能直接代入，得真算
    text: str = ""
    readback: bool = False

    @property
    def score(self) -> float:
        finite = not isinstance(self.answer, str) and self.answer.is_finite
        size = sp.count_ops(self.answer) if finite else 0
        method_trap = any(t.kind == "method" for t in self.traps)
        return (
            3 * self.clear
            + 2.0 * self.hard
            + 1.0 * method_trap  # 「形式变了，方法不能照搬」也是好的反事实
            + KIND_BONUS.get(self.change.kind, 0.5)
            + 1.0 * finite
            - 0.2 * size
        )


@dataclass
class Result:
    text: str
    status: str  # ok / flagged / unverifiable / no_variant / unreadable
    spec: Spec | None = None
    given: Answer | None = None
    truth: Answer | None = None
    picks: list[Variant] = field(default_factory=list)
    found: list[Variant] = field(default_factory=list)  # 全部有效变式（评测用）
    was_hard: bool = False  # 原题不能直接代入
    tried: int = 0
    valid: int = 0
    seconds: float = 0.0


def run(text: str, given_text: str | None, read=parse, keep: int = 3) -> Result:
    t0 = time.perf_counter()
    res = Result(text, "unreadable")
    try:
        res.spec = spec = read(text)
    except Exception:
        return _done(res, t0)
    res.truth = truth = solve(spec)
    if truth is None:
        res.status = "unverifiable"
        return _done(res, t0)
    if given_text is not None:
        res.given = parse_answer(given_text, spec.params)
        if res.given is None or not same(res.given, truth):
            res.status = "flagged"  # 给的答案和求解器对不上：不出变式
            return _done(res, t0)

    res.was_hard = was_hard = direct(spec) is None
    found = res.found
    cands = variants(spec)
    res.tried = len(cands)
    for s, change in cands:
        ans = solve(s)
        if ans is None or same(ans, truth):
            continue
        trap_list, clear = traps(truth, s, ans, change, was_hard)
        found.append(Variant(s, change, ans, trap_list, clear, hard=needs_work(s, ans)))
    res.valid = len(found)

    for v in sorted(found, key=lambda v: -v.score):  # 每种改法最多留一个，保证备选题型不同
        if len(res.picks) < keep and all(p.change.kind != v.change.kind for p in res.picks):
            v.text = render(v.spec)
            try:
                v.readback = read(v.text).same_as(v.spec)
            except Exception:
                v.readback = False
            res.picks.append(v)
    res.status = "ok" if res.picks else "no_variant"
    return _done(res, t0)


def _done(res: Result, t0: float) -> Result:
    res.seconds = time.perf_counter() - t0
    return res
