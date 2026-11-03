"""Local fake GitHub release server for the updater tests (ADR-223/228): serves latest.json, its signature (made with
a per-session test key, TRUSTED) and the installer; `/mirror/<full url>` paths act like a mirror prefix."""

from __future__ import annotations

import hashlib
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import researchos
from researchos.services.ops.update_signing import key_id, public_b64, sign

CUR = researchos.__version__
INSTALLER = b"MZ fake NSIS installer " * 4096
KEY = Ed25519PrivateKey.generate()
TRUSTED = {key_id(KEY.public_key()): public_b64(KEY.public_key())}


def signed_feed(meta: dict[str, Any]) -> tuple[bytes, bytes]:
    raw = json.dumps(meta).encode()
    return raw, sign(raw, KEY).encode()


class FakeRelease:
    """Serves /<repo>/releases/latest/download/latest.json and the asset; `routes` can be rewritten per test.
    Paths under /mirror/<full url> are served as the mirrored URL (like https://ghfast.top/<url>). `declared[path]`
    announces a larger content-length than is sent, then the server closes: a download cut off mid-stream."""

    def __init__(self) -> None:
        self.routes: dict[str, tuple[int, bytes, float]] = {}
        self.hits: list[str] = []
        self.declared: dict[str, int] = {}
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                path = self.path
                outer.hits.append(path)
                if path.startswith("/mirror/"):
                    path = "/" + path.split("/", 5)[-1]  # /mirror/http://host:port/<path> -> /<path>
                status, body, delay = outer.routes.get(path, (404, b"not found", 0.0))
                time.sleep(delay)
                try:
                    self.send_response(status)
                    self.send_header("content-length", str(outer.declared.get(path, len(body))))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *a: Any) -> None:
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    feed_path = "/owner/research-os/releases/latest/download/latest.json"

    @property
    def feed(self) -> str:
        return self.base + self.feed_path

    def publish(self, version: str, body: bytes = INSTALLER, sha: str | None = None, host: str | None = None,
                mac_zip: bytes | None = None, **extra: str) -> None:
        """A signed release; `mac_zip` adds a darwin-arm64 entry (ADR-266) serving those bytes."""
        asset = f"ResearchOS-Setup-{version}.exe"
        path = self.asset_path(version)
        meta: dict[str, Any] = {"version": version, "asset": asset, "sha256": sha or hashlib.sha256(body).hexdigest(),
                                "url": (host or self.base) + path, "notes": f"notes for {version}", **extra}
        if mac_zip is not None:
            zpath = self.asset_path(version, f"ResearchOS-{version}-mac-arm64.zip")
            meta["platforms"] = {"darwin-arm64": {"asset": zpath.rsplit("/", 1)[1], "url": self.base + zpath,
                                                  "sha256": hashlib.sha256(mac_zip).hexdigest()}}
            self.routes[zpath] = (200, mac_zip, 0.0)
        raw, sig = signed_feed(meta)
        self.routes[self.feed_path] = (200, raw, 0.0)
        self.routes[self.feed_path + ".sig"] = (200, sig, 0.0)
        self.routes[path] = (200, body, 0.0)

    def asset_path(self, version: str, asset: str = "") -> str:
        return f"/owner/research-os/releases/download/v{version}/{asset or f'ResearchOS-Setup-{version}.exe'}"


def bump(v: str, by: int) -> str:
    major, minor, patch = (int(x) for x in v.split("."))
    return f"{major}.{minor}.{patch + by}"


def closed_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = int(s.getsockname()[1])
    s.close()
    return port
