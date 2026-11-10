"""Null-world exam: tables, worlds, verdict rules, the script runner and the end-to-end demo."""

from __future__ import annotations

import json
import runpy
import shutil
import sys
from collections import Counter
from pathlib import Path
from random import Random

import pytest

from researchos.services.nullworld import ExamSpec, Table, TableError, detect, run_exam
from researchos.services.nullworld.__main__ import main
from researchos.services.nullworld.runner import Job, RunResult, parse_score, run
from researchos.services.nullworld.verdict import MIN_RUNS, chance_level, judge, p_value, quantile
from researchos.services.nullworld.worlds import layout, naive_labels, null_labels

DEMO = Path(__file__).resolve().parents[1] / "examples" / "nullworld"


@pytest.fixture
def demo(tmp_path: Path) -> Path:
    for f in ("_knn.py", "leaky.py", "fixed.py"):
        shutil.copy(DEMO / f, tmp_path / f)
    runpy.run_path(str(DEMO / "make_data.py"))["write_demo"](tmp_path / "ecg_features.csv")
    return tmp_path


# ---------- table ----------


@pytest.mark.parametrize("raw", [b"a,b\n1,x\n2,y\n", "﻿a;b\r\n1;x\r\n2;y\r\n".encode(), b"a\tb\n1\tx\n"])
def test_table_round_trips_delimiter_newline_and_bom(raw: bytes) -> None:
    assert Table.parse(raw).to_bytes() == raw


def test_table_rewrites_one_column_only() -> None:
    t = Table.parse(b"g,y,x\nA,0,1.50\nB,1,2.25\n").with_column("y", ["1", "0"])
    assert t.to_bytes() == b"g,y,x\nA,1,1.50\nB,0,2.25\n"


def test_table_errors() -> None:
    with pytest.raises(TableError):
        Table.parse(b"only_header\n")
    with pytest.raises(TableError):
        Table.parse(b"a\n1\n").column("missing")


def test_detect_finds_subject_and_label(demo: Path) -> None:
    s = detect(Table.parse((demo / "ecg_features.csv").read_bytes()))
    assert s.groups[0].column == "subject" and "ID" in s.groups[0].reason
    assert s.labels[0].column == "af"


# ---------- worlds ----------

GROUPS = [g for g in "ABCDEFGH" for _ in range(3)]
PER_GROUP = [str(i % 2) for i in range(8) for _ in range(3)]


def test_between_world_keeps_one_label_per_group_and_the_group_label_counts() -> None:
    assert layout(PER_GROUP, GROUPS).mode == "between"
    out = null_labels(PER_GROUP, GROUPS, "between", Random(1))
    per_group = {g: {out[i] for i, h in enumerate(GROUPS) if h == g} for g in set(GROUPS)}
    assert all(len(v) == 1 for v in per_group.values())
    assert Counter(out) == Counter(PER_GROUP) and out != PER_GROUP


def test_within_world_permutes_inside_each_group() -> None:
    labels = [str(i % 3) for i in range(len(GROUPS))]
    lay = layout(labels, GROUPS)
    assert lay.mode == "within" and lay.fixed_groups == 0
    out = null_labels(labels, GROUPS, "within", Random(2))
    for g in set(GROUPS):
        assert Counter(o for o, h in zip(out, GROUPS) if h == g) == Counter(x for x, h in zip(labels, GROUPS) if h == g)


def test_within_layout_counts_groups_it_cannot_move() -> None:
    labels = ["0", "0", "0", "0", "1", "0"]
    assert layout(labels, ["A", "A", "A", "B", "B", "B"]).fixed_groups == 1


def test_worlds_are_deterministic_per_seed() -> None:
    a = null_labels(PER_GROUP, GROUPS, "between", Random("7:null:0"))
    assert a == null_labels(PER_GROUP, GROUPS, "between", Random("7:null:0"))
    assert Counter(naive_labels(PER_GROUP, Random(3))) == Counter(PER_GROUP)


# ---------- verdict ----------


def test_chance_levels() -> None:
    assert chance_level("accuracy", ["0", "0", "0", "1"]) == 0.75
    assert chance_level("auc", ["0", "1"]) == 0.5
    assert chance_level("balanced_accuracy", ["a", "b", "c"]) == pytest.approx(1 / 3)
    with pytest.raises(ValueError):
        chance_level("r2", ["0", "1"])


