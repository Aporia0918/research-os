"""Run the student's own script, unchanged, on one world's copy of the data, and read the score it prints."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from ...platform.env import child_env
from ...platform.process import kill_own_child, spawn

SKIP = shutil.ignore_patterns(".git", "__pycache__", ".venv", "venv", "node_modules", ".ipynb_checkpoints")
KILL_WAIT_S = 10.0


@dataclass(frozen=True)
class Job:
    project: Path  # folder copied for every run, so a script that writes files never touches the original
    script: Path  # relative to project
    data: Path  # relative to project; replaced by the world's table
    python: str
    metric: str
    timeout_s: float = 600.0


@dataclass(frozen=True)
class RunResult:
    score: float | None
    error: str | None = None
    seconds: float = 0.0


def parse_score(stdout: str, metric: str) -> float | None:
    """The last `<metric>: <number>` (or `=`) the script printed, e.g. `accuracy: 0.93`. None if there is none."""
    number = r"(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)"
    found = re.findall(rf"\b{re.escape(metric)}\b\W{{0,3}}[:=]\s*{number}", stdout, re.IGNORECASE)
    return float(found[-1]) if found else None


def run(job: Job, data: bytes) -> RunResult:
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="nullworld-") as tmp:
        work = Path(tmp) / "project"
        shutil.copytree(job.project, work, ignore=SKIP)
        (work / job.data).write_bytes(data)
        out, err = Path(tmp) / "stdout.txt", Path(tmp) / "stderr.txt"
        with out.open("wb") as o, err.open("wb") as e:
            env = child_env(Path(tmp) / "home")
            child = spawn([job.python, "-u", str(job.script)], cwd=work, env=env, stdout=o, stderr=e)
            try:
                code = child.popen.wait(timeout=job.timeout_s)
            except subprocess.TimeoutExpired:
                kill_own_child(child, KILL_WAIT_S)
                return RunResult(None, f"timed out after {job.timeout_s:g} s", time.monotonic() - started)
        seconds = time.monotonic() - started
        if code != 0:
            tail = err.read_text("utf-8", errors="replace").strip().splitlines()[-1:] or [""]
            return RunResult(None, f"exit code {code}: {tail[0][:200]}", seconds)
        score = parse_score(out.read_text("utf-8", errors="replace"), job.metric)
        return RunResult(score, None if score is not None else f"printed no '{job.metric}: <number>' line", seconds)
