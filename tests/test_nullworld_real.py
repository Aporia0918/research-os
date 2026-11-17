"""Null-world exam on real data that ships with scikit-learn: a small, fast version of examples/null_world_real."""

from __future__ import annotations

import runpy
from pathlib import Path

import pytest

from researchos.services.nullworld import Table
from researchos.services.nullworld.screen import label_copies
from researchos.services.nullworld.verdict import MIN_RUNS

pytest.importorskip("sklearn")
pytest.importorskip("pandas")

RUN = runpy.run_path(str(Path(__file__).resolve().parents[1] / "examples" / "null_world_real" / "run.py"))


@pytest.mark.parametrize(("case", "outcome"), [("A", "pass"), ("B2", "fail"), ("B2-ref", "pass")])
def test_breast_cancer_verdicts(case: str, outcome: str) -> None:
    r = RUN["run_case"]("breast_cancer", case, runs=MIN_RUNS, workers=4)
    assert not r["errors"]
    assert r["verdict"] == outcome, r


def test_oversampled_export_keeps_sample_ids_and_balances_classes() -> None:
    plain, over = RUN["export"]("wine"), RUN["export"]("wine", oversample=True)
    assert over["sample_id"].nunique() == len(plain) == 178
    assert set(over["label"].value_counts()) == {71}
    assert over.drop_duplicates().shape[0] == len(plain)  # every extra row is an exact copy of a real one


@pytest.mark.parametrize("name", ["breast_cancer", "wine", "digits"])
def test_label_copy_screen_raises_no_false_alarm_on_real_features(name: str) -> None:
    table = Table.parse(RUN["export"](name).to_csv(index=False).encode())
    assert label_copies(table, "sample_id", "label") == []
