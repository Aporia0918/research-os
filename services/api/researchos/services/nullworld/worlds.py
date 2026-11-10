"""Null worlds: label permutations that keep the data's group structure, so a pipeline that only memorises
subjects cannot score above chance in them. The naive row shuffle is kept as the contrast."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from random import Random
from typing import Literal

Mode = Literal["between", "within"]


@dataclass(frozen=True)
class Layout:
    mode: Mode  # between: one label per group, permute the group->label map; within: permute inside each group
    groups: int
    fixed_groups: int  # within mode: single-label groups whose labels a within-group permutation cannot move


def _by_group(groups: list[str]) -> dict[str, list[int]]:
    idx: dict[str, list[int]] = defaultdict(list)
    for i, g in enumerate(groups):
        idx[g].append(i)
    return idx


def layout(labels: list[str], groups: list[str]) -> Layout:
    idx = _by_group(groups)
    single = sum(len({labels[i] for i in rows}) == 1 for rows in idx.values())
    if single == len(idx):
        return Layout("between", len(idx), 0)
    return Layout("within", len(idx), single)


def null_labels(labels: list[str], groups: list[str], mode: Mode, rng: Random) -> list[str]:
    """One structure-preserving null world (`mode` from `layout`)."""
    idx = _by_group(groups)
    out = list(labels)
    if mode == "between":
        names = list(idx)
        moved = [labels[idx[g][0]] for g in names]
        rng.shuffle(moved)
        for g, lab in zip(names, moved, strict=True):
            for i in idx[g]:
                out[i] = lab
        return out
    for rows in idx.values():
        vals = [labels[i] for i in rows]
        rng.shuffle(vals)
        for i, v in zip(rows, vals, strict=True):
            out[i] = v
    return out


def naive_labels(labels: list[str], rng: Random) -> list[str]:
    """The row shuffle most tutorials use; it ignores groups and so hides subject leakage."""
    out = list(labels)
    rng.shuffle(out)
    return out
