"""Command line: `python -m researchos.services.nullworld detect data.csv` or `... exam --script ... --data ...`."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import ExamSpec, Table, detect, run_exam


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nullworld", description="Null-world exam for ML pipelines")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect", help="guess the group and label columns of a CSV")
    d.add_argument("data", type=Path)
    e = sub.add_parser("exam", help="run the exam")
    e.add_argument("--script", type=Path, required=True)
    e.add_argument("--data", type=Path, required=True)
    e.add_argument("--group", required=True)
    e.add_argument("--label", required=True)
    e.add_argument("--metric", default="accuracy")
    e.add_argument("--runs", type=int, default=20)
    e.add_argument("--contrast", action="store_true", help="also run naive row shuffles")
    e.add_argument("--seed", type=int, default=0)
    e.add_argument("--chance", type=float)
    e.add_argument("--project", type=Path)
    e.add_argument("--python", default=sys.executable)
    e.add_argument("--timeout", type=float, default=600.0)
    e.add_argument("--workers", type=int)
    a = ap.parse_args(argv)
    if a.cmd == "detect":
        out = asdict(detect(Table.parse(a.data.read_bytes())))
    else:
        extra = {"workers": a.workers} if a.workers else {}
        spec = ExamSpec(
            a.script,
            a.data,
            a.group,
            a.label,
            a.metric,
            a.runs,
            a.contrast,
            a.seed,
            a.chance,
            project=a.project,
            python=a.python,
            timeout_s=a.timeout,
            **extra,
        )
        out = run_exam(spec).to_dict()
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
