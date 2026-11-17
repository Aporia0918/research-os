"""K6 Model Gateway contract: provider adapters, task types, tools with risk manifests."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Protocol


class TaskType(StrEnum):
    """MODEL_ROUTING_SPEC §7 task types (a registry may add more; these are the core set)."""
    ROUTINE_TEXT = "routine_text"
    DOCUMENT_OCR = "document_ocr"
    ROUTINE_VISION = "routine_vision"
    VISUAL_CODING = "visual_coding"
    COMPLEX_MULTIMODAL = "complex_multimodal"
    LONG_DOCUMENT_REASONING = "long_document_reasoning"
    PREMIUM_AGENT = "premium_agent"


@dataclass(frozen=True)
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str


@dataclass(frozen=True)
class ChatRequest:
    model_id: str
    messages: tuple[Message, ...]
    max_output_tokens: int
    temperature: float = 0.0
    json_mode: bool = False
    timeout_s: float = 120.0


@dataclass(frozen=True)
class ChatResponse:
    text: str
    input_tokens: int
    output_tokens: int
    response_id: str | None       # provider id; used to dedupe settlement
    model_id: str
    raw_finish_reason: str | None = None


class ProviderError(Exception):
    """kind: timeout (may already be billed) | rate_limited | server | auth | bad_request | network."""

    def __init__(self, kind: str, message: str, *, maybe_billed: bool = False, retry_after_s: float | None = None
                 ) -> None:
        super().__init__(message)
        self.kind, self.maybe_billed, self.retry_after_s = kind, maybe_billed, retry_after_s


class ModelProvider(Protocol):
    """Optional attribute `location`: "local" (runs on this machine, e.g. mock or a loopback endpoint) or "cloud".
    The gateway reads it with getattr(..., "cloud"): an undeclared provider is cloud (egress gate, ADR-159)."""
    name: str  # deepseek | zhipu | qwen | anthropic | openai | mock

    def complete(self, req: ChatRequest, api_key: str) -> ChatResponse: ...


SideEffectScope = Literal["none", "workspace", "git", "network", "system"]


@dataclass(frozen=True)
class ToolSpec:
    """Self-describing tool contract (HARDENING #14). Permission, approval and retry read these fields."""
    name: str
    description: str
    params_schema: dict[str, Any]
    read_only: bool
    destructive: bool
    side_effect_scope: SideEffectScope
    timeout_s: float = 30.0
    max_output_bytes: int = 20_000
    needs: tuple[str, ...] = field(default_factory=tuple)  # capabilities, e.g. ("network:openalex.org",)
    # core 1.8 (egress gate, ADR-171): True only if the output is computed solely from the call's arguments (which
    # already passed the gate), e.g. a statistics tool. False = output of unknown provenance (it may carry stored
    # data): the rest of the agent run is restricted to local models.
    derived_from_args: bool = False


class ToolContext(Protocol):
    """Host-provided per call: identifies the run, gives capability-scoped HTTP; nothing that can widen rights."""
    run_id: str
    trace_id: str | None

    @property
    def http(self) -> Any: ...  # contracts.http.HttpContext (Any here to keep this module dependency-free)


class ToolError(Exception):
    """Raised by a tool implementation for an expected failure (e.g. invalid input). The host returns
    `ERROR [code]: message` to the model as the tool result; the run continues. (core 1.3)"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class ToolBinding:
    """Entry-point group `researchos.tools`: a ToolSpec plus its implementation. The host reads ONLY the spec for
    permission/approval/retry decisions and calls impl(args, ctx) after validating args against params_schema."""
    spec: ToolSpec
    impl: Callable[[dict[str, Any], ToolContext], str]
