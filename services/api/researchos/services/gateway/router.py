"""Policy router (MODEL_ROUTING_SPEC §4 + ADR-024). No trained router; rules over task type, validation failures,
evidence complexity, remaining budget and a COMPOSITE confidence (self-report alone never escalates)."""
from __future__ import annotations

from dataclasses import dataclass, field

from ...contracts.gateway import TaskType

# Ordered candidate aliases per task type. Index 0 = cheapest suitable. Fallbacks within the same tier first.
ROUTES: dict[TaskType, tuple[str, ...]] = {
    TaskType.ROUTINE_TEXT: ("ROUTINE_TEXT", "ROUTINE_TEXT_GLM", "ROUTINE_TEXT_QWEN", "LONG_DOCUMENT_REASONING"),
    TaskType.DOCUMENT_OCR: ("DOCUMENT_OCR", "COMPLEX_MULTIMODAL"),
    TaskType.ROUTINE_VISION: ("ROUTINE_VISION", "COMPLEX_MULTIMODAL"),
    TaskType.VISUAL_CODING: ("VISUAL_CODING", "COMPLEX_MULTIMODAL"),
    TaskType.COMPLEX_MULTIMODAL: ("COMPLEX_MULTIMODAL",),
    TaskType.LONG_DOCUMENT_REASONING: ("LONG_DOCUMENT_REASONING", "PREMIUM_AGENT"),
    TaskType.PREMIUM_AGENT: ("PREMIUM_AGENT", "TOP_OPENAI"),
}
# Same-tier substitutes when the routine provider is down (spec: DeepSeek <-> GLM cross-fallback first, then Qwen).
_ROUTINE = ("ROUTINE_TEXT", "ROUTINE_TEXT_GLM", "ROUTINE_TEXT_QWEN")
SIBLINGS: dict[str, tuple[str, ...]] = {a: tuple(b for b in _ROUTINE if b != a) for a in _ROUTINE}
EMERGENCY = "EMERGENCY_CHEAP_FALLBACK"


@dataclass(frozen=True)
class Signals:
    validators_passed: float = 1.0     # fraction of deterministic validators passed (schema, ids exist, quotes)
    evidence_coverage: float = 1.0     # fraction of factual sentences with verified evidence
    self_reported: float | None = None  # model's own confidence, capped weight
    consistency: float | None = None    # optional self-consistency agreement


def composite_confidence(s: Signals) -> float:
    parts = [(s.validators_passed, 0.5), (s.evidence_coverage, 0.3)]
    if s.consistency is not None:
        parts.append((s.consistency, 0.15))
    if s.self_reported is not None:
        parts.append((min(max(s.self_reported, 0.0), 1.0), 0.1))  # capped weight
    total = sum(w for _, w in parts)
    return round(sum(v * w for v, w in parts) / total, 4)


@dataclass(frozen=True)
class Policy:
    premium_enabled: bool = True
    top_enabled: bool = False
    low: float = 0.60
    high: float = 0.85
    allowed_models: tuple[str, ...] | None = None  # owner allow-list of model ids; None = no list (review #76)


@dataclass
class Decision:
    action: str                 # "accept" | "retry_same" | "escalate" | "fail"
    reason: str
    confidence: float
    components: dict[str, float | None] = field(default_factory=dict)


def tier_allowed(tier: str, policy: Policy, force_top: bool) -> bool:
    if tier == "top":
        return policy.top_enabled and force_top
    if tier == "premium":
        return policy.premium_enabled or force_top
    return True


def candidates(task_type: TaskType, force_top: bool) -> list[str]:
    route = list(ROUTES[task_type])
    if force_top:  # manual "use highest model": strongest allowed first, never routine-only
        route = list(reversed(route))
    return route


def decide(s: Signals, *, attempt_on_model: int, validation_failures: int, budget_ok: bool, at_max_level: bool,
           policy: Policy) -> Decision:
    c = composite_confidence(s)
    comp = {"validators": s.validators_passed, "coverage": s.evidence_coverage, "self_reported": s.self_reported,
            "consistency": s.consistency}
    if s.validators_passed < 1.0:
        if validation_failures >= 2:
            return _escalate("validation failed twice", c, comp, budget_ok, at_max_level)
        if attempt_on_model == 1:  # a single format/schema failure gets one retry on the same model first
            return Decision("retry_same", "validation failed once: one retry on the same model", c, comp)
    if c >= policy.high and s.validators_passed == 1.0:
        return Decision("accept", "composite >= high and validators passed", c, comp)
    if c >= policy.low and attempt_on_model == 1:
        return Decision("retry_same", "composite in [low, high): one retry on the same model", c, comp)
    if c >= policy.low and s.validators_passed == 1.0:
        return Decision("accept", "validators passed after retry; below high threshold (labelled)", c, comp)
    return _escalate("composite below threshold", c, comp, budget_ok, at_max_level)


def _escalate(reason: str, c: float, comp: dict[str, float | None], budget_ok: bool, at_max: bool) -> Decision:
    if at_max:
        return Decision("fail", f"{reason}; no higher model allowed for this task type", c, comp)
    if not budget_ok:
        return Decision("fail", f"{reason}; budget vetoes escalation", c, comp)
    return Decision("escalate", reason, c, comp)
