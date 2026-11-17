"""Split and leakage problems for the W5 reporting checklist, for any data type (round 3, failure class of blind test
1, F6): a sentence describing a design that leaks is reported as a problem of the `subject_wise_split` or `leakage`
item, not only a missing statement.
- `random_split_of_segments`: units of which one person contributes many (windows, epochs, patches, slices, visits,
  sentences ...; generic units such as images or records only when pooled / taken from all) randomly split or shuffled
  into training / test / folds, without a grouping in the same sentence;
- `independence_claim_with_random_split`: a patient- / subject- / site-independent claim (or "generalises to unseen
  patients") while the draft describes a random split and no grouped one;
- `fit_before_split`: normalisation, scaling, feature selection, PCA, oversampling, imputation or a vocabulary fitted
  on all data / the whole cohort / before the split (not on the training fold);
- `test_set_tuning`: hyperparameters, thresholds or early stopping tuned on the test set.
A grouped split stated anywhere in the draft ("split by patient", GroupKFold, leave-one-site-out) clears the split
problems. A negated sentence ("was not fitted on the whole dataset") is not a problem."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

GROUP = (r"(?:subject|participant|session|patient|speaker|site|hospital|centre|center|user|individual|donor|animal|"
         r"volunteer|case)")
GROUPS = GROUP[:-1] + r")s?"
# the grouping unit is the subject of the split, not the owner of the split units ("frames from all speakers were
# randomly partitioned" splits frames)
NOT_OWNER = r"(?<!from )(?<!from all )(?<!of )(?<!of all )(?<!across )(?<!across all )(?<!every )(?<!each )"
GROUPED = (rf"leave-one-{GROUP}-out|\bLO[SP]O\b|"
           rf"{GROUP}-(?:wise|level) (?:split|partition\w*|cross-validation|folds?)\b|"
           rf"(?:cross|inter)-{GROUP}s? (?:cross-validation|split|folds?)\b|{GROUP}-independent "
           rf"(?:cross-validation|split|folds?)\b|split (?:by|across|on) {GROUPS}\b|"
           rf"(?:split|partitioned|divided|stratified) at the {GROUP} level|"
           rf"{NOT_OWNER}{GROUPS} (?:were|was) (?:randomly )?(?:split|divided|assigned|partitioned) (?:into|between)|"
           rf"{GROUPS} \d+\s*(?:[-–]|to)\s*\d+ (?:were|was) used for (?:train|test)\w*|held-out {GROUPS}\b|"
           rf"no {GROUP} (?:appears|appeared|contributed|contributes) (?:in|to) both|GroupKFold|"
           rf"group(?:ed)? (?:k-fold|cross-validation|split)|grouped by {GROUP}|"
           rf"(?:all|every) \w+ of (?:a|one|each|the same) {GROUP} (?:stayed|remained|were kept|was kept|stay)")
SEGMENTS = re.compile(r"\b(?:windows?|segments?|epochs?|beats?|heartbeats?|patches|tiles|crops|slices|frames|clips|"
                      r"snippets|trials|visits|admissions|encounters|sentences|utterances|sequences)\b", re.IGNORECASE)
GENERIC = re.compile(r"\b(?:images|records|recordings|samples|scans|notes|documents|rows|examples|instances|"
                     r"observations|data points)\b", re.IGNORECASE)
POOLED = re.compile(r"\bpool\w*|\b(?:from|of|across) (?:all|every|each)\b", re.IGNORECASE)
RANDOM_SPLIT = re.compile(r"\brandom(?:ly)?\s+(?:\w+\s+)?(?:split|divided|assigned|partitioned|allocated|"
                          r"distributed|sampled)\b|\bshuffled\b[^.;]*?\b(?:split|divided|partitioned)\b|"
                          r"\brandom (?:\w+[- ])?(?:split|partition)|train_test_split", re.IGNORECASE)
TARGET = re.compile(r"\b(?:train\w*|test\w*|validation|folds?|sets?|subsets?)\b|\d+\s*%|\d+/\d+", re.IGNORECASE)
CLAIM = re.compile(rf"\b{GROUP}[- ]independent\b|\b(?:cross|inter)-{GROUP}\b|\b(?:generali[sz]\w*|transfer\w*) to "
                   rf"(?:unseen|new|independent|other) {GROUPS}\b", re.IGNORECASE)
FIT = re.compile(r"\b(?:normali[sz]\w*|standardi[sz]\w*|z-scor\w*|rescal\w*|scal(?:ed|ing)|min-max|"
                 r"feature selection|features were selected|principal component|PCA|SMOTE|oversampl\w*|"
                 r"undersampl\w*|imput\w*|vocabulary|TF-IDF|discreti[sz]\w*|whiten\w*)", re.IGNORECASE)
ALL_DATA = re.compile(r"\b(?:whole|entire|full|complete|pooled) (?:data\s?set|data|cohort|corpus|sample)|"
                      r"\ball (?:\d[\d,]* )?(?:data|samples|patients|subjects|participants|records|recordings|images|"
                      r"documents|examples|instances|observations)\b|\bbefore (?:the )?(?:[\w-]+ )?(?:split\w*|"
                      r"partition\w*|dividing|division|cross-validation)|\bprior to (?:the )?(?:[\w-]+ )?(?:split\w*|"
                      r"partition\w*|cross-validation)|\bthen split|\bsubsequently split|"
                      r"\bglobal (?:mean|statistics|normali\w*|z-scor\w*)", re.IGNORECASE)
IN_TRAINING = re.compile(r"\b(?:on|using|from|within|in) (?:the |each )?training (?:folds?|sets?|data|partitions?|"
                         r"splits?|portion)|\bnested\b|\bwithin each fold", re.IGNORECASE)
TEST_TUNING = re.compile(r"\b(?:tun\w*|optimi[sz]\w*|select\w*|chos\w*|calibrat\w*|early stopping|threshold\w*)"
                         r"[^.;]{0,40}?\b(?:on|using|against|with) the test (?:set|data|split|fold)", re.IGNORECASE)
RC = "writing.rc.problem."


def _problem(kind: str, p: dict[str, Any], s: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"code": RC + kind, "paragraph": p["index"], "sentence": s["index"], "heading": p["heading"],
            "quote": s["text"], **extra}


def problems(paras: list[dict[str, Any]], states: Callable[[str, re.Pattern[str]], bool],
             grouped: bool) -> dict[str, list[dict[str, Any]]]:
    """Problems per item key (`subject_wise_split`, `leakage`); `states(text, rx)` = rx matches in an affirmed clause;
    `grouped`: the draft states a grouped split."""
    split: list[dict[str, Any]] = []
    leak: list[dict[str, Any]] = []
    random_split, claims = None, []
    grouped_rx = re.compile(GROUPED, re.IGNORECASE)
    for p in paras:
        for s in p["sentences"]:
            t = s["text"]
            if states(t, RANDOM_SPLIT) and TARGET.search(t) and not grouped_rx.search(t):
                random_split = random_split or (p, s)
                if SEGMENTS.search(t) or GENERIC.search(t) and POOLED.search(t):
                    split.append(_problem("random_split_of_segments", p, s))
            if states(t, CLAIM):
                claims.append((p, s))
            if states(t, FIT) and ALL_DATA.search(t) and not IN_TRAINING.search(t):
                leak.append(_problem("fit_before_split", p, s))
            elif states(t, TEST_TUNING):
                leak.append(_problem("test_set_tuning", p, s))
    if grouped:
        split = []
    elif random_split:
        q, r = random_split
        split += [_problem("independence_claim_with_random_split", p, s,
                           related={"paragraph": q["index"], "sentence": r["index"]}) for p, s in claims]
    return {"subject_wise_split": split, "leakage": leak}
