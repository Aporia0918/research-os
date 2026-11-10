"""Rule check of a training script before any run (ADR-271). Read-only: the script is parsed, never imported or
run; a local path must lie inside the owner's read roots (ADR-155) and is read through the roots reader."""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator

from ...services.effects import roots
from ...services.effects.local_read import RootsReader
from ...services.identity.sessions import Principal
from ...services.verification import script_audit, script_source
from ..deps import db, principal, services

router = APIRouter(prefix="/api/v1/leak-audit", tags=["experiments"])


class ScriptIn(BaseModel):
    source: str | None = Field(
        default=None, max_length=script_source.MAX_BYTES, description="script text (or notebook JSON)"
    )
    path: str | None = Field(default=None, max_length=1000, description="a .py / .ipynb inside a read root")
    filename: str = Field(default="script.py", max_length=200)
    notebook: bool = False
    subject_columns: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _one_input(self) -> ScriptIn:
        if (self.source is None) == (self.path is None):
            raise ValueError("give exactly one of source or path")
        return self


@router.post("/script")
def audit_script(
    data: ScriptIn, request: Request, p: Principal = Depends(principal), conn: sqlite3.Connection = Depends(db)
) -> dict[str, Any]:
    """Red / yellow / green per rule (R1-R5) with line numbers and a one-sentence fix. Read-only."""
    if data.path is not None:
        path = roots.resolve(conn, data.path, "read", must_exist=True)
        raw = RootsReader(services(request).settings.db_path).read_bytes(str(path), max_bytes=script_source.MAX_BYTES)
        text, name, nb = raw.decode("utf-8", errors="replace"), path.name, path.suffix.lower() == ".ipynb"
    else:
        text, name, nb = data.source or "", data.filename, data.notebook or data.filename.endswith(".ipynb")
    audit = script_audit.audit_notebook if nb else script_audit.audit_source
    return audit(text, filename=name, subject_columns=data.subject_columns)
