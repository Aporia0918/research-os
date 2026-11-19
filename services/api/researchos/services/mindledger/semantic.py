"""Optional local Chinese semantic matcher for 讲给我听: a cross-encoder reranker run on the computer.

It only answers "might this attempt say this point in other words?" and can only make a missed point 待复核
(explain.judge_points); it never passes one, because reranker scores barely see negation or a swapped 正比/反比.

Off unless RESEARCHOS_SEMANTIC names a model fastembed supports (BAAI/bge-reranker-base for Chinese) and fastembed
is installed (pip install fastembed). The model is downloaded from Hugging Face on first use; in mainland China set
HF_ENDPOINT=https://hf-mirror.com. Any failure leaves the matcher off and the free grader alone.
"""
from __future__ import annotations

import math
import os
from collections.abc import Sequence
from functools import cache
from typing import Any

from .explain import Matcher

ENV = "RESEARCHOS_SEMANTIC"
_why = ""


def why_not() -> str:
    return _why or "on"


@cache
def matcher() -> Matcher | None:
    global _why
    name = os.environ.get(ENV, "").strip()
    if not name:
        _why = f"{ENV} is not set"
        return None
    try:
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        model: Any = TextCrossEncoder(model_name=name)
    except Exception as err:  # noqa: BLE001 - missing package, unknown model or no download: stay off
        _why = f"{type(err).__name__}: {err}"
        return None

    def match(points: Sequence[str], attempt: str) -> list[float]:
        return [1 / (1 + math.exp(-s)) for s in model.rerank(attempt, list(points))]

    return match
