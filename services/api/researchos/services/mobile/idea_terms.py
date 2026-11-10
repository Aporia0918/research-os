"""Idea-side terms for content-aware counter-questions (W6 ④): the idea's own words and numbers."""
from __future__ import annotations

import re

from .compare import extract_params


def idea_words(idea: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", idea.lower()) if w not in _STOP}


_STOP = {"will", "with", "from", "that", "this", "then", "into", "using", "use", "our", "they", "want", "plan", "idea",
         "data", "paper", "like", "same", "also", "have", "what", "when", "which", "would", "could", "should"}


def specific(idea: str, sentence: str, page: int) -> str:
    """The idea's own numbers set against the paper's numbers of the same unit on that page, when both exist."""
    paper = extract_params(sentence)
    pairs = [(a.raw, b.raw) for a in extract_params(idea) for b in paper if a.unit == b.unit]
    if pairs:
        mine, theirs = pairs[0]
        return f"你的想法写的是 {mine},论文第 {page + 1} 页写的是 {theirs}。"
    if paper:
        return f"论文第 {page + 1} 页写的是 {paper[0].raw},你的想法里没有写这个数值。"
    return ""
