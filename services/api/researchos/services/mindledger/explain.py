"""讲给我听, right after 记一笔: the student explains what the AI just said, point by point, at most three rounds.

Pure functions, no I/O. The reference answer is split into key points; the knowledge point has one of four types
(concept, cause, method, claim), which only decides how a follow-up and a hint are worded. Each point ends in one of
three states, never a score:

  ok      通过    said in substance (enough of its word pairs) and not turned round
  more    需补充  not said
  review  待复核  turned round (正比 for 反比, a dropped 不), or maybe said in other words: neither a pass nor a miss

Inside, 待复核 keeps why (turned or maybe): a turned point blocks a pass, a maybe only keeps a miss from counting.

Round 1 is the student's own explanation. Rounds 2 and 3 each follow up one open point, and no point is followed up
twice. A hint ladder (0 names what kind of point is missing, 1 a keyword, 2 half the point, 3 the point) costs debt:
the level reached maps onto HELP_LEVELS, and the heavier of that and the recorded help decides the weight.

The free grader is a port of the phone's (apps/mobile/src/ledger/ledger.ts gradeFree): word-pair overlap, a turn
guard on word pairs and negation, and a loose cover that only ever makes a point 待复核. An optional semantic
matcher can do the same and nothing more: vector and reranker scores barely see negation, so they never pass a point.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from . import rules
from .judge import BIGRAM_HIT, bigrams, key_points, norm

TYPES = ("concept", "cause", "method", "claim")
STATES = ("ok", "more", "turned", "maybe")  # shown as 通过, 需补充, 待复核, 待复核
MAX_ROUNDS = 3
MAX_HINT = 3
HINT_HELP = ("own", "hint", "approach", "answer")  # hint level 0..3 as a help level: naming the gap costs nothing
LOOSE_MIN_CHARS = 16  # attempts shorter than this are never read as said in other words
LOOSE_POINT = 0.4  # share of a point's characters an attempt uses, without copying it, to make it 待复核 (set on A)
LOOSE_COPIED = 0.35  # a point sharing this many word pairs is matched or missed, not said in other words
SEMANTIC_REVIEW = 0.5  # matcher score (0..1) at or above which a missed point becomes 待复核

# One score per point for one attempt, each 0..1. See semantic.py for the optional local reranker.
Matcher = Callable[[Sequence[str], str], list[float]]

_TYPE_CUES = (  # checked in order on the question: a report's claim before a why, a why before a how
    ("claim", re.compile(r"结论|报告|论文|研究发现|结果表明|这句")),
    ("cause", re.compile(r"为什么|为何|原因|怎么会|何以")),
    ("method", re.compile(r"怎么做|怎样|如何|步骤|怎么算|怎么计算|怎么用|怎么求|求解|计算")),
)

# Word pairs that turn a statement round when the words are kept and one side swapped (same list as the phone).
_TURNS = tuple((re.compile(a), re.compile(b)) for a, b in (
    ("正比", "反比"),
    ("递增|增函数|上升|增大|增加|提高|升高|增强|加快|越大|更快|更强|更高|更久|更大",
     "递减|减函数|下降|减小|减少|降低|减弱|减慢|越小|更慢|更弱|更低|更短|更小"),
    ("高于|大于|多于|超过|以上", "低于|小于|少于|不到|以下"),
    ("内流|流入|进入|吸收", "外流|流出|释放|放出"),
    ("为正|正的|上方|正方向", "为负|负的|下方|反方向"),
    ("相同|一致|一样", "相反"),
    ("打开|开放", "关闭"),
    ("之前|以前", "之后|以后"),
    ("时域到频域|时域转换?到频域|时域转到频域", "频域转换?到时域|频域到时域"),
    ("去极化", "复极化"),
    ("相乘|乘以|乘上|之积", "相加|加上|之和"),
    ("分散|离散", "集中"),
))
_NOT_NEG = re.compile(r"不同|不仅|不断|不久|不少|不过|不管|不论|不但|不如|不错|不然|否则|非常|无论|无数|未来")
_NEG = re.compile(r"[不没未无]|并非|\b(?:not|no|never|cannot)\b|n't\b", re.I)
_CLAUSE = re.compile(r"[，,、。；;！？!?\n]+")
_HAN = re.compile(r"[一-鿿]")

FOLLOW_UP = {  # asks for the missing point without giving it away
    "concept": "还差一个关键特征。换个说法讲讲：它到底是什么，和相近的概念有什么不同？",
    "cause": "原因链上还缺一环。为什么会这样？中间是哪一步在起作用？",
    "method": "有一步没讲到。在这之前或之后还要做什么，为什么要这么做？",
    "claim": "这句结论还少一个说法。它靠什么证据？在什么情况下不成立？",
}
RECHECK = "有一处我拿不准：可能是换了说法，也可能说反了。把这一点再讲一遍，说清楚方向。"
GAP_NAME = {"concept": "定义或特征", "cause": "原因或条件", "method": "步骤", "claim": "依据或局限"}


@dataclass(frozen=True)
class Point:
    text: str
    type: str


def type_of(question: str) -> str:
    return next((t for t, cue in _TYPE_CUES if cue.search(question)), "concept")


def points_of(question: str, reference: str) -> list[Point]:
    t = type_of(question)
    return [Point(p, t) for p in key_points(reference)]


def _negated(s: str) -> bool:
    return bool(_NEG.search(_NOT_NEG.sub(" ", s)))


def _turn(s: str) -> list[int]:
    return [bool(a.search(s)) - bool(b.search(s)) for a, b in _TURNS]


def _share(part: set[str], whole: set[str]) -> float:
    return len(part & whole) / len(part) if part else 0.0


def _han(s: str) -> set[str]:
    return set(_HAN.findall(norm(s)))


def _closest(clause: str, said: Sequence[str]) -> str | None:
    """The attempt clause sharing the most word pairs with this clause of a point; None below three shared."""
    b, best, most = bigrams(clause), None, 2
    for c in said:
        if (n := len(bigrams(c) & b)) > most:
            best, most = c, n
    return best


def turned(point: str, said: Sequence[str]) -> bool:
    """Said back turned round: a clause with a word swapped for its pair, or the point negated where the closest
    part of the attempt is not (or the other way). Negation is judged on the whole point, because a spoken
    explanation moves 不失真 from one clause to the next."""
    parts = [c for c in _CLAUSE.split(point) if len(norm(c)) >= 4]
    near = [_closest(c, said) for c in parts]
    for part, a in zip(parts, near, strict=True):
        if a and any(d and e == -d for d, e in zip(_turn(part), _turn(a), strict=True)):
            return True
    region = "，".join(dict.fromkeys(a for a in near if a))
    return bool(region) and _negated(point) != _negated(region)


def _loose(point: str, attempt: str) -> bool:
    """Possibly said in other words: a fair share of the point's characters without its word pairs."""
    return (len(norm(attempt)) >= LOOSE_MIN_CHARS and _share(bigrams(point), bigrams(attempt)) < LOOSE_COPIED
            and _share(_han(point), _han(attempt)) >= LOOSE_POINT)


