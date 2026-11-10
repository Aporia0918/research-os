"""Judging an exam: where chance lies, where the null worlds land, and whether the real score beats them."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Literal

ALPHA = 0.05
TOLERANCE = 0.05  # how far above chance the null worlds may sit before the pipeline counts as leaking
MIN_RUNS = 19  # the fewest null worlds for which p = 1/(N+1) can reach ALPHA
HALF_CHANCE_METRICS = {"auc", "roc_auc", "balanced_accuracy"}

Outcome = Literal["pass", "fail", "unsure"]


def chance_level(metric: str, labels: list[str]) -> float:
    """Score of a pipeline that learned nothing: majority-class rate for accuracy, 0.5 for AUC, 1/k for balanced."""
    counts = Counter(labels)
    if metric == "accuracy":
        return max(counts.values()) / len(labels)
    if metric == "balanced_accuracy":
        return 1 / len(counts)
    if metric in HALF_CHANCE_METRICS:
        return 0.5
    raise ValueError(f"no chance level known for metric {metric!r}; pass one explicitly")


def quantile(xs: list[float], p: float) -> float:
    s = sorted(xs)
    pos = (len(s) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def p_value(real: float, nulls: list[float]) -> float:
    return (1 + sum(x >= real for x in nulls)) / (len(nulls) + 1)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval for k successes out of n."""
    if n == 0:
        return 0.0, 1.0
    p, zz = k / n, z * z
    centre, half = (p + zz / (2 * n)) / (1 + zz / n), z * math.sqrt(p * (1 - p) / n + zz / (4 * n * n)) / (1 + zz / n)
    return max(0.0, centre - half), min(1.0, centre + half)


@dataclass(frozen=True)
class Verdict:
    outcome: Outcome
    reason: str  # stable code for the UI to word
    chance: float
    p: float | None = None
    null_mean: float | None = None
    null_low: float | None = None  # 2.5% quantile of the null scores


def judge(real: float | None, nulls: list[float | None], chance: float, tolerance: float = TOLERANCE) -> Verdict:
    """fail: even the lower edge of the null worlds is above chance, so the score comes from structure, not signal.
    pass: the null worlds sit at chance and the real score beats them. Anything short of either is unsure."""
    if real is None:
        return Verdict("unsure", "no_real_score", chance)
    if any(x is None for x in nulls):
        return Verdict("unsure", "null_run_failed", chance)
    scores = [x for x in nulls if x is not None]
    if len(scores) < MIN_RUNS:
        return Verdict("unsure", "too_few_runs", chance)
    stats = {"p": p_value(real, scores), "null_mean": sum(scores) / len(scores), "null_low": quantile(scores, 0.025)}
    bar = chance + tolerance
    if stats["null_low"] > bar:
        return Verdict("fail", "null_above_chance", chance, **stats)
    if stats["null_mean"] <= bar and stats["p"] <= ALPHA:
        return Verdict("pass", "real_beats_null", chance, **stats)
    reason = "null_near_threshold" if stats["null_mean"] > bar else "real_not_above_null"
    return Verdict("unsure", reason, chance, **stats)