def test_quantile_and_p_value() -> None:
    assert quantile([0.0, 1.0], 0.25) == 0.25
    assert p_value(0.9, [0.5] * 19) == 0.05
    assert p_value(0.5, [0.5] * 19) == 1.0


def test_judge_fail_pass_and_unsure() -> None:
    assert judge(0.96, [0.85] * MIN_RUNS, 0.5).outcome == "fail"
    passed = judge(0.8, [0.5] * MIN_RUNS, 0.5)
    assert (passed.outcome, passed.reason) == ("pass", "real_beats_null")
    spread = [0.40 + 0.01 * i for i in range(MIN_RUNS)]  # 0.40-0.58, mean 0.49
    assert judge(0.55, spread, 0.5).reason == "real_not_above_null"
    assert judge(0.9, [0.5] * (MIN_RUNS - 1), 0.5).reason == "too_few_runs"
    assert judge(0.9, [0.5] * (MIN_RUNS - 1) + [None], 0.5).reason == "null_run_failed"
    assert judge(None, [0.5] * MIN_RUNS, 0.5).reason == "no_real_score"


# ---------- runner ----------


def test_parse_score() -> None:
    assert parse_score("epoch 1\naccuracy: 0.81\naccuracy = 0.93\n", "accuracy") == 0.93
    assert parse_score("Accuracy: 9e-1", "accuracy") == 0.9
    assert parse_score("balanced_accuracy: 0.7", "accuracy") is None
    assert parse_score("auc 0.8", "auc") is None


def _job(tmp_path: Path, body: str, timeout: float = 30) -> Job:
    (tmp_path / "s.py").write_text(body, encoding="utf-8")
    return Job(tmp_path, Path("s.py"), Path("d.csv"), sys.executable, "accuracy", timeout)


def test_run_reads_the_world_data_and_leaves_the_project_alone(tmp_path: Path) -> None:
    (tmp_path / "d.csv").write_text("original")
    job = _job(tmp_path, "print('accuracy:', len(open('d.csv').read()))\nopen('d.csv', 'w').write('x')")
    assert run(job, b"abc").score == 3
    assert (tmp_path / "d.csv").read_text() == "original"


def test_run_reports_failures(tmp_path: Path) -> None:
    assert "exit code 1" in (run(_job(tmp_path, "raise SystemExit('boom')"), b"").error or "")
    assert "printed no" in (run(_job(tmp_path, "print('done')"), b"").error or "")
    slow = run(_job(tmp_path, "import time; time.sleep(30)", timeout=0.5), b"")
    assert slow.score is None and "timed out" in (slow.error or "")


# ---------- exam ----------


def test_exam_with_a_fake_runner_is_deterministic_and_keeps_groups(demo: Path) -> None:
    seen: list[bytes] = []

    def fake(data: bytes) -> RunResult:
        seen.append(data)
        return RunResult(0.5)

    spec = ExamSpec(demo / "fixed.py", demo / "ecg_features.csv", "subject", "af", runs=MIN_RUNS, workers=1, seed=3)
    first = run_exam(spec, fake)
    assert first.verdict.reason == "real_not_above_null" and first.layout.mode == "between"
    tables = [Table.parse(b) for b in seen[1:]]
    assert all(len(set(zip(t.column("subject"), t.column("af"), strict=True))) == 60 for t in tables)
    again: list[bytes] = []
    run_exam(spec, lambda d: again.append(d) or RunResult(0.5))
    assert sorted(again) == sorted(seen)


def test_exam_rejects_data_outside_the_project(demo: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    other = tmp_path_factory.mktemp("elsewhere") / "x.csv"
    shutil.copy(demo / "ecg_features.csv", other)
    with pytest.raises(TableError):
        run_exam(ExamSpec(demo / "fixed.py", other, "subject", "af"))


@pytest.mark.parametrize(("script", "outcome"), [("leaky.py", "fail"), ("fixed.py", "pass")])
def test_demo_end_to_end(demo: Path, script: str, outcome: str) -> None:
    r = run_exam(
        ExamSpec(demo / script, demo / "ecg_features.csv", "subject", "af", runs=MIN_RUNS, contrast=True, workers=4)
    )
    assert r.verdict.outcome == outcome and not r.errors
    assert sum(r.naive) / len(r.naive) < 0.6  # the textbook shuffle sits at chance either way
    assert len(r.data_sha256) == 64


def test_cli_detect(demo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["detect", str(demo / "ecg_features.csv")]) == 0
    assert json.loads(capsys.readouterr().out)["groups"][0]["column"] == "subject"
