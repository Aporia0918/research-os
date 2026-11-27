"""掌握追踪与选题（计划书 2.6；补充方案第二部分）。

单个知识成分只看对错时就是标准 BKT（Corbett & Anderson）。一道变式能同时看出几个前提时，在这些前提的掌握状态上做
精确贝叶斯更新：观测不只是对错，还包括「答成了哪个前提的消融答案」；下一题按期望信息增益（EIG）选。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import product

P0, LEARN, SLIP, GUESS = 0.3, 0.1, 0.1, 0.2  # 团队设定的初值；作答数据够了再拟合
ETA, RHO = 0.2, 0.3  # 已掌握者失误时落在消融答案上的比例；未掌握者答错却不是因为漏看的比例（团队设定）
MASTERED = 0.95
CORRECT, OTHER = "correct", "other"


@dataclass(frozen=True)
class Probe:
    """一道候选题能看出什么：每个可诊断的知识成分，它的各种消融读法分别落在哪个错答上（同值错答合并成一个观测）。"""

    readings: dict[str, tuple[int, ...]]

    @property
    def kcs(self) -> tuple[str, ...]:
        return tuple(self.readings)

    @property
    def observations(self) -> list[object]:
        return [CORRECT, OTHER, *sorted({i for r in self.readings.values() for i in r})]


def _likelihood(probe: Probe, unknown: frozenset[str], obs: object, guess: float) -> float:
    if obs == CORRECT:
        return guess if unknown else 1 - SLIP
    if obs == OTHER:
        return (1 - guess) * RHO if unknown else SLIP * (1 - ETA)
    pool = unknown or frozenset(probe.kcs)
    weight = (1 - guess) * (1 - RHO) if unknown else SLIP * ETA
    share = sum(r.count(obs) / len(r) for k in pool if (r := probe.readings[k]))
    return weight * share / len(pool)


def _states(probe: Probe, mastery: dict[str, float]) -> list[tuple[frozenset[str], float]]:
    """前提之间独立：所有「哪些前提没掌握」的组合及其先验概率（最多 2^5 种）。"""
    out = []
    for bits in product((True, False), repeat=len(probe.kcs)):
        prior = math.prod(mastery.get(k, P0) if b else 1 - mastery.get(k, P0) for k, b in zip(probe.kcs, bits, strict=True))
        out.append((frozenset(k for k, b in zip(probe.kcs, bits, strict=True) if not b), prior))
    return out


def _entropy(ps: list[float]) -> float:
    return -sum(p * math.log2(p) for p in ps if p > 0)


Posterior = list[tuple[frozenset[str], float]]


def _joint(probe: Probe, mastery: dict[str, float], obs: object, guess: float) -> tuple[float, Posterior]:
    weighted = [(u, prior * _likelihood(probe, u, obs, guess)) for u, prior in _states(probe, mastery)]
    total = sum(w for _, w in weighted)
    return total, [(u, w / total) for u, w in weighted] if total else []


def info_gain(probe: Probe, mastery: dict[str, float], guess: float = GUESS) -> float:
    """EIG(q) = H(L) − Σ_r P(r)·H(L|r)，单位 bit。"""
    before = _entropy([p for _, p in _states(probe, mastery)])
    after = 0.0
    for obs in probe.observations:
        total, post = _joint(probe, mastery, obs, guess)
        after += total * _entropy([p for _, p in post])
    return before - after


def update(probe: Probe, mastery: dict[str, float], obs: object, guess: float = GUESS) -> dict[str, float]:
    """观测到 obs 之后，各知识成分的边缘掌握概率，再计入学会概率 T。不在这道题里的知识成分不动。"""
    _, post = _joint(probe, mastery, obs, guess)
    out = dict(mastery)
    for k in probe.kcs:
        known = sum(p for u, p in post if k not in u)
        out[k] = known + (1 - known) * LEARN
    return out
