"""Rules that keep a citation check from calling a claim exact when the paper sentence is about something else:
named things must be named in the sentence, negation must agree, and table dumps are not prose."""
from __future__ import annotations

import re
import unicodedata

_TOKEN = re.compile(r"(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*")
_NEGATION = re.compile(r"\b(?:not|no|never|without|cannot|neither|nor)\b|n't\b", re.IGNORECASE)
_ANAPHOR = re.compile(r"^(?:it|its|this|these|they|their|that|those|here|there)\b", re.IGNORECASE)


def _names(text: str) -> set[str]:
    """Words that name a specific thing: an inner capital (PhC-U373, EEGNet), letters mixed with digits (U373, Fz-A2),
    an acronym (ISBI) or a capitalized word that does not start the sentence. Lower-cased."""
    out = set()
    for k, m in enumerate(_TOKEN.finditer(norm_keep_case(text))):
        w = m.group(0)
        inner_cap = any(c.isupper() for c in w[1:])
        mixed = any(c.isdigit() for c in w) and any(c.isalpha() for c in w)
        if inner_cap or mixed or (k > 0 and w[0].isupper() and len(w) > 1):
            out.add(w.lower())
    return out


def norm_keep_case(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())


def _table_like(s: str) -> bool:
    """A flattened table row / cell dump (mostly numbers, symbols, one-letter tokens), not a prose sentence: its word
    order depends on the PDF layout, so it is neither support nor a candidate."""
    toks = s.split()
    prose = sum(1 for t in toks if len(t.strip("()[],.;:")) > 2 and t.strip("()[],.;:").isalpha())
    return len(toks) >= 8 and prose / len(toks) < 0.5
