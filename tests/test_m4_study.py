"""M4 gate: the 6-stage protocol on a planted-effect surface recovers the planted effects, does not report the null
factor, finds the failure region, narrows the space (covered by the original approval), never touches the test
split before final_eval, runs the negative control, and evaluates the test split exactly once after approval."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest

from researchos.services.container import Services
from researchos.services.verification.analysis import anova, winners_curse
from researchos.services.verification.recompute import accuracy
from researchos.services.verification.regions import failure_rules, group_bootstrap_ci

from .conftest import Client
from .fixtures.make_dataset import make
from .m1_helpers import drain
from .m2_helpers import approve, new_plan, plan_content

SPACE = {
    "lr": {"low": 0.0001, "high": 1.0, "log": True},
    "batch": {"low": 16, "high": 128, "int": True, "log": True},
    "dropout": {"low": 0.0, "high": 0.5},
}
PROTOCOL = {
    "objective": "score",
    "factors": ["lr", "batch", "dropout"],
    "chance": 1 / 3,
    "search": {"sampler": "qmc", "max_trials": 10, "batch": 5, "patience_batches": 2},
    "confirm": {"top": 3, "seeds": 5},
}


@pytest.fixture
def study(client: Client, conn: sqlite3.Connection, svc: Services, tmp_path: Path) -> dict[str, Any]:
    ds = client.post("/api/v1/datasets", json={"path": str(make(tmp_path / "d"))}).json()
    pid = new_plan(
        client,
        plan_content(
            client,
            ds,
            template="planted",
            params={},
            space=SPACE,
            metrics=["score"],
            limits={"max_minutes": 2, "stall_s": 30, "max_trials": 60},
        ),
    )
    st = client.post("/api/v1/studies", json={"plan_id": pid, "revision": 1, "protocol": PROTOCOL}).json()
    drain(conn, svc, max_tasks=200)  # worker auto-advances the study after every finished run
    return {"pid": pid, "sid": st["id"]}


def test_full_protocol_on_planted_surface(
    study: dict[str, Any], client: Client, conn: sqlite3.Connection, svc: Services, settings: Any
) -> None:
    st = client.get(f"/api/v1/studies/{study['sid']}").json()
    assert st["stage"] == "awaiting_final_approval", st["data"].get("stop_reason")
    screen = st["data"]["screen"]
    eff = {e["term"]: e for e in screen["anova"]["effects"]}
    assert eff["lr"]["reported"]  # planted main effect recovered
    # the planted lr x batch interaction kills the (lr=high, batch=low) corner, so that cell is missing and the
    # interaction is aliased with the main effects: reported NOT ESTIMABLE (ADR-118), captured by the failure rule
    assert "NOT ESTIMABLE" in eff["lr:batch"]["statement"] and not eff["lr:batch"]["reported"]
    assert not eff["dropout"]["reported"]  # null factor not reported
    assert "NOT ESTIMABLE" in eff["lr:batch:dropout"]["statement"]  # missing cells are never "no effect"
    # The failed (lr=high, batch=low) corner invalidates the factorial-center contrast (ADR-123).
    # Unavailable is not evidence of no curvature; the remaining protocol must still complete.
    assert screen["anova"]["curvature"] is None
    assert any("lr >" in r["rule"] and "batch <=" in r["rule"] for r in screen["failure_rules"])
    assert screen["change_kind"] == "narrowing"  # covered by the original approval
    rev = client.get(f"/api/v1/plans/{study['pid']}/revisions/{screen['revision']}").json()
    assert rev["content"]["space"]["dropout"]["low"] == rev["content"]["space"]["dropout"]["high"]
    assert rev["approved_by_revision"] == 1
    assert st["data"]["control"]["passed"] and len(st["data"]["control"]["runs"]) == 3  # three null worlds
    assert st["data"]["winners_curse"] > 0
    assert len(st["data"]["confirm"]) == 3 and all(c["n"] == 5 and "d11" in c for c in st["data"]["confirm"])
    surf = st["data"]["surface"]
    assert "association" in surf["note"] and surf["n"] > 20
    assert any(t["term"] == "I(lr ** 2)" and t["associated"] for t in surf["terms"]), surf
    # no test split was ever materialized before final evaluation
    assert not list(settings.runs_dir.glob("*/inputs/test.npz"))
    approve(client, "final_eval", f"{study['pid']}@{st['current_revision']}")
    assert client.post(f"/api/v1/studies/{study['sid']}/advance").json()["stage"] == "final"
    drain(conn, svc, max_tasks=5)
    done = client.get(f"/api/v1/studies/{study['sid']}").json()
    assert done["stage"] == "completed" and done["data"]["final"]["objective"] is not None
    assert len(list(settings.runs_dir.glob("*/inputs/test.npz"))) == 1  # test seen exactly once
    r = client.post(
        f"/api/v1/plans/{study['pid']}/revisions/{st['current_revision']}/runs",
        json={"stage": "final_eval", "params": done["data"]["frozen"]},
    )
    assert r.json()["code"] == "final_eval_already_done"


def test_no_false_effects_on_pure_noise() -> None:
    import random

    rng = random.Random(1)
    rows = [{"a": a, "b": b, "seed": s, "y": rng.gauss(0.5, 0.01)} for a in (0, 1) for b in (0, 1) for s in range(5)]
    res = anova(rows, ["a", "b"], "y")
    assert not any(e.reported for e in res.effects)


def test_failure_rules_and_bootstrap() -> None:
    pts = [{"lr": lr, "batch": b} for lr in (0.001, 0.01, 0.5, 1.0) for b in (16, 64, 128) for _ in range(2)]
    failed = [p["lr"] > 0.3 and p["batch"] < 32 for p in pts]
    rules = failure_rules(pts, failed)
    assert rules and rules[0]["purity"] == 1.0 and rules[0]["support"] >= 4
    assert failure_rules(pts, [False] * len(pts)) == []
    rows = [
        {"sample_id": f"s{s}-{i}", "y_true": "a", "y_pred": "a" if (s + i) % 4 else "b"}
        for s in range(6)
        for i in range(8)
    ]
    ci = group_bootstrap_ci(rows, lambda sid: sid.split("-")[0], accuracy, b=300)
    assert ci["groups"] == 6 and ci["ci_low"] <= ci["estimate"] <= ci["ci_high"]
    assert winners_curse(0.01, 1) is None and winners_curse(0.01, 50) > 0.02


def test_factor_with_interaction_only_is_not_fixed() -> None:
    from researchos.services.execution.study import _negligible
    from researchos.services.verification.analysis import Effect

    def e(term: str, eta: float | None, rep: bool) -> Effect:
        return Effect(
            term,
            1,
            1.0 if eta is not None else None,
            0.5 if eta is not None else None,
            0.5 if eta is not None else None,
            eta,
            rep,
            "",
        )

    crossed = [e("a", 0.001, False), e("b", 0.5, True), e("a:b", 0.4, True)]
    assert not _negligible(crossed, "a")  # no main effect, but a real a:b interaction
    unknown = [e("a", 0.001, False), e("b", 0.5, True), e("a:b", None, False)]
    assert not _negligible(unknown, "a")  # inestimable interaction = unknown, never "absent"
    assert _negligible([e("a", 0.001, False), e("b", 0.5, True), e("a:b", 0.002, False)], "a")


def test_failed_runs_excluded_from_sigma_and_curvature() -> None:
    """Regression (review #1): a failed run (None/NaN response) must not crash or pollute the noise floor."""
    rows = [
        {"a": a, "b": b, "seed": s, "y": 0.5 + 0.1 * a + 0.01 * s} for a in (0, 1) for b in (0, 1) for s in range(3)
    ]
    rows += [{"a": 0, "b": 0, "seed": 9, "y": None}, {"a": 1, "b": 1, "seed": 9, "y": float("nan")}]
    rows += [{"a": 0.5, "b": 0.5, "seed": s, "is_center": True, "y": 0.6} for s in range(3)]
    rows += [{"a": 0.5, "b": 0.5, "seed": 9, "is_center": True, "y": None}]
    res = anova(rows, ["a", "b"], "y")
    clean = anova([r for r in rows if r["seed"] != 9], ["a", "b"], "y")
    assert res.seed_sigma == clean.seed_sigma and res.n == clean.n == 12
    assert res.curvature == clean.curvature
    assert any("3 run(s) without a finite response" in n for n in res.notes)


def test_surface_skips_quadratic_for_two_level_factor() -> None:
    """Regression (review #2): a 2-level factor gets no (aliased) squared term; aliased designs are refused."""
    import random

    from researchos.services.verification.analysis import surface

    rng = random.Random(3)
    rows = [{"a": a, "b": b, "y": 0.3 * a - b * b + rng.gauss(0, 0.01)} for a in (0, 1) for b in (0, 1, 2, 3, 4)]
    rows *= 2
    res = surface(rows, ["a", "b"], "y")
    names = {t["term"] for t in res["terms"]}
    assert "I(a ** 2)" not in names and "I(b ** 2)" in names and res["linear_only"] == ["a"]
    aliased = [{"a": v, "b": 2 * v, "y": v + rng.gauss(0, 0.01)} for v in (0, 1, 2, 3, 4) for _ in range(3)]
    out = surface(aliased, ["a", "b"], "y")
    assert out["terms"] == [] and "not separately estimable" in out["note"]


def test_anova_falls_back_when_design_is_aliased() -> None:
    """Regression (U6): b duplicates a, so the a:b model is rank deficient even if p-values come out finite."""
    import random

    rng = random.Random(5)
    rows = [
        {"a": a, "b": a, "c": c, "seed": s, "y": a + rng.gauss(0, 0.01)}
        for a in (0, 1)
        for c in (0, 1)
        for s in range(4)
    ]
    res = anova(rows, ["a", "b", "c"], "y")
    assert all(e.p is None or e.df > 0 for e in res.effects)
    assert not any(e.reported for e in res.effects if e.term in ("b", "a:b"))


def test_unreported_effects_say_why_and_noise_floor_applies() -> None:
    """Regression (review #7): the documented seed-noise floor is applied and the statement names the reason."""
    import random

    rng = random.Random(7)
    # seed shifts dominate (raw seed SD ~0.5) while the blocked a-effect (0.02) is significant but tiny
    rows = [
        {"a": a, "b": b, "seed": s, "y": 0.02 * a + 0.5 * s + rng.gauss(0, 0.001)}
        for a in (0, 1)
        for b in (0, 1)
        for s in range(4)
    ]
    eff = {e.term: e for e in anova(rows, ["a", "b"], "y").effects}
    assert eff["a"].p_holm is not None and eff["a"].p_holm < 0.05 and not eff["a"].reported
    assert "seed-noise floor" in eff["a"].statement and "not distinguishable" not in eff["a"].statement
    big = [{"a": a, "b": b, "seed": s, "y": a + rng.gauss(0, 0.1)} for a in (0, 1) for b in (0, 1) for s in range(4)]
    e2 = {e.term: e for e in anova(big, ["a", "b"], "y", min_eta2=0.9999).effects}["a"]
    assert not e2.reported and "below the minimum effect size" in e2.statement


def test_curvature_uses_cell_means_and_pure_error() -> None:
    """Regression (review #8): a purely linear response with unequal corner replication shows no curvature."""
    import random

    rng = random.Random(11)
    reps = {(0, 0): 12, (0, 1): 2, (1, 0): 2, (1, 1): 2}
    rows = [
        {"a": a, "b": b, "seed": s, "y": a + b + rng.gauss(0, 0.02)} for (a, b), n in reps.items() for s in range(n)
    ]
    rows += [{"a": 0.5, "b": 0.5, "seed": s, "is_center": True, "y": 1 + rng.gauss(0, 0.02)} for s in range(4)]
    cur = anova(rows, ["a", "b"], "y").curvature
    assert cur is not None and cur["curvature"] is False and abs(cur["center_minus_corners"]) < 0.05
    assert "optimum" not in anova(rows, ["a", "b"], "y").curvature["statement"].split("(")[0]


def test_sampling_center_is_the_public_level_helper() -> None:
    """Regression (review #13): study code uses the public sampling.center, not the private _levels."""
    import inspect

    from researchos.services.execution import sampling, study

    assert sampling.center({"low": 1, "high": 100, "log": True}) == 10
    assert sampling.center({"low": 16, "high": 128, "int": True, "log": True}) == 45
    assert sampling.center({"choices": ["a", "b", "c"]}) == "b"
    assert "sampling._levels" not in inspect.getsource(study)


def test_anova_rejects_confounded_and_saturated_designs():
    from researchos.services.verification.analysis import anova

    for rows in (
        [{"a": a, "seed": a, "y": 10 * a + d} for a in (0, 1) for d in (-.1, 0, .1)],
        [{"a": a, "seed": 0, "y": 10 * a} for a in (0, 1)],
    ):
        result = anova(rows, ["a"], "y")
        assert len(result.effects) == 1
        effect = result.effects[0]
        assert effect.term == "a" and not effect.reported
        assert effect.p is None and "NOT ESTIMABLE" in effect.statement


def test_curvature_unavailable_for_missing_corner_linear_response():
    from researchos.services.verification.analysis import anova

    rows = [{"a": a, "b": b, "seed": seed, "y": 10 * a + d, "is_center": center}
            for a, b, center in ((0, 0, False), (0, 1, False), (1, 1, False), (.5, .5, True))
            for seed, d in enumerate((-.1, 0, .1))]
    assert anova(rows, ["a", "b"], "y").curvature is None


def _sampled_rows(space: dict, fn: Any, seeds: tuple[float, ...] = (-1e-4, 0.0, 1e-4)) -> list[dict]:
    from researchos.services.execution.sampling import factorial_with_center

    factors = sorted(space)
    return [{**p, "seed": i, "is_center": p["_center"], "y": fn(p) + d}
            for p in factorial_with_center(space, factors, {}, 2) for i, d in enumerate(seeds)]


def test_curvature_on_complete_design_with_log_and_integer_factors() -> None:
    """Regression (Claude review of review #2): centers placed by sampling.center (geometric for log ranges, rounded
    for ints) are valid design centers; a complete 2^2 design with a curved response must report curvature."""
    import math

    space = {"lr": {"low": 1e-4, "high": 1.0, "log": True}, "batch": {"low": 16, "high": 128, "int": True, "log": True}}
    rows = _sampled_rows(space, lambda p: 0.9 - 0.05 * (math.log10(p["lr"]) + 2) ** 2)
    cur = anova(rows, ["batch", "lr"], "y", scales={"lr": "log", "batch": "log"}).curvature
    assert cur is not None and cur["curvature"] is True
    off = [{**r, "lr": 2.0} if r["is_center"] else r for r in rows]  # center outside the tested range
    assert anova(off, ["batch", "lr"], "y", scales={"lr": "log", "batch": "log"}).curvature is None


def test_no_false_curvature_for_linear_responses_at_rounded_or_geometric_centers() -> None:
    """Regression (review #13): a response linear on the factor's design scale shows no curvature, whatever
    the center rounding (int 1..4 -> center 2) or geometric placement."""
    import math

    int_space = {"x": {"low": 1, "high": 4, "int": True}}
    cur = anova(_sampled_rows(int_space, lambda p: p["x"]), ["x"], "y", scales={"x": "linear"}).curvature
    assert cur is not None and cur["curvature"] is False and abs(cur["center_minus_corners"]) < 1e-3
    log_space = {"b": {"low": 16, "high": 128, "int": True, "log": True}}
    cur = anova(_sampled_rows(log_space, lambda p: math.log(p["b"])), ["b"], "y", scales={"b": "log"}).curvature
    assert cur is not None and cur["curvature"] is False
    lin_at_geo = {"z": {"low": 1.0, "high": 100.0, "log": True}}  # geometric center 10, response linear in z
    cur = anova(_sampled_rows(lin_at_geo, lambda p: p["z"]), ["z"], "y", scales={"z": "linear"}).curvature
    assert cur is not None and cur["curvature"] is False


@pytest.mark.parametrize("lo,hi,center", [(1, 4, 0), (1, 4, -1), (0, 4, 2), (-1, 4, 2), (-4, 0, -2)])
def test_curvature_not_applicable_for_nonpositive_log_coordinates(lo, hi, center) -> None:
    rows = [{"x": x, "seed": seed, "y": x + d, "is_center": is_center}
            for x, is_center in ((lo, False), (hi, False), (center, True))
            for seed, d in enumerate((-.1, 0, .1))]
    result = anova(rows, ["x"], "y", scales={"x": "log"})
    assert result.curvature is None
    assert any("curvature test not applicable" in note for note in result.notes)
