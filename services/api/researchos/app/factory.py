"""FastAPI app factory: storage init (single migration owner), routers, middleware, PWA static serving."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from .. import __version__
from ..api import errors
from ..api.middleware import SecurityMiddleware
from ..api.routers import (
    auth,
    canary,
    core,
    deep_research,
    diagnostics,
    docs,
    effects,
    experiments,
    extensions,
    gateway_admin,
    knowledge,
    library,
    literature,
    mindledger,
    projects,
    research,
    reviews,
    tasks,
    update,
)
from ..kernel.config import Settings, load_settings
from ..kernel.db import connect
from ..kernel.migrate import migrate
from ..services import plugins as plugin_loader
from ..services.container import Services
from ..services.gateway.catalog import seed_defaults
from ..services.identity.credentials import ensure_setup_token
from ..services.ops.updater import Updater
from ..services.wiring import build_services

log = logging.getLogger("researchos")


def init_storage(svc: Services) -> None:
    """The API (or CLI) is the only migration owner."""
    s = svc.settings
    s.ensure_dirs()
    conn = connect(s.db_path)
    try:
        migrate(conn, svc.migration_sources, s.backups_dir)
        seed_defaults(conn)  # placeholder catalog: aliases enabled but unusable until prices are verified
        ensure_setup_token(conn, s.config_dir)
    finally:
        conn.close()


def _static_routes(app: FastAPI, settings: Settings) -> None:
    dist = Path(settings.web_dist)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_404(rest: str, request: Request) -> JSONResponse:
        return JSONResponse(errors.error_body("not_found", f"no API route /api/{rest}", False,
                                              str(getattr(request.state, "correlation_id", ""))), 404)

    @app.get("/ca.crt", include_in_schema=False)
    def ca_cert() -> Response:
        """Public half of the optional local CA so the iPad can install and trust it."""
        p = settings.config_dir / "tls" / "ca.crt"
        if not p.is_file():
            return JSONResponse(errors.error_body("not_found", "no local CA generated", False, ""), 404)
        return FileResponse(p, media_type="application/x-x509-ca-cert", filename="ResearchOS-CA.crt")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        if not dist.is_dir():
            return HTMLResponse("<h1>Research OS</h1><p>Web UI not built (cd apps/web &amp;&amp; npm ci &amp;&amp; "
                                "npm run build). API: /api/v1/health</p>", 503)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            headers = {}
            if candidate.name in ("sw.js", "index.html", "manifest.webmanifest"):
                headers["Cache-Control"] = "no-cache"
            elif "/assets/" in candidate.as_posix():
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return FileResponse(candidate, headers=headers)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})


def _plugin_routers(app: FastAPI) -> None:
    """Plugin routes must live under /api/v1/x/ (ARCHITECTURE §3); anything else is refused."""
    for r in plugin_loader.load(("researchos.routers",)).by_group.get("researchos.routers", []):
        paths = [getattr(rt, "path", "") for rt in getattr(r, "routes", [])]
        if paths and all(p.startswith("/api/v1/x/") for p in paths):
            app.include_router(r)
        else:
            log.error("plugin router refused: routes must start with /api/v1/x/: %s", paths)


def create_app(settings: Settings | None = None, svc: Services | None = None) -> FastAPI:
    svc = svc or build_services(settings or load_settings())
    init_storage(svc)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        log.info("Research OS %s data_dir=%s plugins=%d", __version__, svc.settings.data_dir, len(svc.plugins))
        yield

    app = FastAPI(title="Research OS API", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs" if svc.settings.dev_mode else None, redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.state.services = svc
    app.state.updater = Updater(svc.settings)  # idle until the owner clicks "Check for updates" (ADR-223)
    errors.install(app)
    app.add_middleware(SecurityMiddleware, settings=svc.settings)
    for r in (core.router, auth.router, projects.router, tasks.router, knowledge.router, research.router,
              gateway_admin.router, experiments.router, canary.router, extensions.router, literature.router,
              reviews.router, library.router, effects.router, mindledger.router,
              deep_research.router, docs.router, update.router, diagnostics.router):
        app.include_router(r)
    _plugin_routers(app)
    _static_routes(app, svc.settings)
    return app
