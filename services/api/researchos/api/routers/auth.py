"""Auth, devices, pairing, step-up re-auth."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ...contracts.errors import ApiError
from ...services.identity import credentials, sessions
from ...services.identity.sessions import Principal
from ..deps import SESSION_COOKIE, db, limiter_key, optional_principal, peer_is_host, principal, services

router = APIRouter(prefix="/api/v1", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    device_name: str = Field(default="browser", max_length=80)


class SetupIn(LoginIn):
    setup_token: str = Field(min_length=8, max_length=128)


class PairIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    device_name: str = Field(default="iPad", max_length=80)
    want_token: bool = False  # the phone app: keep the session as a bearer token, not a cookie (ADR-275)


class PairingCodeIn(BaseModel):
    device_name: str | None = Field(default=None, max_length=80)


class ReauthIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AuthState(BaseModel):
    initialized: bool
    authenticated: bool
    setup_allowed: bool
    device_id: str | None = None
    device_name: str | None = None
    is_host: bool = False


class PairOut(AuthState):
    token: str | None = None


class DeviceOut(BaseModel):
    id: str
    name: str
    paired_via: str
    is_host: bool
    created_at: str
    last_seen_at: str | None
    revoked_at: str | None
    current: bool = False


class PairingCodeOut(BaseModel):
    code: str
    expires_at: str
    pair_url: str | None


class OkOut(BaseModel):
    ok: bool = True


DEVICE_COOKIE = "ros_device"


def _set_cookie(resp: Response, token: str, request: Request, device_id: str | None = None) -> None:
    s = services(request).settings
    resp.set_cookie(SESSION_COOKIE, token, httponly=True, secure=s.tls_enabled, samesite="strict",
                    max_age=s.session_ttl_hours * 3600, path="/")
    if device_id:  # identifies this browser on later logins (not a credential; sessions still required)
        resp.set_cookie(DEVICE_COOKIE, device_id, httponly=True, secure=s.tls_enabled, samesite="strict",
                        max_age=400 * 24 * 3600, path="/")


def _state(did: str, name: str, is_host: bool) -> AuthState:
    return AuthState(initialized=True, authenticated=True, setup_allowed=False, device_id=did, device_name=name,
                     is_host=is_host)


@router.get("/auth/state", response_model=AuthState)
def auth_state(request: Request, conn: sqlite3.Connection = Depends(db),
               p: Principal | None = Depends(optional_principal)) -> AuthState:
    init = credentials.admin_exists(conn)
    return AuthState(initialized=init, authenticated=p is not None,
                     setup_allowed=(not init) and peer_is_host(request),
                     device_id=p.device_id if p else None, device_name=p.device_name if p else None,
                     is_host=p.is_host if p else False)


@router.post("/auth/setup", response_model=AuthState)
def setup(data: SetupIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(db)) -> AuthState:
    svc = services(request)
    if not peer_is_host(request):
        raise ApiError(403, "setup_local_only", "initial setup must be done on the host machine (127.0.0.1)")
    if not credentials.check_setup_token(svc.settings.config_dir, data.setup_token):
        raise ApiError(403, "bad_setup_token", "setup token invalid; see <data_dir>/config/setup-token.txt")
    credentials.create_admin(conn, data.username, data.password)
    token, did = sessions.login(conn, data.username, data.password, data.device_name,
                                request.headers.get("user-agent"), svc.settings.session_ttl_hours, True, "setup")
    credentials.clear_setup_token(svc.settings.config_dir)
    _set_cookie(response, token, request, did)
    return _state(did, data.device_name, True)


@router.post("/auth/login", response_model=AuthState)
def login(data: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(db)) -> AuthState:
    svc = services(request)
    key = f"login:{limiter_key(request)}"
    svc.login_limiter.check(key)
    host = peer_is_host(request)
    try:
        token, did = sessions.login(conn, data.username, data.password, data.device_name,
                                    request.headers.get("user-agent"), svc.settings.session_ttl_hours, host,
                                    device_id=request.cookies.get(DEVICE_COOKIE))
    except ApiError:
        svc.login_limiter.fail(key)
        raise
    svc.login_limiter.reset(key)
    _set_cookie(response, token, request, did)
    return _state(did, data.device_name, host)


@router.post("/auth/logout", response_model=OkOut)
def logout(response: Response, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> OkOut:
    sessions.logout(conn, p.session_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return OkOut()


@router.post("/auth/reauth", response_model=OkOut)
def reauth(data: ReauthIn, request: Request, p: Principal = Depends(principal),
           conn: sqlite3.Connection = Depends(db)) -> OkOut:
    svc = services(request)
    key = f"reauth:{p.device_id}"
    svc.login_limiter.check(key)
    try:
        sessions.reauthenticate(conn, p, data.password)
    except ApiError:
        svc.login_limiter.fail(key)
        raise
    return OkOut()


@router.post("/auth/pairing-codes", response_model=PairingCodeOut)
def new_pairing_code(data: PairingCodeIn, request: Request, p: Principal = Depends(principal),
                     conn: sqlite3.Connection = Depends(db)) -> PairingCodeOut:
    s = services(request).settings
    code, exp = sessions.create_pairing_code(conn, p, data.device_name, s.pairing_code_ttl_min)
    base = s.public_origins[0] if s.public_origins else None
    return PairingCodeOut(code=code, expires_at=exp, pair_url=f"{base}/#/pair" if base else None)


@router.post("/auth/pair", response_model=PairOut)
def pair(data: PairIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(db)) -> PairOut:
    """Redeem a pairing code. Browsers get the session cookie; the phone app asks for the token itself, because a
    cookie in the native HTTP layer's store is not reliably kept across app restarts."""
    svc = services(request)
    key = f"pair:{limiter_key(request)}"
    svc.login_limiter.check(key)
    try:
        token, did = sessions.redeem_pairing_code(conn, data.code, data.device_name,
                                                  request.headers.get("user-agent"), svc.settings.session_ttl_hours)
    except ApiError:
        svc.login_limiter.fail(key)
        raise
    if data.want_token:
        return PairOut(**_state(did, data.device_name, False).model_dump(), token=token)
    _set_cookie(response, token, request, did)
    return PairOut(**_state(did, data.device_name, False).model_dump())


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> list[DeviceOut]:
    return [DeviceOut(**{**d, "is_host": bool(d["is_host"])}, current=d["id"] == p.device_id)
            for d in sessions.list_devices(conn, p.user_id)]


@router.post("/devices/{device_id}/revoke", response_model=OkOut)
def revoke(device_id: str, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> OkOut:
    sessions.revoke_device(conn, device_id, p)
    return OkOut()
