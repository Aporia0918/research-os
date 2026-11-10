"""The null-world exam: run the script on the real data, on structure-preserving null worlds and (optionally) on
naive shuffles, then judge. Deterministic for a given seed; every world's seed is derived from it."""

from __future__ import annotations

import hashlib
import os
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from functools import partial
from pathlib import Path
from random import Random
from typing import Any

from . import runner
from .table import Table, TableError
from .verdict import TOLERANCE, Verdict, chance_level, judge
from .worlds import Layout, layout, naive_labels, null_labels

Run = Callable[[bytes], runner.RunResult]


@dataclass(frozen=True)
class ExamSpec:
    script: Path
    data: Path
    group: str
    label: str
    metric: str = "accuracy"
    runs: int = 20
    contrast: bool = False  # also run as many naive row shuffles, to show what the textbook check would say
    seed: int = 0
    chance: float | None = None  # override when the metric's chance level is not the default
    tolerance: float = TOLERANCE
    project: Path | None = None  # folder the script runs in; defaults to the script's folder
    python: str = sys.executable
    timeout_s: float = 600.0
    workers: int = field(default_factory=lambda: max(1, min(4, (os.cpu_count() or 2) // 2)))


@dataclass(frozen=True)
class ExamReport:
    verdict: Verdict
    real: float | None
    nulls: list[float | None]
    naive: list[float | None]
    layout: Layout
    seed: int
    data_sha256: str
    script_sha256: str
    errors: list[str]  # distinct run errors, first few

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _job(spec: ExamSpec) -> runner.Job:
    project = (spec.project or spec.script.parent).resolve()
    try:
        script, data = spec.script.resolve().relative_to(project), spec.data.resolve().relative_to(project)
    except ValueError as e:
        raise TableError("the script and the data must both be inside the project folder") from e
    return runner.Job(project, script, data, spec.python, spec.metric, spec.timeout_s)


def run_exam(spec: ExamSpec, run: Run | None = None) -> ExamReport:
    """`run` executes the script on one world's table bytes; the default runs it locally as a child process."""
    raw = spec.data.read_bytes()
    table = Table.parse(raw)
    labels, groups = table.column(spec.label), table.column(spec.group)
    if any(g == "" for g in groups):
        raise TableError(f"column {spec.group!r} has empty cells; every row needs a group")
    lay = layout(labels, groups)
    execute: Run = run or partial(runner.run, _job(spec))

    def world(kind: str, i: int) -> bytes:
        rng = Random(f"{spec.seed}:{kind}:{i}")
        new = null_labels(labels, groups, lay.mode, rng) if kind == "null" else naive_labels(labels, rng)
        return table.with_column(spec.label, new).to_bytes()

    tasks = [("null", i) for i in range(spec.runs)] + [("naive", i) for i in range(spec.runs if spec.contrast else 0)]
    with ThreadPoolExecutor(max_workers=spec.workers) as pool:
        real_f = pool.submit(execute, raw)
        results = list(pool.map(lambda t: execute(world(*t)), tasks))
    real = real_f.result()
    nulls, naive = results[: spec.runs], results[spec.runs :]
    chance = spec.chance if spec.chance is not None else chance_level(spec.metric, labels)
    errors = list(dict.fromkeys(r.error for r in [real, *results] if r.error))[:5]
    return ExamReport(
        verdict=judge(real.score, [r.score for r in nulls], chance, spec.tolerance),
        real=real.score,
        nulls=[r.score for r in nulls],
        naive=[r.score for r in naive],
        layout=lay,
        seed=spec.seed,
        data_sha256=hashlib.sha256(raw).hexdigest(),
        script_sha256=hashlib.sha256(spec.script.read_bytes()).hexdigest(),
        errors=errors,
    )
