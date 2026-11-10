"""Android app endpoints: experiment log entries and log-vs-paper method comparison (mobile-api branch)."""
from __future__ import annotations

import hashlib
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field

from ...contracts.errors import ApiError
from ...services.identity.sessions import Principal
from ...services.knowledge import library
from ...services.mobile import compare as cmp
from ...services.mobile import guidance, logs, plan
from ...services.mobile import predict as predict_svc
from ..deps import cid, db, idempotent, idempotent_long, principal, services

router = APIRouter(prefix="/api/v1/mobile", tags=["mobile"])


@router.post("/logs", status_code=201)
async def create_log(
    request: Request,
    client_id: str = Form(min_length=1, max_length=64),
    kind: str = Form(default="text"),
    text: str = Form(default="", max_length=logs.MAX_TEXT),
    captured_at: str | None = Form(default=None, max_length=40),
    duration_ms: int | None = Form(default=None, ge=0),
    file: UploadFile | None = File(default=None),
    p: Principal = Depends(principal),
    conn: sqlite3.Connection = Depends(db),
) -> dict[str, Any]:
    """Idempotent twice over: the Idempotency-Key replays a response, and (user, client_id) dedupes offline retries."""
    att = None
    if file is not None:
        data = await file.read(logs.MAX_ATTACHMENT_BYTES + 1)
        att = logs.Attachment(data, file.content_type or "application/octet-stream")
    blob = logs.store_attachment(services(request).blobs, kind, att)
    payload = {"client_id": client_id, "kind": kind, "text": text, "captured_at": captured_at,
               "duration_ms": duration_ms, "file_sha256": hashlib.sha256(att.data).hexdigest() if att else None}

    def run() -> tuple[int, Any]:
        created, out = logs.create_in_tx(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor,
                                         client_id=client_id, kind=kind, text=text, captured_at=captured_at, att=att,
                                         blob=blob, duration_ms=duration_ms)
        return 201, {**out, "created": created}

    _, body = idempotent(request, conn, "mobile.logs.create", payload, run)
    result: dict[str, Any] = body
    return result


@router.get("/logs")
def list_logs(limit: int = Query(50, ge=1, le=200), p: Principal = Depends(principal),
              conn: sqlite3.Connection = Depends(db)) -> list[dict[str, Any]]:
    return logs.list_for(conn, p.user_id, limit)


class MobileCompareIn(BaseModel):
    log_id: str = Field(min_length=1, max_length=64)
    version_id: str = Field(min_length=1, max_length=64)
    use_model: bool = False


