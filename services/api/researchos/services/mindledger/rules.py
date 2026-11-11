"""思维账本 rules: pure functions, no I/O.

One rule drives everything: the more you thought yourself, the less you borrow; the more you borrowed, the
sooner you repay. A repayment is an attempt without AI; only those attempts count toward mastery.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

HELP_LEVELS = ("own", "hint", "approach", "answer")  # 先自己说 / 提示 / 思路 / 完整答案
WEIGHTS = ("light", "medium", "heavy")
# Days until each repayment, counted from the previous pass (the first from the day of borrowing).
# light: once after 3 days. medium: day 1 and day 3. heavy: next day, then a recheck 7 days after that pass.
STEPS: dict[str, tuple[int, ...]] = {"light": (3,), "medium": (1, 2), "heavy": (1, 7)}
EXAM_WINDOW_DAYS = 7  # inside this window before an exam every repayment is pulled forward
PASS_RATIO = 0.6


def weight(help_level: str, thought_first: bool) -> str | None:
    """None means no debt (the idea was the student's own). Writing an idea first lightens the debt one step."""
    if help_level not in HELP_LEVELS:
        raise ValueError(f"help_level must be one of {HELP_LEVELS}")
    if help_level == "own":
        return None
    w = WEIGHTS.index({"hint": "light", "approach": "medium", "answer": "heavy"}[help_level])
    return WEIGHTS[max(w - 1, 0) if thought_first else w]


def front_load(due: date, today: date, exam: date | None) -> date:
    """In the last week before an exam nothing may fall on or after exam day."""
    if exam is None or not today < exam <= today + timedelta(days=EXAM_WINDOW_DAYS) or due < exam:
        return due
    return max(today, exam - timedelta(days=1))


def next_due(weight: str, passes: int, last: date, exam: date | None = None) -> date | None:
    """Next repayment after `passes` successful ones, counted from `last`; None once the debt is settled."""
    steps = STEPS[weight]
    if passes >= len(steps):
        return None
    return front_load(last + timedelta(days=steps[passes]), last, exam)


def retry_due(today: date, exam: date | None = None) -> date:
    """A failed repayment comes back tomorrow."""
    return front_load(today + timedelta(days=1), today, exam)


def verdict(hits: int, points: int) -> bool:
    """Deterministic pass rule. A model may say which key points were hit; it never decides the result."""
    return points > 0 and hits / points >= PASS_RATIO


def status(passes: int, attempts: int, weight: str | None) -> str:
    """own | settled | shaky | untested, from no-AI attempts only."""
    if weight is None:
        return "own"
    if passes >= len(STEPS[weight]):
        return "settled"
    return "shaky" if attempts else "untested"


def independence(statuses: Iterable[str]) -> float | None:
    """Share of entries the student can now do alone: own ideas plus settled debts. None with no entries."""
    s = list(statuses)
    return round(sum(x in ("own", "settled") for x in s) / len(s), 3) if s else None
