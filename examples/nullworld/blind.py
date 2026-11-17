"""Blind test of the null-world exam: build datasets whose truth is known, run the exam on them in shuffled order
without telling it the truth, then score its verdicts against the truth.

Cases (each built from several independent synthetic datasets):
  leak_signal     rows split at random, AF signal present        truth: leak    exam should say fail
  leak_nosignal   rows split at random, no AF signal             truth: leak    exam should say fail
  clean_signal    split by subject, AF signal present            truth: clean   exam should say pass
  clean_weak      split by subject, a weak AF signal             truth: clean   pass if 20 worlds have the power
  clean_nosignal  split by subject, no AF signal                 truth: clean   exam should not say pass
  target_leak     split by subject, a feature copies the label   truth: leak    caught by the label-copy screen

`target_leak` is the leak no label shuffle can reveal: a feature that already holds the answer moves with the real
labels, not the shuffled ones, so the null worlds alone pass it. The exam now screens the table for such columns
(screen.py) and fails it with its own reason; the report scores that separately from the structure leaks.

    python blind.py [--datasets 4] [--runs 19] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import runpy
import shutil
import sys
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from random import Random
from typing import Any

from researchos.services.nullworld import ExamSpec, run_exam
from researchos.services.nullworld.verdict import MIN_RUNS, wilson

HERE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Case:
    name: str
    script: str
    signal: float
    morph_is_label: bool
    leak: bool  # the truth
    visible: bool  # whether the leak, if any, is the kind the null worlds catch (False: left to the label-copy screen)


CASES = [
    Case("leak_signal", "leaky.py", 3.0, False, leak=True, visible=True),
    Case("leak_nosignal", "leaky.py", 0.0, False, leak=True, visible=True),
    Case("clean_signal", "fixed.py", 3.0, False, leak=False, visible=True),
    Case("clean_weak", "fixed.py", 0.6, False, leak=False, visible=True),
    Case("clean_nosignal", "fixed.py", 0.0, False, leak=False, visible=True),
    Case("target_leak", "fixed.py", 0.0, True, leak=True, visible=False),
]


def run_blind(
    datasets: int = 4, runs: int = MIN_RUNS, seed: int = 0, workers: int | None = None
) -> list[dict[str, Any]]:
    """One exam per (case, dataset), in an order the exam cannot use; returns one row per exam with its truth."""
    write = runpy.run_path(str(HERE / "make_data.py"))["write_demo"]
    jobs = [(c, d) for c in CASES for d in range(datasets)]
    Random(seed).shuffle(jobs)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for k, (case, d) in enumerate(jobs):
            folder = Path(tmp) / f"exam{k:03d}"  # the folder name carries no hint of the case
            folder.mkdir()
            for f in ("_knn.py", "leaky.py", "fixed.py"):
                shutil.copy(HERE / f, folder / f)
            data = folder / "ecg_features.csv"
            write(data, seed=1000 + d, signal=case.signal, morph_is_label=case.morph_is_label)
            spec = ExamSpec(folder / case.script, data, "subject", "af", runs=runs, contrast=True, seed=k)
            if workers:
                spec = replace(spec, workers=workers)
            r = run_exam(spec)
            naive = [x for x in r.naive if x is not None]
            rows.append(
                {
                    "case": case.name,
                    "dataset": d,
                    "leak": case.leak,
                    "visible": case.visible,
                    "verdict": r.verdict.outcome,
                    "reason": r.verdict.reason,
                    "real": r.real,
                    "null_mean": r.verdict.null_mean,
                    "naive_mean": sum(naive) / len(naive) if naive else None,
                    "chance": r.verdict.chance,
                }
            )
    return sorted(rows, key=lambda x: (x["case"], x["dataset"]))


def score(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Rates with 95% Wilson intervals. The naive row shuffle is scored by the same 'sits above chance' rule."""

    def rate(hits: int, n: int) -> dict[str, Any]:
        lo, hi = wilson(hits, n)
        return {"hits": hits, "n": n, "low": round(lo, 3), "high": round(hi, 3)}

    def naive_flags(x: dict[str, Any]) -> bool:
        return x["naive_mean"] is not None and x["naive_mean"] > x["chance"] + 0.05

    visible_leaks = [x for x in rows if x["leak"] and x["visible"]]
    clean = [x for x in rows if not x["leak"]]
    signal = [x for x in clean if x["case"] == "clean_signal"]
    weak = [x for x in clean if x["case"] == "clean_weak"]
    nosig = [x for x in clean if x["case"] == "clean_nosignal"]
    hidden = [x for x in rows if x["leak"] and not x["visible"]]
    return {
        "leaks_caught": rate(sum(x["verdict"] == "fail" for x in visible_leaks), len(visible_leaks)),
        "leaks_caught_by_naive_shuffle": rate(sum(naive_flags(x) for x in visible_leaks), len(visible_leaks)),
        "false_alarms_on_clean": rate(sum(x["verdict"] == "fail" for x in clean), len(clean)),
        "real_signal_passed": rate(sum(x["verdict"] == "pass" for x in signal), len(signal)),
        "weak_signal_passed": rate(sum(x["verdict"] == "pass" for x in weak), len(weak)),
        "no_signal_passed": rate(sum(x["verdict"] == "pass" for x in nosig), len(nosig)),
        "target_leaks_caught": rate(sum(x["verdict"] == "fail" for x in hidden), len(hidden)),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--datasets", type=int, default=4)
    ap.add_argument("--runs", type=int, default=MIN_RUNS)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args(argv)
    rows = run_blind(a.datasets, a.runs, a.seed)
    summary = score(rows)
    for x in rows:
        print(
            f"{x['case']:15} #{x['dataset']}  {x['verdict']:6} {x['reason']:20} real={x['real']:.3f} "
            f"null={x['null_mean']:.3f} naive={x['naive_mean']:.3f} chance={x['chance']:.3f}"
        )
    print()
    for k, v in summary.items():
        print(f"{k:32} {v['hits']}/{v['n']}  (95% CI {v['low']:.2f}-{v['high']:.2f})")
    if a.json:
        a.json.write_text(json.dumps({"rows": rows, "summary": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
