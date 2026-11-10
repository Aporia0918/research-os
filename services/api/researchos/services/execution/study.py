"""Pre-registered 6-stage study protocol (ARCHITECTURE §6.4): screen -> shrink -> search -> confirm ->
freeze + null-world control -> [opt-in ablation, ADR-185] -> final_eval once (only after its own approval).

The protocol is fixed at creation (hash stored); following it creates no new forking paths. Narrowing creates an
immutable plan revision covered by the original approval; nothing here can widen the space or touch the test set.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from ...contracts.errors import ApiError
from ...kernel.db import jdump, new_id, row, tx, utcnow
from ...kernel.events import emit
from ..orchestration.registry import KindRegistry
from ..verification.analysis import anova, surface, winners_curse
from ..verification.detectors_run import seed_spread
from ..verification.regions import failure_rules
from . import ablation, plans, sampling, search
from . import study_data as sd

DEFAULTS = {
    "seeds_screen": 2,
    "center_points": 2,
    "search": {"sampler": "qmc", "max_trials": 30, "batch": 5, "patience_batches": 2},
    "confirm": {"top": 3, "seeds": 5},
    "direction": "max",
    "chance_tolerance": 0.15,
    "control_runs": 3,  # null worlds for the negative control; the full exam (nullworld) runs 19+
}


def create(
    conn: sqlite3.Connection, kinds: KindRegistry, *, plan_id: str, revision: int, protocol: dict[str, Any], actor: str
) -> dict[str, Any]:
    if plans.approval_covers(conn, plan_id, revision) is None:
        raise ApiError(409, "plan_not_approved", "approve the plan revision before starting a study")
    rev = plans.get_revision(conn, plan_id, revision)
    space = rev["content"].get("space") or {}
    proto = {**DEFAULTS, **protocol}
    factors = proto.get("factors") or sorted(space)
    if not space or not set(factors) <= set(space) or not 1 <= len(factors) <= 4:
        raise ApiError(422, "bad_protocol", "factors must be 1-4 parameters of the plan's search space")
    proto["factors"] = factors
    if proto["search"].get("sampler", "qmc") not in sampling.SAMPLERS:
        raise ApiError(422, "bad_protocol", f"search.sampler must be one of {list(sampling.SAMPLERS)}")
    try:
        sampling.check_rules(space, list(proto.get("constraints", [])))
        ablation.validate(proto, space)
        narrowed = sampling.tighten(space, proto.get("constraints", []))
    except ValueError as e:
        raise ApiError(422, "bad_protocol", str(e)) from None
    current = revision
    if narrowed != space:  # constraints narrow the approved space: an immutable narrowing revision (still covered)
        new = plans.revise(conn, plan_id, {**rev["content"], "space": narrowed}, actor)
        current, rev, space = new["revision"], plans.get_revision(conn, plan_id, new["revision"]), narrowed
    sid = new_id("study")
    with tx(conn):
        conn.execute(
            "INSERT INTO studies(id,plan_id,base_revision,current_revision,protocol,protocol_hash,stage,"
            "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, plan_id, revision, current, jdump(proto), sd.protocol_hash(proto), "screen", utcnow(), utcnow()),
        )
        emit(
            conn,
            "study.created",
            actor=actor,
            entity_type="study",
            entity_id=sid,
            data={"plan": plan_id, "revision": revision, "protocol_hash": sd.protocol_hash(proto)},
        )
    st = sd.get(conn, sid)
    pts = sampling.factorial_with_center(space, factors, rev["content"].get("params", {}), proto["center_points"])
    n = sd.enqueue(conn, kinds, st, "screen", "trial", pts, list(range(proto["seeds_screen"])), actor)
    sd.save(conn, sid, configs_evaluated=len(pts))
    return {**sd.get(conn, sid), "enqueued": n}


def _negligible(effects: list[Any], factor: str) -> bool:
    """Main effect partial eta^2 < 0.01, no reported term involves the factor, and every two-way interaction with
    it was estimable (an inestimable interaction is unknown, not absent)."""
    mine = [e for e in effects if factor in e.term.split(":")]
    main = next((e for e in mine if e.term == factor), None)
    two_way = [e for e in mine if e.term.count(":") == 1]
    return (
        main is not None
        and main.partial_eta2 is not None
        and main.partial_eta2 < 0.01
        and not any(e.reported for e in mine)
        and all(e.p is not None for e in two_way)
    )


def _shrink(conn: sqlite3.Connection, st: dict[str, Any], res: list[dict[str, Any]], actor: str) -> dict[str, Any]:
    proto, rev = st["protocol"], plans.get_revision(conn, st["plan_id"], st["current_revision"])
    space = dict(rev["content"]["space"])
    ok = [r for r in res if not r["failed"]]
    out: dict[str, Any] = {
        "failure_rules": failure_rules(
            [{k: float(r[k]) for k in proto["factors"]} for r in res], [r["failed"] for r in res]
        )
    }
    if len(ok) >= 4:
        scales = {f: "log" if space[f].get("log") else "linear" for f in proto["factors"]}
        a = anova([{**r, "y": r["objective"]} for r in ok], proto["factors"], "y", scales=scales)
        out["anova"] = {
            "effects": [e.__dict__ for e in a.effects],
            "curvature": a.curvature,
            "sigma": a.seed_sigma,
            "notes": a.notes,
        }
        for f in proto["factors"]:  # factors with no evidence of involvement are fixed at their center (narrowing)
            if _negligible(a.effects, f):
                c = sampling.center(space[f])
                space[f] = {"choices": [c]} if "choices" in space[f] else {**space[f], "low": c, "high": c}
    for rule in out["failure_rules"]:  # single-threshold failure regions tighten a bound; others are avoided
        conds = rule["rule"].split(" and ")
        if len(conds) == 1 and rule["rule"] != sampling.ALWAYS:
            name, op, thr = conds[0].split(" ")
            spec = dict(space[name])
            if op == ">" and spec["low"] <= float(thr) < spec["high"]:
                spec["high"] = float(thr)
            elif op == "<=" and spec["low"] < float(thr) <= spec["high"]:
                spec["low"] = float(thr)
            space[name] = spec
    out["avoid"] = [r["rule"] for r in out["failure_rules"] if " and " in r["rule"]]
    if space != rev["content"]["space"]:
        new = plans.revise(conn, st["plan_id"], {**rev["content"], "space": space}, actor)
        out["revision"] = new["revision"]
        out["change_kind"] = new["change_kind"]
        sd.save(conn, st["id"], current_revision=new["revision"])
    return out


def advance(conn: sqlite3.Connection, kinds: KindRegistry, sid: str, actor: str = "system:study") -> str:
    """Move the study forward if the current stage's runs are all finished. Returns the (new) stage."""
    st = sd.get(conn, sid)
    handler = _STAGES.get(st["stage"])
    if handler is None:
        return str(st["stage"])
    return handler(conn, kinds, st, actor)


