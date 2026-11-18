"""Projects and their notes (K8 docs of kind 'note')."""
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ...kernel.db import tx
from ...services import projects as svc_projects
from ...services.content import docs as svc_docs
from ...services.identity import pushes
from ...services.identity.sessions import Principal
from ...services.mindledger import uses
from ..deps import cid, db, idempotent, principal, services

router = APIRouter(prefix="/api/v1", tags=["projects"])


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="", max_length=4000)


class ProjectPatch(BaseModel):
    revision: int
    title: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, pattern="^(active|paused|archived)$")
    next_step: str | None = Field(default=None, max_length=2000)


class Project(BaseModel):
    id: str
    title: str
    goal: str
    status: str
    next_step: str
    revision: int
    created_at: str
    updated_at: str


class NoteIn(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=200_000)
    client_operation_id: str | None = Field(default=None, max_length=80)


class NoteUpdate(BaseModel):
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=200_000)
    base_version: int
    client_operation_id: str | None = Field(default=None, max_length=80)


class Note(BaseModel):
    id: str
    project_id: str
    kind: str
    title: str
    body: str
    version: int
    conflict_of: str | None
    created_at: str
    updated_at: str


@router.post("/projects", response_model=Project, status_code=201)
def create_project(data: ProjectIn, request: Request, response: Response, p: Principal = Depends(principal),
                   conn: sqlite3.Connection = Depends(db)) -> Any:
    status, body = idempotent(request, conn, "projects.create", data.model_dump(),
                              lambda: (201, svc_projects.create_in_tx(conn, data.title, data.goal, p.actor,
                                                                      cid(request))))
    response.status_code = status
    return body


@router.get("/projects", response_model=list[Project])
def list_projects(p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> Any:
    return svc_projects.list_all(conn)


@router.get("/projects/{project_id}", response_model=Project)
def read_project(project_id: str, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> Any:
    return svc_projects.get(conn, project_id)


@router.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: str, data: ProjectPatch, request: Request, p: Principal = Depends(principal),
                   conn: sqlite3.Connection = Depends(db)) -> Any:
    changes = {k: v for k, v in data.model_dump(exclude={"revision"}).items() if v is not None}
    return svc_projects.update(conn, project_id, data.revision, changes, p.actor, cid(request))


@router.get("/projects/{project_id}/notes", response_model=list[Note])
def list_notes(project_id: str, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> Any:
    svc_projects.get(conn, project_id)
    return svc_docs.list_for_project(conn, project_id, "note")


@router.post("/projects/{project_id}/notes", response_model=Note, status_code=201)
def create_note(project_id: str, data: NoteIn, request: Request, response: Response,
                p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)) -> Any:
    svc_projects.get(conn, project_id)
    kinds = services(request).doc_kinds
    status, body = idempotent(
        request, conn, f"notes.create:{project_id}", data.model_dump(),
        lambda: (201, svc_docs.create_in_tx(conn, kinds, project_id, "note", data.title, data.body, p.actor,
                                            data.client_operation_id, cid(request))))
    response.status_code = status
    _found_uses(conn, p, body)
    return body


@router.put("/notes/{note_id}", response_model=Note)
def update_note(note_id: str, data: NoteUpdate, request: Request, p: Principal = Depends(principal),
                conn: sqlite3.Connection = Depends(db)) -> Any:
    note = svc_docs.update(conn, note_id, title=data.title, body=data.body, base_version=data.base_version,
                           actor=p.actor, client_operation_id=data.client_operation_id, cid=cid(request))
    _found_uses(conn, p, dict(note))
    return note


def _found_uses(conn: sqlite3.Connection, p: Principal, note: dict[str, Any]) -> None:
    """用在哪里: debts whose AI answer this note now uses get the note's title, and the phone hears about it."""
    with tx(conn):
        for eid in uses.link_doc(conn, p.user_id, p.actor, note):
            pushes.fan_out(conn, p.user_id, p.device_id, "used", eid, note["title"])