@router.post("/compare")
def compare(data: MobileCompareIn, request: Request, p: Principal = Depends(principal),
            conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Method-step mismatches between a log entry and a paper, each citing a page via validated Evidence."""
    entry = logs.get(conn, p.user_id, data.log_id)
    doc = library.get_document(conn, data.version_id)
    if not entry["text"].strip():
        raise ApiError(422, "empty_log_text", "the log entry has no text to compare (voice/photo text extraction "
                                              "is not available yet)")

    def run() -> tuple[int, Any]:
        method, note, items = "deterministic", None, None
        if data.use_model:
            items = cmp.compare_with_model(conn, services(request).gateway, log_text=entry["text"],
                                           version_id=data.version_id, actor=p.actor, trace_id=cid(request))
            if items is None:
                method, note = "deterministic_fallback", "no model configured or the model call failed"
            else:
                method = "model"
        if items is None:
            items = cmp.compare_deterministic(conn, log_text=entry["text"], version_id=data.version_id,
                                              actor=p.actor)
        return 200, {"log_id": data.log_id, "version_id": data.version_id, "title": doc.get("title"),
                     "method": method, "note": note, "items": items,
                     "mismatches": sum(1 for i in items if i["status"] == "mismatch")}

    _, body = idempotent_long(request, conn, "mobile.compare", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


class MobilePlanIn(BaseModel):
    version_id: str = Field(min_length=1, max_length=64)
    use_model: bool = False


class MobilePlanItemIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    category: str = Field(min_length=1, max_length=20)
    text: str = Field(min_length=1, max_length=plan.MAX_TEXT)
    key_action: str | None = Field(default=None, max_length=20)


class MobilePlanEditIn(BaseModel):
    items: list[MobilePlanItemIn] = Field(max_length=plan.MAX_ITEMS)


@router.post("/plans", status_code=201)
def create_plan(data: MobilePlanIn, request: Request, p: Principal = Depends(principal),
                conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Draft a pre-experiment plan (variables / controls / materials) from the paper's method text; every item cites
    a page. Candidates come only from Methods-like sections found by heading; when none is found the plan has
    status method_section_not_found and no items. The plan stays a draft until the user confirms it."""
    library.get_document(conn, data.version_id)

    def run() -> tuple[int, Any]:
        method, items = "deterministic", None
        status, _ = plan.method_segments(plan._ordered_chunks(conn, data.version_id))
        if data.use_model and status == plan.METHOD_FOUND:
            items = plan.draft_with_model(conn, services(request).gateway, version_id=data.version_id,
                                          actor=p.actor, trace_id=cid(request))
            method = "model" if items is not None else "deterministic_fallback"
        elif data.use_model:
            method = "deterministic_fallback"
        if items is None:
            status, items = plan.draft_deterministic_with_status(conn, version_id=data.version_id, actor=p.actor)
        return 201, plan.create(conn, user_id=p.user_id, actor=p.actor, version_id=data.version_id, method=method,
                                items=items, status=status)

    _, body = idempotent_long(request, conn, "mobile.plans.create", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str, p: Principal = Depends(principal),
             conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    return plan.get(conn, p.user_id, plan_id)


@router.put("/plans/{plan_id}/items")
def edit_plan(plan_id: str, data: MobilePlanEditIn, request: Request, p: Principal = Depends(principal),
              conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Replace the items of a DRAFT plan (409 once confirmed)."""
    def run() -> tuple[int, Any]:
        return 200, plan.update_items(conn, user_id=p.user_id, actor=p.actor, plan_id=plan_id,
                                      edits=[i.model_dump() for i in data.items])

    _, body = idempotent(request, conn, "mobile.plans.edit", {"plan_id": plan_id, **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result


@router.post("/plans/{plan_id}/confirm")
def confirm_plan(plan_id: str, request: Request, p: Principal = Depends(principal),
                 conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """The user's explicit confirmation; recorded with a timestamp. Nothing in the plan counts before this."""
    def run() -> tuple[int, Any]:
        return 200, plan.confirm(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor, plan_id=plan_id)

    _, body = idempotent(request, conn, "mobile.plans.confirm", {"plan_id": plan_id}, run)
    result: dict[str, Any] = body
    return result


class MobilePlanActionIn(BaseModel):
    decision: str = Field(min_length=1, max_length=10)


@router.post("/plans/{plan_id}/items/{item_id}/approval")
def decide_plan_action(plan_id: str, item_id: str, data: MobilePlanActionIn, request: Request,
                       p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Approve or reject one key action (model call / data out / share) of a DRAFT plan; records time and device.
    Only the approval gate: nothing is run or sent here."""
    def run() -> tuple[int, Any]:
        return 200, plan.decide_action(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor,
                                       plan_id=plan_id, item_id=item_id, decision=data.decision)

    _, body = idempotent(request, conn, "mobile.plans.action", {"plan_id": plan_id, "item_id": item_id,
                                                               **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result


class MobilePlanNumberIn(BaseModel):
    decision: str = Field(min_length=1, max_length=20)


@router.post("/plans/{plan_id}/items/{item_id}/number")
def decide_plan_number(plan_id: str, item_id: str, data: MobilePlanNumberIn, request: Request,
                       p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Numbers-and-citation gate: confirm_match / reject_match one item whose numbers are not on its cited page
    (or that has no citation). 409 citation_gate_open on plan confirm while any is open."""
    def run() -> tuple[int, Any]:
        return 200, plan.decide_number(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor,
                                       plan_id=plan_id, item_id=item_id, decision=data.decision)

    _, body = idempotent(request, conn, "mobile.plans.number", {"plan_id": plan_id, "item_id": item_id,
                                                               **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result


# ---- research / writing guidance (draft -> confirmed, 409 after confirm) ------------------------------------------
class MobileQuestionsIn(BaseModel):
    version_id: str = Field(min_length=1, max_length=64)
    idea: str = Field(min_length=1, max_length=guidance.MAX_INPUT)
    use_model: bool = False


class MobileCitationCheckIn(BaseModel):
    version_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=guidance.MAX_INPUT)


class MobileMethodsCheckIn(BaseModel):
    plan_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=guidance.MAX_INPUT)


class MobileGuidanceDecisionIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    decision: str | None = Field(default=None, max_length=20)
    text: str | None = Field(default=None, max_length=guidance.MAX_TEXT)


class MobileGuidanceDecisionsIn(BaseModel):
    decisions: list[MobileGuidanceDecisionIn] = Field(max_length=60)


@router.post("/guidance/questions", status_code=201)
def create_questions(data: MobileQuestionsIn, request: Request, p: Principal = Depends(principal),
                     conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Research guidance: 3-5 counter-questions on the user's idea, each citing a method sentence and its page. Rules
    unless use_model and a model is configured. No method section -> status method_section_not_found, no items."""
    library.get_document(conn, data.version_id)

    def run() -> tuple[int, Any]:
        method, items = "deterministic", None
        status, _ = plan.method_segments(plan._ordered_chunks(conn, data.version_id))
        if data.use_model and status == plan.METHOD_FOUND:
            items = guidance.questions_with_model(conn, services(request).gateway, version_id=data.version_id,
                                                  idea=data.idea, actor=p.actor, trace_id=cid(request))
            method = "model" if items is not None else "deterministic_fallback"
        elif data.use_model:
            method = "deterministic_fallback"
        if items is None:
            status, items = guidance.questions_deterministic(conn, version_id=data.version_id, idea=data.idea,
                                                             actor=p.actor)
        return 201, guidance.create(conn, user_id=p.user_id, actor=p.actor, kind="questions",
                                    version_id=data.version_id, input_text=data.idea, method=method, status=status,
                                    items=items)

    _, body = idempotent_long(request, conn, "mobile.guidance.questions", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


@router.post("/guidance/citation-check", status_code=201)
def create_citation_check(data: MobileCitationCheckIn, request: Request, p: Principal = Depends(principal),
                          conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Writing guidance: each sentence of the text is a claim about the paper. Verdict exact_match ("找到原句", with
    an anchored citation), near_match ("找到相近原文(需你确认)": candidate page + text, needs_confirmation; the
    guidance cannot be confirmed (409 guidance_match_unconfirmed) until each is confirm_match / reject_match), or
    cannot_check ("无法核对": rule mode cannot read paraphrases; NOT a finding that the claim is unsupported).
    Rules only (word overlap); never a guess."""
    library.get_document(conn, data.version_id)

    def run() -> tuple[int, Any]:
        items = guidance.citation_check(conn, version_id=data.version_id, text=data.text, actor=p.actor)
        return 201, guidance.create(conn, user_id=p.user_id, actor=p.actor, kind="citation_check",
                                    version_id=data.version_id, input_text=data.text, method="deterministic",
                                    status="ok", items=items)

    _, body = idempotent_long(request, conn, "mobile.guidance.citation_check", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


@router.post("/guidance/methods-check", status_code=201)
def create_methods_check(data: MobileMethodsCheckIn, request: Request, p: Principal = Depends(principal),
                         conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Writing guidance: compare the user's methods paragraph with a CONFIRMED plan (409 plan_not_confirmed
    otherwise); plan items not found in the text are listed as missing, first."""
    def run() -> tuple[int, Any]:
        pl = guidance.confirmed_plan(conn, p.user_id, data.plan_id)
        items = guidance.methods_check(plan_items=pl["items"], text=data.text)
        return 201, guidance.create(conn, user_id=p.user_id, actor=p.actor, kind="methods_check",
                                    version_id=pl["version_id"], input_text=data.text, method="deterministic",
                                    status="ok", items=items, plan_id=pl["id"])

    _, body = idempotent(request, conn, "mobile.guidance.methods_check", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


class MobilePredictIn(BaseModel):
    plan_id: str = Field(min_length=1, max_length=64)
    log_ids: list[str] = Field(min_length=1, max_length=predict_svc.MAX_LOGS)


@router.post("/guidance/predict", status_code=201)
def create_predict(data: MobilePredictIn, request: Request, p: Principal = Depends(principal),
                   conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Prediction and adjustment suggestions from a CONFIRMED plan (409 plan_not_confirmed otherwise) and experiment
    log entries. Deterministic; every suggestion cites a paper page. A reference for the user, who decides
    (adopt / ignore, then confirm; 409 after confirm)."""
    def run() -> tuple[int, Any]:
        pl = guidance.confirmed_plan(conn, p.user_id, data.plan_id)
        entries = [logs.get(conn, p.user_id, i) for i in dict.fromkeys(data.log_ids)]
        items = predict_svc.predict(conn, plan=pl, log_entries=entries, actor=p.actor)
        return 201, guidance.create(conn, user_id=p.user_id, actor=p.actor, kind="predict",
                                    version_id=pl["version_id"], input_text=",".join(e["id"] for e in entries),
                                    method="deterministic", status="ok", items=items, plan_id=pl["id"])

    _, body = idempotent(request, conn, "mobile.guidance.predict", data.model_dump(), run)
    result: dict[str, Any] = body
    return result


@router.get("/guidance/{guidance_id}")
def get_guidance(guidance_id: str, p: Principal = Depends(principal),
                 conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    return guidance.get(conn, p.user_id, guidance_id)


@router.put("/guidance/{guidance_id}/decisions")
def decide_guidance(guidance_id: str, data: MobileGuidanceDecisionsIn, request: Request,
                    p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """Adopt / ignore / edit a question, or mark a check result handled / not_applicable
    (a near_match also confirm_match / reject_match), while draft (409 after)."""
    def run() -> tuple[int, Any]:
        return 200, guidance.decide(conn, user_id=p.user_id, actor=p.actor, gid=guidance_id,
                                    decisions=[d.model_dump() for d in data.decisions])

    _, body = idempotent(request, conn, "mobile.guidance.decide", {"id": guidance_id, **data.model_dump()}, run)
    result: dict[str, Any] = body
    return result


@router.post("/guidance/{guidance_id}/confirm")
def confirm_guidance(guidance_id: str, request: Request, p: Principal = Depends(principal),
                     conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    """The user's explicit confirmation, with a timestamp; after it nothing can change (409).
    409 guidance_match_unconfirmed while a citation-check near_match has no confirm_match / reject_match."""
    def run() -> tuple[int, Any]:
        return 200, guidance.confirm(conn, user_id=p.user_id, device_id=p.device_id, actor=p.actor, gid=guidance_id)

    _, body = idempotent(request, conn, "mobile.guidance.confirm", {"id": guidance_id}, run)
    result: dict[str, Any] = body
    return result