def shown(state: str) -> str:
    """The three states the student sees."""
    return "review" if state in ("turned", "maybe") else state


def judge_points(points: Sequence[str], attempt: str, match: Matcher | None = None) -> list[str]:
    """One state per point for one attempt."""
    said = bigrams(attempt)
    clauses = [c for c in _CLAUSE.split(attempt) if len(norm(c)) >= 2]
    scores = match(points, attempt) if match and points else [0.0] * len(points)
    out = []
    for p, score in zip(points, scores, strict=True):
        if _share(bigrams(p), said) >= BIGRAM_HIT:
            out.append("turned" if turned(p, clauses) else "ok")
        else:
            out.append("maybe" if _loose(p, attempt) or score >= SEMANTIC_REVIEW else "more")
    return out


def outcome(states: Sequence[str]) -> str:
    """pass | unsure | fail for a set of point states: a pass needs PASS_RATIO of the points said and none turned
    round; short of that, any 待复核 point makes it unsure."""
    if rules.verdict(states.count("ok"), len(states)) and "turned" not in states:
        return "pass"
    return "unsure" if "turned" in states or "maybe" in states else "fail"


def merge(before: Sequence[str], now: Sequence[str]) -> list[str]:
    """Across rounds a point once said stays said; otherwise the better of the two states."""
    rank = {"ok": 3, "turned": 2, "maybe": 1, "more": 0}
    return [a if rank[a] >= rank[b] else b for a, b in zip(before, now, strict=True)]


def next_point(states: Sequence[str], asked: Sequence[int], rounds: int) -> int | None:
    """The point to follow up next, or None when the session is over: everything said, three rounds used, or every
    open point already followed up once. A point said turned round comes first, then missing ones."""
    if rounds >= MAX_ROUNDS:
        return None
    open_ = [i for i, s in enumerate(states) if s != "ok" and i not in asked]
    return min(open_, key=lambda i: ({"turned": 0, "more": 1}.get(states[i], 2), i), default=None)


def follow_up(point: Point, state: str) -> str:
    return FOLLOW_UP[point.type] if state == "more" else RECHECK


def hint(point: Point, level: int, said: str) -> str:
    """The hint at this level for a point; `said` is everything the student has said so far."""
    if level <= 0:
        return f"还差一个讲{GAP_NAME[point.type]}的要点。"
    if level == 1:
        return f"关键词：「{_keyword(point.text, said)}」"
    if level == 2:
        half = max(len(point.text) // 2, 2)
        return f"开头是：「{point.text[:half]}……」"
    return f"这一点是：「{point.text}」"


def _keyword(point: str, said: str) -> str:
    """The longest run of the point's characters the student has not said, at most six."""
    known, runs, run = _han(said), [""], ""
    for ch in norm(point):
        if _HAN.match(ch) and ch not in known:
            run += ch
        else:
            runs, run = [*runs, run], ""
    best = max([*runs, run], key=len)
    return (best or norm(point))[:6]


def first_rating(help_level: str, result: str) -> int:
    """FSRS rating for the first review (1 again, 2 hard, 3 good): the lower of what the help and the explanation
    say. More help or a weaker explanation means an earlier first review."""
    by_help = {"own": 3, "hint": 3, "approach": 2, "answer": 2}[help_level]
    by_result = {"clean": 3, "followed": 2, "unsure": 2, "failed": 1}[result]
    return min(by_help, by_result)


def settle(help_level: str, thought_first: bool, states: Sequence[str], rounds: int, hint_level: int
           ) -> tuple[str, str | None, int]:
    """End of a session: result (clean | followed | unsure | failed), the debt's weight and the FSRS first rating.
    Clean is a pass in the first round with no hint beyond naming the gap; unsure is left for the phone's
    repayment (or a model) to settle, so it is neither counted as said nor marked 讲不出来."""
    out = outcome(states)
    result = out if out != "pass" else "clean" if rounds == 1 and hint_level <= 0 else "followed"
    result = "failed" if result == "fail" else result
    w = rules.weight(help_level, thought_first)
    if hint_level > 0:
        w = max(filter(None, (w, rules.weight(HINT_HELP[hint_level], False))), key=rules.WEIGHTS.index)
    help_used = help_level if hint_level <= 0 else max(help_level, HINT_HELP[hint_level], key=HINT_HELP.index)
    return result, w, first_rating(help_used, result)
