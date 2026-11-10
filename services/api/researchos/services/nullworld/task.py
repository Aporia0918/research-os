"""Null-world exams and planted-world power as approval-gated tasks. Both run the owner's own script many times, so
the task waits until the owner approves its exact payload (script, data, columns, runs). The handler checks again
that every path lies inside a read root, because tasks can also be created through the generic tasks API."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass, field
from typing import Any

from ...contracts.errors import ApiError
from ...contracts.tasks import ResourceClass, TaskContext, TaskHandler, TaskKindSpec, TaskOutcome, TaskState
from ...kernel.config import Settings
from ...kernel.db import connect
from ..effects import roots
from .exam import ExamSpec, Run, executor, run_exam
from .power import PowerSpec, run_power
from .runner import RunResult
from .table import TableError

_PATH = {"type": "string", "minLength": 1, "maxLength": 1000}
_NAME = {"type": "string", "minLength": 1, "maxLength": 200}
EXAM_PROPS: dict[str, Any] = {
    "script": _PATH,
    "data": _PATH,
    "project": _PATH,
    "python": _PATH,
    "group": _NAME,
    "label": _NAME,
    "metric": {"enum": ["accuracy", "balanced_accuracy", "auc", "roc_auc"]},
    "runs": {"type": "integer", "minimum": 19, "maximum": 200},
    "contrast": {"type": "boolean"},
    "seed": {"type": "integer", "minimum": 0, "maximum": 2**31 - 1},
    "timeout_s": {"type": "number", "exclusiveMinimum": 0, "maximum": 3600},
}
_EFFECT = {"type": "number", "minimum": 0, "maximum": 5}
_FRACTION = {"type": "number", "exclusiveMinimum": 0, "maximum": 1}
EXAM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["script", "data", "group", "label"],
    "properties": EXAM_PROPS,
    "additionalProperties": False,
}
POWER_SCHEMA: dict[str, Any] = {
    **EXAM_SCHEMA,
    "properties": {
        **EXAM_PROPS,
        "runs": {"type": "integer", "minimum": 5, "maximum": 200},
        "effects": {"type": "array", "items": _EFFECT, "minItems": 1, "maxItems": 8},
        "fractions": {"type": "array", "items": _FRACTION, "minItems": 1, "maxItems": 5},
    },
}


def exam_spec(conn: sqlite3.Connection, p: dict[str, Any]) -> ExamSpec:
    """The payload as an ExamSpec, with every path resolved inside a read root (ApiError otherwise)."""
    paths = {
        k: roots.resolve(conn, p[k], "read", must_exist=True) for k in ("script", "data", "project", "python") if k in p
    }
    extra: dict[str, Any] = {k: p[k] for k in ("metric", "runs", "contrast", "seed", "timeout_s") if k in p}
    if "python" in paths:
        extra["python"] = str(paths["python"])
    return ExamSpec(paths["script"], paths["data"], p["group"], p["label"], project=paths.get("project"), **extra)


@dataclass
class _Watched:
    """Wraps the script runner: reports progress and stops starting runs once a cancel is requested. Runs come from
    several threads, so calls into the task context are serialised."""

    ctx: TaskContext
    run: Run
    done: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def __call__(self, raw: bytes) -> RunResult:
        with self.lock:
            if self.ctx.cancel_requested():
                return RunResult(None, "cancelled")
        result = self.run(raw)
        with self.lock:
            self.done += 1
            self.ctx.progress("running", {"runs_done": self.done})
        return result


def _handler(settings: Settings, power: bool) -> TaskHandler:
    def run(ctx: TaskContext) -> TaskOutcome:
        conn = connect(settings.db_path)
        try:
            exam = exam_spec(conn, ctx.payload)
        except ApiError as e:
            return TaskOutcome(TaskState.FAILED, error_code=e.code, error_message=e.message)
        finally:
            conn.close()
        try:
            watched = _Watched(ctx, executor(exam, None))
            if power:
                p = ctx.payload
                opts: dict[str, Any] = {k: tuple(p[k]) for k in ("effects", "fractions") if k in p}
                spec = PowerSpec(exam, runs=p.get("runs", 20), **opts)
                result = run_power(spec, watched).to_dict()
            else:
                result = run_exam(exam, watched).to_dict()
        except (TableError, OSError) as e:
            return TaskOutcome(TaskState.FAILED, error_code="bad_input", error_message=str(e))
        if not ctx.check_lease():
            return TaskOutcome(TaskState.FAILED, error_code="lease_lost")
        if ctx.cancel_requested():
            return TaskOutcome(TaskState.CANCELLED, {"runs_done": watched.done})
        return TaskOutcome(TaskState.SUCCEEDED, result)

    return run


def nullworld_kinds(settings: Settings) -> list[TaskKindSpec]:
    return [
        TaskKindSpec(
            "nullworld.exam",
            "run a script on its data and on structure-preserving null worlds",
            ResourceClass.CPU,
            approval_subject="task",
            payload_schema=EXAM_SCHEMA,
            handler=_handler(settings, power=False),
        ),
        TaskKindSpec(
            "nullworld.power",
            "how often the script finds a planted effect, per effect and subject count",
            ResourceClass.CPU,
            approval_subject="task",
            payload_schema=POWER_SCHEMA,
            handler=_handler(settings, power=True),
        ),
    ]
