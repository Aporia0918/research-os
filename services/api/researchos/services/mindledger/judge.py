"""Grade a repayment. The model only names key points and which ones the attempt hit; rules.verdict decides.

Without a configured model (or when the call fails) a deterministic grader does the same job: key points are
the reference answer's sentences, and a point counts as hit when enough of its content-character bigrams appear.
It is a crude fallback, not a grader of meaning: paraphrase can miss and keyword lists can pass.
"""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass

from ...contracts.gateway import TaskType
from ..gateway.attempt import GatewayError
from ..gateway.gateway import AINotConfigured, Gateway
from ..gateway.prompts import PromptTemplate
from ..gateway.router import Signals
from .rules import verdict

MAX_POINTS = 6
MAX_REFERENCE = 4000
BIGRAM_HIT = 0.4
FILLER = re.compile(r"[的了是在它上要先再就这那和与及也都]")  # Chinese function words carry no content


@dataclass(frozen=True)
class Grade:
    points: list[str]
    hits: list[int]
    passed: bool
    method: str  # model | deterministic


def _norm(s: str) -> str:
    return FILLER.sub("", re.sub(r"[\W_]+", "", s.lower()))


def _bigrams(s: str) -> set[str]:
    t = _norm(s)
    return {t[i:i + 2] for i in range(len(t) - 1)} or ({t} if t else set())


def key_points(reference: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"[。！？!?；;\n]+|(?<=[.])\s+", reference) if len(_norm(p)) >= 4]
    return parts[:MAX_POINTS] or ([reference.strip()] if reference.strip() else [])


def grade_deterministic(reference: str, attempt: str) -> Grade:
    points, said = key_points(reference), _bigrams(attempt)
    hits = [i for i, p in enumerate(points) if (b := _bigrams(p)) and len(b & said) / len(b) >= BIGRAM_HIT]
    return Grade(points, hits, verdict(len(hits), len(points)), "deterministic")


GRADE_REPAYMENT = PromptTemplate(
    name="mindledger.grade_repayment",
    version="1",
    system=("You are an examiner. List the 2 to 6 key points a correct answer to the question must contain, "
            "using the reference answer. Then list which of those points the student's attempt states, in substance, "
            "by 0-based index. Do not judge pass or fail. Reply with JSON only: "
            '{"points": ["..."], "hits": [0, 2]}'),
    user="Question:\n{question}\n\nReference answer:\n{reference}\n\nStudent attempt (written without AI):\n{attempt}",
)


def _validate(text: str) -> tuple[Signals, Grade | None]:
    try:
        j = json.loads(text)
        points = [str(p).strip() for p in j["points"]]
        hits = sorted({int(h) for h in j["hits"]})
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return Signals(validators_passed=0.0), None
    if not 1 <= len(points) <= MAX_POINTS or not all(points) or any(not 0 <= h < len(points) for h in hits):
        return Signals(validators_passed=0.0), None
    return Signals(), Grade(points, hits, verdict(len(hits), len(points)), "model")


def grade(conn: sqlite3.Connection, gw: Gateway | None, *, question: str, reference: str, attempt: str,
          trace_id: str | None = None) -> Grade:
    if gw is not None:
        try:
            g = gw.call(conn, task_type=TaskType.ROUTINE_TEXT, prompt=GRADE_REPAYMENT, validate=_validate,
                        variables={"question": question, "reference": reference[:MAX_REFERENCE],
                                   "attempt": attempt}, trace_id=trace_id)
            if g.payload is not None:
                result: Grade = g.payload
                return result
        except (AINotConfigured, GatewayError):
            pass
    return grade_deterministic(reference, attempt)
