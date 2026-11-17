"""Planted worlds (植入世界): how often would this pipeline find an effect of known size?

A planted world starts from a null world and shifts the feature columns by `d` standard deviations per class step
of its (random) label, so the only real signal is the one we put in. A run detects it when its score clears the
97.5% quantile of null worlds built from the same subjects. Repeating this on subsets of subjects shows how
detection grows with the number of subjects; nothing is extrapolated beyond the subjects that exist.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from random import Random
from statistics import pstdev
from typing import Any

from .exam import Data, ExamSpec, Run, distinct_errors, executor, load
from .runner import RunResult
from .table import TableError, numeric_features
from .verdict import quantile, wilson
from .worlds import layout, null_labels


@dataclass(frozen=True)
class PowerSpec:
    exam: ExamSpec
    effects: tuple[float, ...] = (0.2, 0.5, 0.8)
    runs: int = 20  # per effect, plus as many null worlds for the threshold
    fractions: tuple[float, ...] = (1.0,)  # share of subjects kept, e.g. (0.5, 0.75, 1.0)
    features: tuple[str, ...] | None = None  # default: decimal-valued columns other than group and label


@dataclass(frozen=True)
class PowerRow:
    groups: int
    effect: float
    detected: int
    runs: int
    rate: float | None  # None when the null threshold could not be set (a null run failed)
    low: float | None
    high: float | None
    threshold: float | None


@dataclass(frozen=True)
class PowerReport:
    rows: list[PowerRow]
    features: list[str]
    seed: int
    errors: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class _Planter:
    """Builds planted worlds for one subset of subjects."""

    data: Data
    rows: list[int]
    label: str
    values: dict[str, list[float]]  # feature -> value per kept row
    sds: dict[str, float]
    step: dict[str, int]  # label -> class index

    def world(self, effect: float, rng: Random) -> bytes:
        labels = [self.data.labels[i] for i in self.rows]
        groups = [self.data.groups[i] for i in self.rows]
        new = null_labels(labels, groups, layout(labels, groups).mode, rng)
        table = self.data.table.subset(self.rows).with_column(self.label, new)
        for f, vals in self.values.items():
            shift = effect * self.sds[f]
            table = table.with_column(
                f, [f"{v + shift * self.step[lab]:.6g}" for v, lab in zip(vals, new, strict=True)]
            )
        return table.to_bytes()


def _rows(effects: tuple[float, ...], n_groups: int, runs: int, results: list[RunResult]) -> list[PowerRow]:
    null = [r.score for r in results[:runs]]
    threshold = quantile([x for x in null if x is not None], 0.975) if None not in null else None
    out = []
    for k, effect in enumerate(effects):
        chunk = results[(k + 1) * runs : (k + 2) * runs]
        hit = sum(threshold is not None and r.score is not None and r.score > threshold for r in chunk)
        low, high = wilson(hit, runs) if threshold is not None else (None, None)
        rate = hit / runs if threshold is not None else None
        out.append(PowerRow(n_groups, effect, hit, runs, rate, low, high, threshold))
    return out


def run_power(spec: PowerSpec, run: Run | None = None) -> PowerReport:
    ex = spec.exam
    d, execute = load(ex), executor(ex, run)
    features = list(spec.features or numeric_features(d.table, ex.group, ex.label))
    if not features:
        raise TableError("no decimal-valued feature columns to plant an effect in")
    try:
        cols = {f: [float(v) for v in d.table.column(f)] for f in features}
    except ValueError as e:
        raise TableError(f"feature columns must be numeric: {e}") from e
    sds = {f: pstdev(v) or 1.0 for f, v in cols.items()}
    step = {c: i for i, c in enumerate(sorted(set(d.labels)))}
    names = list(dict.fromkeys(d.groups))
    rows: list[PowerRow] = []
    errors: list[RunResult] = []
    with ThreadPoolExecutor(max_workers=ex.workers) as pool:
        for frac in spec.fractions:
            keep = set(Random(f"{ex.seed}:subset:{frac}").sample(names, max(2, round(frac * len(names)))))
            idx = [i for i, g in enumerate(d.groups) if g in keep]
            planter = _Planter(d, idx, ex.label, {f: [cols[f][i] for i in idx] for f in features}, sds, step)
            tasks = [
                (e, Random(f"{ex.seed}:plant:{len(keep)}:{e}:{i}"))
                for e in (0.0, *spec.effects)
                for i in range(spec.runs)
            ]
            results = list(pool.map(lambda t, p=planter: execute(p.world(*t)), tasks))
            rows += _rows(spec.effects, len(keep), spec.runs, results)
            errors += results
    return PowerReport(rows, features, ex.seed, distinct_errors(errors))
