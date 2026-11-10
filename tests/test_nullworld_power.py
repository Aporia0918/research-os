"""Planted worlds: Wilson intervals, feature selection, the planted shift and detection on the demo."""

from __future__ import annotations

import json
import runpy
import shutil
from pathlib import Path
from statistics import mean, pstdev

import pytest

from researchos.services.nullworld import ExamSpec, PowerSpec, Table, run_power
from researchos.services.nullworld.__main__ import main
from researchos.services.nullworld.runner import RunResult
from researchos.services.nullworld.table import numeric_features
from researchos.services.nullworld.verdict import wilson

DEMO = Path(__file__).resolve().parents[1] / "examples" / "nullworld"


@pytest.fixture
def demo(tmp_path: Path) -> Path:
    for f in ("_knn.py", "fixed.py"):
        shutil.copy(DEMO / f, tmp_path / f)
    runpy.run_path(str(DEMO / "make_data.py"))["write_demo"](tmp_path / "ecg_features.csv")
    return tmp_path


def _spec(demo: Path, **kw: object) -> PowerSpec:
    exam = ExamSpec(demo / "fixed.py", demo / "ecg_features.csv", "subject", "af", workers=4, seed=1)
    return PowerSpec(exam, **kw)  # type: ignore[arg-type]


def test_wilson() -> None:
    assert wilson(0, 20)[0] == 0 and wilson(0, 20)[1] == pytest.approx(0.161, abs=1e-3)
    assert wilson(20, 20)[0] == pytest.approx(0.839, abs=1e-3) and wilson(20, 20)[1] == 1
    assert wilson(0, 0) == (0.0, 1.0)


def test_numeric_features_skip_ids_integers_and_labels(demo: Path) -> None:
    t = Table.parse((demo / "ecg_features.csv").read_bytes())
    assert numeric_features(t, "subject", "af") == ["rr", "morph"]
    assert len(t.subset([0, 2]).rows) == 2


def test_planted_world_shifts_features_by_effect_times_sd(demo: Path) -> None:
    worlds: list[bytes] = []
    run_power(_spec(demo, effects=(1.0,), runs=2, features=("morph",)), lambda b: worlds.append(b) or RunResult(0.5))
    base = [float(v) for v in Table.parse((demo / "ecg_features.csv").read_bytes()).column("morph")]
    shifts = []
    for raw in worlds:  # 2 null worlds (no shift) and 2 planted worlds (class 1 moved by one SD)
        t = Table.parse(raw)
        moved = [float(v) - b for v, b in zip(t.column("morph"), base, strict=True)]
        by_label = {k: mean(m for m, lab in zip(moved, t.column("af"), strict=True) if lab == k) for k in "01"}
        assert by_label["0"] == pytest.approx(0, abs=1e-4)
        shifts.append(round(by_label["1"] / pstdev(base), 3))
    assert sorted(shifts) == [0, 0, 1, 1]


def test_a_failed_null_run_leaves_the_rate_unknown(demo: Path) -> None:
    report = run_power(_spec(demo, effects=(0.5,), runs=3), lambda b: RunResult(None, "boom"))
    assert report.rows[0].rate is None and report.errors == ["boom"]


def test_detection_grows_with_effect_and_subjects(demo: Path) -> None:
    rows = run_power(_spec(demo, effects=(0.2, 1.2), runs=19, fractions=(0.5, 1.0))).rows
    rate = {(r.groups, r.effect): r.rate for r in rows}
    assert rate[(60, 1.2)] > rate[(60, 0.2)] and rate[(60, 1.2)] >= 0.8
    assert rate[(60, 1.2)] >= rate[(30, 1.2)]
    assert all(r.low is not None and r.high is not None and r.low <= (r.rate or 0) <= r.high for r in rows)


def test_cli_power(demo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    args = ["power", "--script", str(demo / "fixed.py"), "--data", str(demo / "ecg_features.csv")]
    assert main([*args, "--group", "subject", "--label", "af", "--runs", "4", "--effects", "1.2"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["features"] == ["rr", "morph"] and out["rows"][0]["runs"] == 4
