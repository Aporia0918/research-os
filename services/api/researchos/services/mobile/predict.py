"""Prediction and adjustment suggestions (mobile-predict): a CONFIRMED plan + experiment log entries -> per-parameter
suggestions, each with an anchored paper page. Deterministic, no model; a reference for the user, who decides.
Weak mismatches (wrong value/context) are labelled separately and need per-item confirmation."""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from ...kernel.db import new_id
from .compare import compare_deterministic
from .guidance import MAX_TEXT, _param_keys

MAX_LOGS = 10
_WORD = re.compile(r"[a-z]{4,}")


def _fmt(v: list[float], unit: str) -> str:
    lo, hi = v
    return (f"{lo:g}-{hi:g}" if lo != hi else f"{lo:g}") + f" {unit}"


def _weak_mismatch(log_value: list[float], paper_value: list[float], log_text: str, quote: str) -> bool:
    """Same-unit mismatch that looks like the wrong context: midpoint ratio >= 2 (256 Hz vs 1024 Hz), range-vs-point
    shape change (0-1 s vs 0.25 s), or no shared content words between log and paper sentence. Never shown as a
    normal adjust citation; the UI labels it 弱匹配,需确认."""
    lo_m = (log_value[0] + log_value[1]) / 2.0
    pa_m = (paper_value[0] + paper_value[1]) / 2.0
    bigger, smaller = max(abs(lo_m), abs(pa_m)), min(abs(lo_m), abs(pa_m))
    ratio_weak = (bigger > 1e-12) if smaller <= 1e-12 else (bigger / smaller >= 2.0)
    shape_weak = (log_value[0] == log_value[1]) != (paper_value[0] == paper_value[1])
    log_words: set[str] = set()
    for clause in re.split(r"[,;.\n]\s*|[,;\n]", log_text):
        log_words |= set(_WORD.findall(clause.lower()))
    paper_words = set(_WORD.findall(quote.lower()))
    overlap_weak = len(log_words & paper_words) == 0 and bool(log_words or paper_words)
    return bool(ratio_weak or shape_weak or overlap_weak)


def predict(
    conn: sqlite3.Connection, *, plan: dict[str, Any], log_entries: list[dict[str, Any]], actor: str
) -> list[dict[str, Any]]:
    """Deterministic, no model. Each number+unit in a log entry is compared with the paper's method sentences
    (compare_deterministic); every suggestion carries an anchored page citation, else it is not shown. A log value
    that differs from the paper -> 'adjust' (or 'weak_match' when the hit looks like the wrong context; needs
    confirm_match / reject_match) with a prediction that results may not be directly comparable; equal ->
    'consistent'. Plan items with a number that no log mentions -> 'not_recorded' (cited by the plan item).
    Suggestions are 辅助参考 only; the user decides."""
    out: list[dict[str, Any]] = []
    seen_params: set[str] = set()
    for lg in log_entries:
        for f in compare_deterministic(conn, log_text=lg["text"], version_id=plan["version_id"], actor=actor):
            if f["citation"] is None or f["status"] not in ("match", "mismatch"):
                continue
            seen_params.add(_fmt(f["paper_value"], f["unit"]))
            seen_params.add(_fmt(f["log_value"], f["unit"]))
            page = f["citation"]["page_number"]
            log_v, paper_v = _fmt(f["log_value"], f["unit"]), _fmt(f["paper_value"], f["unit"])
            needs = False
            if f["status"] == "mismatch":
                quote = f["citation"]["quote"]
                if _weak_mismatch(f["log_value"], f["paper_value"], lg["text"], quote):
                    kind = "weak_match"
                    needs = True
                    suggestion = (
                        f"弱匹配,需确认: log {log_v} was paired with the paper's {paper_v} (p.{page}), but "
                        f"the value/context looks mismatched. Confirm or reject this pairing. 辅助参考."
                    )
                    prediction = (
                        f"If this pairing is wrong, do not treat {paper_v} as the paper's value for your "
                        f"log. Source candidate p.{page}."
                    )
                else:
                    kind = "adjust"
                    suggestion = (
                        f"Log value {log_v} differs from the paper's {paper_v} -> consider adjusting it to "
                        f"{paper_v}, or note why you deviate. Source p.{page}. 辅助参考."
                    )
                    prediction = (
                        f"With {log_v} instead of {paper_v}, your results may not be directly comparable "
                        f"with the paper's (p.{page})."
                    )
            else:
                kind = "consistent"
                suggestion = f"Log value {log_v} matches the paper (p.{page}); no change suggested."
                prediction = f"This step follows the paper (p.{page}); comparable on this parameter."
            out.append(
                {
                    "id": new_id("gp"),
                    "kind": kind,
                    "log_id": lg["id"],
                    "log_text": lg["text"][:MAX_TEXT],
                    "parameter": f["parameter"],
                    "log_value": f["log_value"],
                    "paper_value": f["paper_value"],
                    "unit": f["unit"],
                    "suggestion": suggestion,
                    "prediction": prediction,
                    "citation": f["citation"],
                    "needs_confirmation": needs,
                    "decision": None,
                    "user_text": None,
                }
            )
    for it in plan["items"]:
        params = _param_keys(it["text"])
        if params and it.get("citation") and not any(p in seen_params for p in params):
            page = it["citation"]["page_number"]
            out.append(
                {
                    "id": new_id("gp"),
                    "kind": "not_recorded",
                    "log_id": None,
                    "log_text": None,
                    "parameter": ", ".join(params),
                    "log_value": None,
                    "paper_value": None,
                    "unit": None,
                    "suggestion": f"Plan step '{it['text'][:120]}' ({', '.join(params)}) is not in these log "
                    f"entries -> consider recording it. Source p.{page}. 辅助参考.",
                    "prediction": "Without a record of this step, it cannot be compared with the paper.",
                    "citation": it["citation"],
                    "needs_confirmation": False,
                    "decision": None,
                    "user_text": None,
                }
            )
    order = {"weak_match": 0, "adjust": 1, "not_recorded": 2, "consistent": 3}
    return sorted(out, key=lambda i: order[i["kind"]])
