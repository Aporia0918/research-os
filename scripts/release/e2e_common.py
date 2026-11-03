"""Shared parts of the local update e2e check (ADR-225/228/267): step records, the fake release HTTP server, the
ephemeral signing key and the check -> download clicks. Used by e2e_check.py (Windows feed scenarios) and e2e_mac.py
(Mac install scenarios)."""

from __future__ import annotations

import hashlib
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from researchos.services.ops.update_signing import key_id, public_b64
from researchos.services.ops.updater import Updater

SIMULATED_INSTALLED = "0.0.0"
FAKE_INSTALLER = b"MZ fake ResearchOS setup for the release e2e check\n" * 2048
TAMPERED_SHA256 = hashlib.sha256(b"tampered").hexdigest()
DOWNLOAD_TIMEOUT_S = 600.0


@dataclass(frozen=True)
class Step:
    name: str
    status: str  # PASS | FAIL | NOT RUN
    detail: str = ""


def step(name: str, ok: bool, detail: str) -> Step:
    return Step(name, "PASS" if ok else "FAIL", detail)


@dataclass(frozen=True)
class Faults:
    """Server-side faults for the installer (.exe) responses."""
    cut_after: int | None = None  # send this many bytes of the announced full length, then close
    delay_s: float = 0.0          # wait before answering (a slow server)


class _QuietHandler(SimpleHTTPRequestHandler):
    faults = Faults()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 (stdlib signature)
        pass

    def send_head(self) -> Any:
        if self.path.endswith(".exe"):
            time.sleep(self.faults.delay_s)
        return super().send_head()

    def copyfile(self, source: Any, outputfile: Any) -> None:
        if self.path.endswith(".exe") and self.faults.cut_after is not None:
            outputfile.write(source.read(self.faults.cut_after))  # content-length still announces the full file
            self.close_connection = True
            return
        super().copyfile(source, outputfile)


@contextmanager
def serve(root: Path, faults: Faults = Faults()) -> Iterator[str]:  # noqa: B008 (frozen, immutable default)
    """Serve `root` on 127.0.0.1:<random port>; yields the base URL."""
    handler = type("Handler", (_QuietHandler,), {"faults": faults})
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(handler, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True, name="release-e2e-http").start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


@dataclass(frozen=True)
class Signer:
    key: Ed25519PrivateKey
    trusted: dict[str, str]

    @classmethod
    def ephemeral(cls) -> Signer:
        key = Ed25519PrivateKey.generate()
        return cls(key, {key_id(key.public_key()): public_b64(key.public_key())})


def check_and_download(up: Updater) -> list[Step]:
    st = up.check()
    steps = [step("check -> available", st["state"] == "available", f"state={st['state']}")]
    up.start_download()
    up.wait(DOWNLOAD_TIMEOUT_S)
    return steps