def _screen(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    ch = sd.children(conn, st["id"], "screen")
    if not sd.all_done(ch):
        return "screen"
    res = sd.results(conn, ch, st["protocol"]["objective"])
    if sum(r["failed"] for r in res) > len(res) / 2:
        sd.save(conn, st["id"], stage="stopped", data={**st["data"], "stop_reason": ">50% of screen runs failed"})
        return "stopped"
    data = {**st["data"], "screen": _shrink(conn, st, res, actor)}
    sd.save(conn, st["id"], stage="search", data=data)
    return _next_search_batch(conn, kinds, sd.get(conn, st["id"]), actor, 0)


def _next_search_batch(
    conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str, batch_no: int
) -> str:
    results = all_results(conn, st)
    pts, info = search.propose(conn, st, batch_no, results)
    if not pts:  # nothing feasible left to try (review #61): stop searching, keep the evidence of why
        sd.save(conn, st["id"], data={**st["data"], "search_stopped": info.get("reason", "no feasible candidates")})
        return _start_confirm(conn, kinds, sd.get(conn, st["id"]), results, actor)
    sd.enqueue(conn, kinds, st, f"search{batch_no}", "trial", pts, [0], actor)
    sd.save(
        conn,
        st["id"],
        data={**st["data"], "search_batches": batch_no + 1},
        configs_evaluated=st["configs_evaluated"] + len(pts),
    )
    return "search"


def all_results(conn: sqlite3.Connection, st: dict[str, Any]) -> list[dict[str, Any]]:
    tags = ["screen"] + [f"search{i}" for i in range(st["data"].get("search_batches", 0))]
    return [r for t in tags for r in sd.results(conn, sd.children(conn, st["id"], t), st["protocol"]["objective"])]


def _best(rs: list[dict[str, Any]], direction: str) -> float | None:
    vals = [r["objective"] for r in rs if not r["failed"]]
    return (max(vals) if direction == "max" else min(vals)) if vals else None


def stalled(history: list[float | None], sigma: float, patience: int) -> bool:
    """Patience stop rule: the best value moved by no more than the pure-error SD over the last `patience` batches."""
    recent = [h for h in history[-patience - 1 :] if h is not None]
    return len(history) > patience and len(recent) > 1 and max(recent) - min(recent) <= sigma


def _search(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    nb = st["data"].get("search_batches", 0)
    if not sd.all_done(sd.children(conn, st["id"], f"search{nb - 1}")):
        return "search"
    proto, all_r = st["protocol"], all_results(conn, st)
    history = [*st["data"].get("best_history", []), _best(all_r, proto["direction"])]
    sigma = (st["data"].get("screen", {}).get("anova") or {}).get("sigma") or 0.0
    stale = stalled(history, sigma, proto["search"]["patience_batches"])
    sd.save(
        conn, st["id"], data={**st["data"], "best_history": history, "search_stopped": "patience" if stale else None}
    )
    st = sd.get(conn, st["id"])
    if not stale and nb * proto["search"]["batch"] < proto["search"]["max_trials"]:
        return _next_search_batch(conn, kinds, st, actor, nb)
    return _start_confirm(conn, kinds, st, all_r, actor)


def _start_confirm(
    conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], all_r: list[dict[str, Any]], actor: str
) -> str:
    proto = st["protocol"]
    space_keys = list(plans.get_revision(conn, st["plan_id"], st["current_revision"])["content"]["space"])
    ranked = sorted(
        (r for r in all_r if not r["failed"]), key=lambda r: r["objective"], reverse=proto["direction"] == "max"
    )
    picked: dict[str, dict[str, Any]] = {}
    for r in ranked:
        picked.setdefault(sd.config_key(r, space_keys), {k: r[k] for k in space_keys})
        if len(picked) == proto["confirm"]["top"]:
            break
    configs = list(picked.values())
    log_f = tuple(
        k
        for k, v in plans.get_revision(conn, st["plan_id"], st["base_revision"])["content"]["space"].items()
        if v.get("log")
    )
    st["data"]["surface"] = surface(all_r, proto["factors"], "objective", log_factors=log_f)
    sd.enqueue(conn, kinds, st, "confirm", "confirm", configs, list(range(100, 100 + proto["confirm"]["seeds"])), actor)
    sd.save(conn, st["id"], stage="confirm", data={**st["data"], "confirm_configs": configs})
    return "confirm"


def _confirm(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    ch = sd.children(conn, st["id"], "confirm")
    if not sd.all_done(ch):
        return "confirm"
    proto, res = st["protocol"], sd.results(conn, ch, st["protocol"]["objective"])
    stats = []
    for i, cfg in enumerate(st["data"]["confirm_configs"]):
        vals = [r["objective"] for r in res if r["point"] == i and not r["failed"]]
        mean = sum(vals) / len(vals) if vals else None
        sdv = (
            (sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5
            if mean is not None and len(vals) > 1
            else None
        )
        d11 = seed_spread(vals)
        stats.append(
            {
                "config": cfg,
                "mean": mean,
                "sd": sdv,
                "n": len(vals),
                "d11": {"rule": d11.rule, **d11.value} if d11 else None,
            }
        )
    valid = [s for s in stats if s["mean"] is not None]
    if not valid:
        sd.save(conn, st["id"], stage="stopped", data={**st["data"], "stop_reason": "no confirm run succeeded"})
        return "stopped"
    best = max(valid, key=lambda s: s["mean"]) if proto["direction"] == "max" else min(valid, key=lambda s: s["mean"])
    sigma = (st["data"].get("screen", {}).get("anova") or {}).get("sigma")
    data = {
        **st["data"],
        "confirm": stats,
        "frozen": best["config"],
        "winners_curse": winners_curse(sigma, st["configs_evaluated"]),
    }
    sd.save(conn, st["id"], stage="control", data=data)
    sd.enqueue(
        conn,
        kinds,
        sd.get(conn, st["id"]),
        "control",
        "trial",
        [best["config"]],
        [7 + i for i in range(proto["control_runs"])],
        actor,
        control="shuffled_labels",
    )
    return "control"


def _control(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    ch = sd.children(conn, st["id"], "control")
    if not sd.all_done(ch):
        return "control"
    scores = [r["objective"] for r in sd.results(conn, ch, st["protocol"]["objective"])]
    chance = st["protocol"].get("chance")
    mean = None if None in scores else sum(scores) / len(scores)
    ok = chance is not None and mean is not None and mean <= chance + st["protocol"]["chance_tolerance"]
    data = {**st["data"], "control": {"objective": mean, "runs": scores, "chance": chance, "passed": ok}}
    if not ok:
        sd.save(
            conn,
            st["id"],
            stage="stopped",
            data={
                **data,
                "stop_reason": "null-world control not near chance (possible leakage) or chance undeclared",
            },
        )
        return "stopped"
    sd.save(conn, st["id"], data=data)
    space = plans.get_revision(conn, st["plan_id"], st["current_revision"])["content"]["space"]
    if ablation.start(conn, kinds, sd.get(conn, st["id"]), space, actor):
        return ablation.TAG
    sd.save(conn, st["id"], stage="awaiting_final_approval")
    return _awaiting(conn, kinds, sd.get(conn, st["id"]), actor)


def _ablation(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    summary = ablation.finish(conn, st)
    if summary is None:
        return ablation.TAG
    sd.save(conn, st["id"], stage="awaiting_final_approval", data={**st["data"], "ablation": summary})
    return _awaiting(conn, kinds, sd.get(conn, st["id"]), actor)


def _awaiting(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    subj = f"{st['plan_id']}@{st['current_revision']}"
    a = row(
        conn.execute(
            "SELECT subject_hash FROM approvals WHERE subject_type='final_eval' AND subject_id=? AND "
            "revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (subj,),
        )
    )
    if a is None or a["subject_hash"] != plans.final_eval_subject_hash(conn, subj):
        return "awaiting_final_approval"
    sd.enqueue(conn, kinds, st, "final", "final_eval", [st["data"]["frozen"]], [0], actor)
    sd.save(conn, st["id"], stage="final")
    return "final"


def _final(conn: sqlite3.Connection, kinds: KindRegistry, st: dict[str, Any], actor: str) -> str:
    ch = sd.children(conn, st["id"], "final")
    if not sd.all_done(ch):
        return "final"
    r = sd.results(conn, ch, st["protocol"]["objective"])[0]
    sd.save(conn, st["id"], stage="completed", data={**st["data"], "final": r})
    with tx(conn):
        emit(
            conn,
            "study.completed",
            actor=actor,
            entity_type="study",
            entity_id=st["id"],
            data={"final_objective": r["objective"], "configs_evaluated": st["configs_evaluated"]},
        )
    return "completed"


_STAGES = {
    "screen": _screen,
    "search": _search,
    "confirm": _confirm,
    "control": _control,
    "ablation": _ablation,
    "awaiting_final_approval": _awaiting,
    "final": _final,
}
