"""Citation over-reach check (W7), deterministic minimal version: for each sentence of the draft that cites a source
(`{{cite:key}}` or numeric `[n]`, `[1, 3]`, `[2-4]`), the best-matching sentence of that source's imported text
(abstract / excerpts) by n-gram coverage, and the claim strength of both by a small modality lexicon (English and
Chinese):

    3 established  proves, demonstrates, establishes, confirms, 证明, 证实, 确证
    2 stated       shows, found, reveals, indicates, 表明, 显示, 发现; also a plain assertion with no marker
    1 tentative    may, might, could, suggests, possibly, associated / correlated with, 提示, 可能, 或许, 与...相关

Verdicts per (sentence, citation): `over_reach` when the draft states the claim more strongly than the best source
sentence, `no_support` when no source sentence covers at least MIN_COVERAGE of the claim's n-grams, `no_source` when
the key has no imported text, else `ok`. Coverage = shared n-grams / n-grams of the claim (cite markers and modality
words removed first): English content-word stems and their bigrams, Chinese character bigrams. Pure; no model."""

from __future__ import annotations

import re
from typing import Any

from .logic_check import STOP, sentences

CITE = re.compile(r"\{\{cite:([^{}]+)\}\}|\[(\d+(?:\s*[,;\-–]\s*\d+)*)\]")
ASSOCIATED_ZH = re.compile(r"与([^。，,]{0,15}?)相关")  # 与 X 相关: the markers go, X stays a topic
HEDGE = re.compile(r"\b(?:may|might|could|suggests?|suggested|suggesting|possibl[ey]|potentially|likely|appears? to|"
                   r"associated with|correlated? with|correlates with|linked to)\b|提示|可能|或许|也许|"
                   + ASSOCIATED_ZH.pattern, re.IGNORECASE)
STRONG = re.compile(r"\b(?:prov(?:e|es|ed|en)|demonstrat\w*|establish\w*|confirm\w*|conclusively|definitively|"
                    r"unequivocally)\b|证明|证实|确证|确认", re.IGNORECASE)
STATED = re.compile(r"\b(?:shows?|showed|shown|found|finds|reveal\w*|indicat\w*|reports?|reported|observed)\b|"
                    r"表明|显示|发现|观察到", re.IGNORECASE)
LEVELS = {1: "tentative", 2: "stated", 3: "established"}
WORD = re.compile(r"[a-z0-9][a-z0-9-]*|[㐀-鿿]+")
HAN = re.compile(r"[㐀-鿿]+")
MIN_COVERAGE = 0.3


def strength(text: str) -> int:
    """1 tentative (a hedge wins: "demonstrates that X may ..."), 3 established, else 2 stated / plain assertion."""
    return 1 if HEDGE.search(text) else 3 if STRONG.search(text) else 2


def grams(text: str) -> set[str]:
    """English content-word stems (5 letters) and their bigrams; Chinese character bigrams."""
    text = ASSOCIATED_ZH.sub(r" \1 ", CITE.sub(" ", text))
    text = STATED.sub(" ", STRONG.sub(" ", HEDGE.sub(" ", text))).lower()
    out: set[str] = set()
    words: list[str] = []
    for w in WORD.findall(text):
        if HAN.fullmatch(w):
            out |= {w[i:i + 2] for i in range(len(w) - 1)} or {w}
        elif w not in STOP and (len(w) > 1 or w.isdigit()):  # no "s" of "Parkinson's"
            words.append(w[:5])
    out |= set(words) | {f"{a} {b}" for a, b in zip(words, words[1:], strict=False)}
    return out


def coverage(claim: set[str], source: set[str]) -> float:
    return len(claim & source) / len(claim) if claim else 0.0


def keys(text: str) -> list[str]:
    """Cited keys in order; numeric ranges expanded ("[2-4]" -> 2, 3, 4)."""
    out: list[str] = []
    for m in CITE.finditer(text):
        if m.group(1):
            out.append(m.group(1).strip())
            continue
        for part in re.split(r"[,;]", m.group(2)):
            lo, _, hi = part.replace("–", "-").partition("-")
            out += [str(n) for n in range(int(lo), int(hi) + 1)] if hi.strip() else [lo.strip()]
    return list(dict.fromkeys(out))


def check(draft: str, sources: dict[str, str]) -> list[dict[str, Any]]:
    """One finding per (citing sentence, cited key), in draft order."""
    index = {k: [(s, grams(s)) for s in sentences(v)] for k, v in sources.items()}
    out = []
    lines = [ln for ln in draft.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    for sentence in (s for ln in lines for s in sentences(ln) if CITE.search(s)):
        claim, level = grams(sentence), strength(sentence)
        for key in keys(sentence):
            found: dict[str, Any] = {"sentence": sentence, "key": key, "claim_strength": LEVELS[level]}
            if not index.get(key):
                out.append({**found, "verdict": "no_source"})
                continue
            # ties go to the strongest source sentence: no over-reach flag on a coin toss
            score, src, best = max((coverage(claim, g), strength(s), s) for s, g in index[key])
            verdict = "no_support" if score < MIN_COVERAGE else "over_reach" if level > src else "ok"
            out.append({**found, "verdict": verdict, "coverage": round(score, 3), "source_sentence": best,
                        "source_strength": LEVELS[src]})
    return out
