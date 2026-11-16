"""Leakage the null worlds cannot see: a feature column that already holds the label.

Shuffling the label leaves such a column pointing at the old labels, so the script scores at chance in every null
world and the real score beats them all: the exam alone would say *pass*. This screen looks at the table itself,
before any run, for columns that pin the label down on their own:

- a column whose values map one-to-one onto the classes (a second copy of the label, maybe under another name);
- a decimal column whose classes do not overlap at all and sit at least GAP_SD within-class SDs apart.

A real measurement can separate the classes this cleanly too, for instance when the diagnosis was made from it. So
the screen names the column and says why; the person can confirm a column is a genuine measurement and the exam
then leaves it alone (ExamSpec.allow).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from .table import Table, numeric_features

GAP_SD = 3.0  # empty gap between neighbouring classes, in pooled within-class SDs
MIN_PER_CLASS = 3


@dataclass(frozen=True)
class Suspect:
    column: str
    reason: Literal["same_as_label", "separates_label"]
    gap_sd: float | None = None  # separates_label: the narrowest gap between neighbouring classes, in SDs


def _same_as_label(values: list[str], labels: list[str]) -> bool:
    pairs = set(zip(values, labels, strict=True))
    return len(pairs) == len(set(values)) == len(set(labels))


def _gap_sd(values: list[float], labels: list[str]) -> float | None:
    """Narrowest empty gap between neighbouring classes over the pooled within-class SD; None if any classes overlap."""
    by: dict[str, list[float]] = defaultdict(list)
    for v, lab in zip(values, labels, strict=True):
        by[lab].append(v)
    if len(by) < 2 or min(len(xs) for xs in by.values()) < MIN_PER_CLASS:
        return None
    classes = sorted(by.values(), key=lambda xs: sum(xs) / len(xs))
    gaps = [min(hi) - max(lo) for lo, hi in zip(classes, classes[1:], strict=False)]
    if min(gaps) <= 0:
        return None
    var = sum(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / (len(xs) - 1) for xs in classes) / len(classes)
    return math.inf if var == 0 else min(gaps) / math.sqrt(var)


def label_copies(table: Table, group: str, label: str, allow: tuple[str, ...] = ()) -> list[Suspect]:
    """Feature columns that hold the label on their own, in column order. The group and label columns are skipped."""
    labels = table.column(label)
    decimal = set(numeric_features(table, group, label))
    out = []
    for name in table.header:
        if name in (group, label) or name in allow:
            continue
        values = table.column(name)
        if name in decimal:
            gap = _gap_sd([float(v) for v in values], labels)
            if gap is not None and gap >= GAP_SD:
                out.append(Suspect(name, "separates_label", None if math.isinf(gap) else round(gap, 1)))
        elif _same_as_label(values, labels):
            out.append(Suspect(name, "same_as_label"))
    return out
