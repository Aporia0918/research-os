"""Command line: `python -m researchos.services.nullworld detect data.csv`, `... exam ...` or `... power ...`."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import ExamSpec, PowerSpec, Table, detect, run_exam, run_power


def _floats(text: str) -> tuple[float, ...]:
    return tuple(float(x) for x in text.split(","))


def _exam_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--script", type=Path, required=True)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--metric", default="accuracy")
    p.add_argument("--runs", type=int, default=20)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--chance", type=float)
    p.add_argument("--project", type=Path)
    p.add_argument("--python", default=sys.executable)
    p.add_argument("--timeout", type=float, default=600.0)
    p.add_argument("--workers", type=int)
    p.add_argument(
        "--allow",
        type=lambda s: tuple(x for x in s.split(",") if x),
        default=(),
        help="columns you confirmed are real measurements, not derived from the label",
    )


def _spec(a: argparse.Namespace) -> ExamSpec:
    extra = {"workers": a.workers} if a.workers else {}
    return ExamSpec(a.script, a.data, a.group, a.label, a.metric, a.runs, getattr(a, "contrast", False), a.seed,
                    a.chance, project=a.project, python=a.python, timeout_s=a.timeout,
                    allow=a.allow, **extra)  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nullworld", description="Null-world exam for ML pipelines")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("detect", help="guess the group and label columns of a CSV").add_argument("data", type=Path)
    e = sub.add_parser("exam", help="run the exam")
    _exam_args(e)
    e.add_argument("--contrast", action="store_true", help="also run naive row shuffles")
    p = sub.add_parser("power", help="planted worlds: detection rate per effect size and number of subjects")
    _exam_args(p)
    p.add_argument("--effects", type=_floats, default=(0.2, 0.5, 0.8), help="effect sizes in SD, e.g. 0.2,0.5,0.8")
    p.add_argument("--fractions", type=_floats, default=(1.0,), help="share of subjects kept, e.g. 0.5,0.75,1")
    a = ap.parse_args(argv)
    if a.cmd == "detect":
        out = asdict(detect(Table.parse(a.data.read_bytes())))
    elif a.cmd == "exam":
        out = run_exam(_spec(a)).to_dict()
    else:
        out = run_power(PowerSpec(_spec(a), a.effects, a.runs, a.fractions)).to_dict()
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
