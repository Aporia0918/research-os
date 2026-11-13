"""Null-world exam on real public datasets that ship inside scikit-learn (no download, no network).

Each dataset is exported to CSV the way a person would hand it over (a `sample_id` column, the features, a `label`
column), then the unchanged engine examines five unchanged sklearn scripts:

  A        honest.py              scaler + logistic regression inside each CV fold
  B1       select_leaky.py        scaler + SelectKBest(k=10) fitted on all rows before CV
  B1-ref   select_honest.py       the same steps inside each fold
  B2       oversampled_leaky.py   table oversampled before the split, random forest, folds cut by row
  B2-ref   oversampled_honest.py  the same table and model, folds cut by sample_id

    python run.py [--runs 99] [--datasets breast_cancer,wine,digits] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn import datasets

from researchos.services.nullworld import ExamSpec, run_exam
from researchos.services.nullworld.verdict import quantile

HERE = Path(__file__).resolve().parent
LOADERS = {"breast_cancer": datasets.load_breast_cancer, "wine": datasets.load_wine, "digits": datasets.load_digits}
CASES = {  # name -> (script, oversampled table)
    "A": ("honest.py", False),
    "B1": ("select_leaky.py", False),
    "B1-ref": ("select_honest.py", False),
    "B2": ("oversampled_leaky.py", True),
    "B2-ref": ("oversampled_honest.py", True),
}


def export(name: str, oversample: bool = False, seed: int = 0) -> pd.DataFrame:
    """One row per sample. `oversample` copies random rows of each smaller class until every class is as large as the
    biggest one, keeping each copy's sample_id: the random oversampling often done before cross-validation."""
    bunch = LOADERS[name](as_frame=True)
    df = bunch.data.copy()
    df.insert(0, "sample_id", [f"s{i:04d}" for i in range(len(df))])
    df["label"] = np.asarray(bunch.target_names)[bunch.target]
    if oversample:
        rng, biggest = np.random.default_rng(seed), df["label"].value_counts().max()
        extra = [g.iloc[rng.integers(0, len(g), biggest - len(g))] for _, g in df.groupby("label")]
        df = pd.concat([df, *extra], ignore_index=True)
    return df


def run_case(dataset: str, case: str, runs: int = 99, seed: int = 0, workers: int | None = None) -> dict[str, Any]:
    script, oversample = CASES[case]
    with tempfile.TemporaryDirectory() as tmp:
        project = Path(tmp)
        shutil.copy(HERE / "scripts" / script, project / script)
        table = export(dataset, oversample)
        table.to_csv(project / "data.csv", index=False)
        spec = ExamSpec(project / script, project / "data.csv", "sample_id", "label", runs=runs, seed=seed)
        started = time.monotonic()
        r = run_exam(replace(spec, workers=workers) if workers else spec)
        seconds = time.monotonic() - started
    nulls = [x for x in r.nulls if x is not None]
    v = r.verdict
    return {
        "dataset": dataset,
        "case": case,
        "script": script,
        "rows": len(table),
        "chance": v.chance,
        "real": r.real,
        "null_mean": v.null_mean,
        "null_p95": quantile(nulls, 0.95) if nulls else None,
        "p": v.p,
        "verdict": v.outcome,
        "reason": v.reason,
        "seconds": round(seconds, 1),
        "errors": r.errors,
    }


def fmt(x: float | None) -> str:
    return "-" if x is None else f"{x:.3f}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", type=int, default=99)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--datasets", default=",".join(LOADERS))
    ap.add_argument("--json", type=Path)
    a = ap.parse_args(argv)
    print("| dataset | case | rows | chance | real | null mean | null p95 | p | verdict | seconds |")
    print("|---|---|---|---|---|---|---|---|---|---|", flush=True)
    rows = []
    for d in a.datasets.split(","):
        for c in CASES:
            rows.append(x := run_case(d, c, a.runs, a.seed))
            cells = [d, c, x["rows"], *map(fmt, [x[k] for k in ("chance", "real", "null_mean", "null_p95", "p")])]
            print("| " + " | ".join(map(str, [*cells, f"{x['verdict']} ({x['reason']})", x["seconds"]])) + " |")
            for e in x["errors"]:
                print(f"    error: {e}")
            sys.stdout.flush()
    if a.json:
        a.json.write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
