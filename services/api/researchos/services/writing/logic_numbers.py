"""Numeric contradictions for the W3 logic check (round 3, failure class of blind test 1): the same quantity - a metric
(accuracy, sensitivity, AUC, Dice ...), a p-value, a sample size or a mean / median of something - reported with
different values in two sections (Abstract 91.3% vs Results 87.9%).

Each mention binds a metric to one number in its clause; a mention is skipped when the binding is ambiguous (a
"respectively" list, chained metrics, another number of the same kind in the clause, an inexact value "about 90%",
an inequality "p < 0.05"). Two mentions are the same quantity when the metric key matches and the subjects match: no
conflicting data split (training / validation / test / external), subgroup (women, children, baseline, ablation ...),
model names (CNN vs SVM) or context numbers (at 6 vs 12 hours), and either a shared content word or the metric is
reported once in each of the two sections (the headline value). Values are equal within the rounding of the less
precise one; percentages and fractions are compared on one scale. Only different sections (headings) are compared;
cost is bounded by MAX_POSTINGS earlier mentions per metric."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, NamedTuple

METRIC = (r"balanced accuracy|accuracy|sensitivity|specificity|AUROC|AUPRC|AUC|area under the (?:ROC |receiver "
          r"operating characteristic |precision-recall )?curve|F1(?:[- ]score)?|precision|recall|PPV|NPV|"
          r"positive predictive value|negative predictive value|Dice(?: score| coefficient)?|IoU|kappa|error rate|"
          r"RMSE|MAE|ICC")
QUANTITY = re.compile(rf"\b(?:(?P<metric>{METRIC})|(?P<avg>mean|median|average)\s+(?P<of>[a-z][a-z-]+)|"
                      r"(?P<p>p)\s*(?P<op>[=<>≤≥])|(?P<n>n)\s*=)(?![\w-])", re.IGNORECASE)
COUNT = re.compile(r"(?<![\w.,])(?P<num>\d[\d,]*)\s+(?:[a-z-]+\s+)?(?P<noun>patients|participants|subjects|"
                   r"volunteers|individuals|adults|children|cases)\b", re.IGNORECASE)
NUMBER = re.compile(r"(?<![\w.])(?P<num>\d+(?:\.\d+)?)(?:\s*(?P<pct>%|percent\b))?")
INEXACT = re.compile(r"(?:about|approximately|approx\.|around|nearly|almost|over|above|under|below|more than|"
                     r"less than|at least|up to|~|<|>|≤|≥)\s*$", re.IGNORECASE)
DELTA_BEFORE = re.compile(r"\b(?:by|of up to|gain of|improvement of|drop of|difference of)\s*$", re.IGNORECASE)
DELTA_AFTER = re.compile(r"^\s*(?:%\s*)?(?:percentage points?|points?|pp\b|-?fold|times|higher|lower|more|less|"
                         r"better|worse)", re.IGNORECASE)  # a change, not the level: "improved by 12 points"
CHAIN = re.compile(r"^[\s,/]*(?:and|or)?[\s,/]*$", re.IGNORECASE)
# clauses that report something else: "0.91, whereas the SVM reached 0.85"; ", and" is not a boundary, so "0.81 at 12
# hours, and 0.89 at 6 hours" keeps both numbers in one clause (ambiguous, skipped)
CLAUSE = re.compile(r";|,?\s+\b(?:while|whereas|but|compared (?:with|to)|versus|vs\.?|than)\b", re.IGNORECASE)
PAREN = re.compile(r"\([^()]*\)")
BOUNDED = {"accuracy", "balanced accuracy", "sensitivity", "specificity", "auc", "auprc", "f1", "precision", "recall",
           "ppv", "npv", "dice", "iou", "error rate"}
ALIAS = {"auroc": "auc", "positive predictive value": "ppv", "negative predictive value": "npv"}
SPLIT = {"training": "train", "train": "train", "development": "train", "derivation": "train", "validation": "val",
         "test": "test", "testing": "test", "held-out": "test", "external": "external", "internal": "internal"}
SUBGROUP = re.compile(r"\b(?:women|men|female|male|girls|boys|children|adults|elderly|older|younger|subgroups?|"
                      r"fold|session|baseline|ablat\w*|without|first|second|third|final|initial|left|right)\b",
                      re.IGNORECASE)
NAME = re.compile(r"\b[A-Za-z]*[A-Z][a-z]*[A-Z0-9][\w-]*")  # CNN, ResNet-50, XGBoost
NOT_NAME = {"CI", "SD", "SE", "IQR", "ROC", "AUC", "AUROC", "AUPRC", "PPV", "NPV", "ICC", "RMSE", "MAE", "IOU", "F1"}
GENERIC = {"achie", "reach", "obtai", "attai", "yield", "showe", "shows", "gave", "given", "had", "has", "have",
           "repor", "resul", "overa", "value", "score", "estim", "measu", "perfo", "perce", "point", "study", "paper",
           "work", "overall", "pooled", "respe", "about", "appro", "nearl", "coeff", "rate", "reached", "years", "year"}
MAX_POSTINGS = 64
WINDOW = 80  # characters after a metric name in which its value must start


@dataclass(frozen=True)
class Mention:
    key: str
    raw: str  # the number as written ("87.9%")
    value: float  # on one scale (bounded metrics as fractions)
    tol: float  # rounding of the written number on that scale
    words: frozenset[str]
    split: frozenset[str]
    subgroup: frozenset[str]
    names: frozenset[str]
    context: frozenset[str]  # other numbers of another kind in the clause ("at 6 hours")


class Num(NamedTuple):
    text: str  # digits as written
    pct: bool
    start: int  # in the clause
    counted: bool = False  # "214 participants"


def _key(m: re.Match[str]) -> str:
    if m.group("metric"):
        k = m.group("metric").lower()
        if k.startswith("area"):
            k = "auprc" if "precision" in k else "auc"
        k = "f1" if k.startswith("f1") else "dice" if k.startswith("dice") else k
        return ALIAS.get(k, k)
    if m.group("avg"):
        of = m.group("of").lower()
        inner = QUANTITY.fullmatch(of)
        return _key(inner) if inner and inner.group("metric") else f"{m.group('avg').lower()} {of}"
    return "p" if m.group("p") else "n"


def _num(m: re.Match[str], offset: int = 0) -> Num:
    return Num(m.group("num"), bool(m.group("pct")), m.start() + offset)


def _scaled(key: str, n: Num) -> tuple[float, float]:
    v = float(n.text.replace(",", ""))
    if n.counted:
        return v, 0.0
    tol = 0.5 * 10 ** -(len(n.text.split(".")[1]) if "." in n.text else 0)
    if n.pct or (key in BOUNDED and 1 < v <= 100):
        v, tol = v / 100, tol / 100
    return v, tol


def _kind(key: str, n: Num) -> str:
    """Numbers of one kind compete for a metric (two percentages, two fractions of a bounded metric)."""
    if n.counted:
        return "count"
    if n.pct:
        return "pct"
    return "fraction" if key in BOUNDED and float(n.text) <= 1 else "other"


def _bind(clause: str) -> list[tuple[str, Num, int, int]]:
    """(metric key, bound number, metric span) per unambiguous mention of the clause."""
    out, ambiguous_next = [], False
    qs = list(QUANTITY.finditer(clause))
    for i, q in enumerate(qs):
        key = _key(q)
        ambiguous, ambiguous_next = ambiguous_next, False
        end = qs[i + 1].start() if i + 1 < len(qs) else len(clause)
        window = clause[q.end():min(end, q.end() + WINDOW)]
        num = NUMBER.search(window)
        if q.group("p") or q.group("n"):  # "p = 0.03", "n = 120": the number right after the operator
            if num and window[:num.start()].strip() or q.group("p") and q.group("op") != "=":
                num = None
        elif num and re.search(r"\d", window[:num.start()]):
            num = None
        if num is None and i + 1 < len(qs) and CHAIN.match(clause[q.end():qs[i + 1].start()]):
            ambiguous_next = True  # "sensitivity and specificity of 91% and 84%"
        if num is None and q.group("metric"):  # "96.1% sensitivity"
            before = re.search(r"(?<![\w.])(?P<num>\d+(?:\.\d+)?)(?:\s*(?P<pct>%|percent\b))?\s*$", clause[:q.start()])
            if before and not ambiguous:
                out.append((key, _num(before), q.start(), q.end()))
            continue
        if num is None or ambiguous or INEXACT.search(clause[:q.end()] + window[:num.start()]):
            continue
        if DELTA_BEFORE.search(window[:num.start()]) or DELTA_AFTER.match(window[num.end("num"):]):
            continue
        out.append((key, _num(num, q.end()), q.start(), q.end()))
    return out


def mentions(text: str, topic_words: Callable[[str], list[str]]) -> list[tuple[Mention, str]]:
    """(mention, quote) of every unambiguously bound quantity of a sentence."""
    if re.search(r"\brespectively\b", text, re.IGNORECASE):
        return []
    out = []
    for clause in CLAUSE.split(text):
        bound = _bind(clause)
        counted = {b.text for k, b, _, _ in bound if k == "n"}
        bound += [("n", Num(c.group("num"), False, c.start("num"), True), c.start(), c.end())
                  for c in COUNT.finditer(clause) if c.group("num") not in counted]
        bare = PAREN.sub(lambda m: " " * len(m.group(0)), clause)
        taken = {b.start for _, b, _, _ in bound}
        for key, num, s, e in bound:
            (v, tol), kind = _scaled(key, num), _kind(key, num)
            others = [_num(n) for n in NUMBER.finditer(bare) if n.start() not in taken]
            if any(_kind(key, n) == kind for n in others):
                continue  # "0.91 for the CNN and 0.85 for the SVM": which one?
            rest = QUANTITY.sub(" ", NUMBER.sub(" ", COUNT.sub(lambda m: " " + m.group("noun"), bare)))
            names = {n for n in NAME.findall(QUANTITY.sub(" ", bare)) if n.upper() not in NOT_NAME}
            raw = num.text + ("%" if num.pct else "")
            out.append((Mention(key, raw, v, tol,
                                frozenset(w for w in topic_words(rest) if w not in GENERIC and len(w) > 1),
                                frozenset(SPLIT[w.lower()] for w in re.findall(r"[\w-]+", rest)
                                          if w.lower() in SPLIT),
                                frozenset(w.lower()[:5] for w in SUBGROUP.findall(rest)),
                                frozenset(names), frozenset(n.text for n in others)),
                        f"{clause[s:e]} {raw}"))
    return out


def _conflict(a: frozenset[str], b: frozenset[str]) -> bool:
    return bool(a and b and a != b)


def same_quantity(a: Mention, b: Mention, headline: bool) -> bool:
    if a.subgroup != b.subgroup or _conflict(a.split, b.split) or _conflict(a.context, b.context):
        return False
    if a.names and b.names and not a.names & b.names:
        return False
    return bool(a.words & b.words) or headline


def differ(a: Mention, b: Mention) -> bool:
    return abs(a.value - b.value) > max(a.tol, b.tol) + 1e-9


Para = dict[str, Any]


def contradictions(paragraphs: list[Para], topic_words: Callable[[str], list[str]]
                   ) -> list[tuple[Para, Para, Para, Para, Mention, Mention, str]]:
    """(paragraph, sentence, earlier paragraph, earlier sentence, earlier mention, mention, quote) per sentence whose
    quantity was reported with another value in an earlier section."""
    found = [(p, s, m, q) for p in paragraphs for s in p["sentences"] for m, q in mentions(s["plain"], topic_words)]
    per_section = Counter((p["heading"], m.key) for p, _, m, _ in found)
    index: dict[str, list[tuple[dict[str, Any], dict[str, Any], Mention]]] = {}
    out, flagged = [], set()
    for p, s, m, quote in found:
        for q, t, other in index.get(m.key, ()):
            if q["heading"] == p["heading"] or (p["index"], s["index"]) in flagged:
                continue
            headline = per_section[(p["heading"], m.key)] == per_section[(q["heading"], m.key)] == 1
            if same_quantity(other, m, headline) and differ(other, m):
                out.append((p, s, q, t, other, m, quote))
                flagged.add((p["index"], s["index"]))
        if len(posting := index.setdefault(m.key, [])) < MAX_POSTINGS:
            posting.append((p, s, m))
    return out
