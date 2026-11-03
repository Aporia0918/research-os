"""Controlled child processes: new process group, kill whole tree, liveness with PID-reuse protection."""
from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any

import psutil

from . import IS_WINDOWS
from .env import assert_child_env_clean


@dataclass
class ChildProcess:
    popen: subprocess.Popen[bytes]
    pid: int
    create_time: float
    job: Any = field(default=None, repr=False)  # Windows Job Object handle


CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def hidden_window_kwargs() -> dict[str, Any]:
    """Never show a console window on Windows (owner rule)."""
    if not IS_WINDOWS:
        return {}
    si = subprocess.STARTUPINFO()  # type: ignore[attr-defined,unused-ignore]
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW  # type: ignore[attr-defined,unused-ignore]
    return {"startupinfo": si}


def detached_kwargs(*, breakaway: bool = False) -> dict[str, Any]:
    """Popen kwargs for a child in its own process group: on Windows hidden, new process group, optionally outside
    this process's job; on POSIX its own session (`start_new_session`)."""
    if not IS_WINDOWS:
        return {"start_new_session": True}
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined,unused-ignore]
             | subprocess.CREATE_NO_WINDOW)  # type: ignore[attr-defined,unused-ignore]
    return {"creationflags": flags | (CREATE_BREAKAWAY_FROM_JOB if breakaway else 0), **hidden_window_kwargs()}


def spawn(cmd: Sequence[str], *, cwd: Path, env: Mapping[str, str], stdout: IO[bytes] | int | None = None,
          stderr: IO[bytes] | int | None = None, memory_limit_mb: int | None = None) -> ChildProcess:
    assert_child_env_clean(env)  # experiment/tool children never see provider keys (HARDENING #5)
    kwargs: dict[str, Any] = {"cwd": str(cwd), "env": dict(env), "stdout": stdout, "stderr": stderr,
                              "stdin": subprocess.DEVNULL, **detached_kwargs()}
    p = subprocess.Popen(list(cmd), **kwargs)
    job = None
    if IS_WINDOWS:
        from .windows import assign_job
        job = assign_job(p.pid, memory_limit_mb)
    try:
        ct = psutil.Process(p.pid).create_time()
    except psutil.Error:
        ct = 0.0
    return ChildProcess(p, p.pid, ct, job)


def pid_alive(pid: int, create_time: float | None) -> bool:
    """True only if the same process (pid + create_time) still exists; guards against PID reuse."""
    try:
        proc = psutil.Process(pid)
        if create_time and abs(proc.create_time() - create_time) > 1.0:
            return False
        return bool(proc.status() != psutil.STATUS_ZOMBIE)
    except psutil.Error:
        return False


def _terminate_procs(pid: int, grace_s: float) -> None:
    try:
        root = psutil.Process(pid)
        procs = [root, *root.children(recursive=True)]
    except psutil.Error:
        return
    if IS_WINDOWS:
        for p in procs:
            with contextlib.suppress(psutil.Error):
                p.terminate()
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(pid), signal.SIGTERM)
    _, alive = psutil.wait_procs(procs, timeout=max(grace_s, 0.1))
    for p in alive:
        with contextlib.suppress(psutil.Error):
            p.kill()
    psutil.wait_procs(alive, timeout=3)


def _gone(procs: list[psutil.Process]) -> bool:
    for p in procs:
        try:
            if p.is_running() and p.status() != psutil.STATUS_ZOMBIE:  # is_running checks create_time identity
                return False
        except psutil.NoSuchProcess:
            pass
        except psutil.Error:
            return False  # inspection failure is not confirmed disappearance
    return True


def kill_own_child(child: ChildProcess, wait_s: float) -> bool:
    """Hard-kill a child spawned here and not yet reaped, plus every descendant it has now (including ones that left
    its process group via setsid, review #25). The unreaped child's PID and group cannot be reused; descendants
    are psutil handles, which check create_time before signalling. Returns the verified outcome: True only if the
    child is reaped, descendant enumeration succeeded and no snapshotted descendant survives or is unverified.
    Descendants already reparented away from the child
    cannot be found here (no cgroup containment on POSIX)."""
    inspected = True
    try:
        descendants = psutil.Process(child.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        descendants = []
    except psutil.Error:
        descendants = []
        inspected = False  # still attempt cleanup, but cannot verify the whole tree
    for p in descendants:
        with contextlib.suppress(psutil.Error):
            p.kill()
    if IS_WINDOWS:
        if child.job is not None:
            from .windows import terminate_job
            terminate_job(child.job)
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(child.pid, signal.SIGKILL)
    with contextlib.suppress(OSError):
        child.popen.kill()
    try:
        child.popen.wait(timeout=wait_s)
    except subprocess.TimeoutExpired:
        return False
    deadline = time.monotonic() + wait_s
    while not _gone(descendants) and time.monotonic() < deadline:
        time.sleep(0.05)
    return inspected and _gone(descendants)


def kill_tree(pid: int, create_time: float | None = None, job: Any = None, grace_s: float = 0.0) -> bool:
    """Terminate the process and all descendants. Returns True if nothing of the tree remains."""
    if not pid_alive(pid, create_time):
        return True
    if job is not None and IS_WINDOWS:
        from .windows import terminate_job
        terminate_job(job)
    else:
        _terminate_procs(pid, grace_s)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if not pid_alive(pid, create_time):
            return True
        time.sleep(0.05)
    return False
