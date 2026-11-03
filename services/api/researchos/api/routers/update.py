"""One-click update (ADR-223/228): status, explicit check, download + verify, install, mirror setting, "What's new"
dismissal. No route checks for updates by itself; every network access starts from an owner click (`direct` = the
owner's "retry without the mirror" click; never automatic)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ...contracts.errors import ApiError
from ...services.identity.sessions import Principal
from ...services.ops.update_feed import UpdateError
from ...services.ops.updater import Updater
from ..deps import principal

router = APIRouter(prefix="/api/v1/update", tags=["update"])

# everything not listed is the release server's / mirror's fault: 502
_STATUS = {"update_bad_mirror": 400, "update_not_available": 409, "update_busy": 409, "update_not_ready": 409,
           "update_unsupported": 409, "update_platform_missing": 409, "update_launch_failed": 500,
           "update_disk_full": 507, "update_write_failed": 500}
_RETRYABLE = {"update_network", "update_timeout", "update_http_error", "update_incomplete"}


class MirrorIn(BaseModel):
    mirror_prefix: str = Field(default="", max_length=300)


class FetchIn(BaseModel):
    direct: bool = False  # bypass the mirror prefix for this one request


def _updater(request: Request) -> Updater:
    u: Updater = request.app.state.updater
    return u


def _call(fn: Any) -> dict[str, Any]:
    try:
        out: dict[str, Any] = fn()
        return out
    except UpdateError as e:
        raise ApiError(_STATUS.get(e.code, 502), e.code, e.message, retryable=e.code in _RETRYABLE) from e


@router.get("")
def status(request: Request, p: Principal = Depends(principal)) -> dict[str, Any]:
    return _updater(request).status()


@router.post("/check")
def check(request: Request, data: FetchIn | None = None, p: Principal = Depends(principal)) -> dict[str, Any]:
    direct = bool(data and data.direct)
    return _call(lambda: _updater(request).check(direct=direct))


@router.post("/download", status_code=202)
def download(request: Request, data: FetchIn | None = None, p: Principal = Depends(principal)) -> dict[str, Any]:
    direct = bool(data and data.direct)
    return _call(lambda: _updater(request).start_download(direct=direct))


@router.post("/install", status_code=202)
def install(request: Request, p: Principal = Depends(principal)) -> dict[str, Any]:
    return _call(_updater(request).install)


@router.put("/settings")
def settings(data: MirrorIn, request: Request, p: Principal = Depends(principal)) -> dict[str, Any]:
    u = _updater(request)

    def save() -> dict[str, Any]:
        u.set_mirror_prefix(data.mirror_prefix)
        return u.status()
    return _call(save)


@router.post("/whats-new/dismiss")
def dismiss_whats_new(request: Request, p: Principal = Depends(principal)) -> dict[str, Any]:
    return _updater(request).dismiss_whats_new()
