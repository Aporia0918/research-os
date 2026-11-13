"""Reporting checklist (W5) on the owner's own draft, pure part: CONSORT / STARD / TRIPOD-style subsets, evaluation
(split / leakage) and EEG items. Each item is met when one sentence of the draft states all its patterns, not negated
or deferred (the sentence is the evidence); missing (undetermined in a mainly Chinese draft: the patterns are English);
`problem` when a sentence describes a leaking split or preprocessing (split_leakage); not applicable when its
guideline's study type is neither detected in the draft nor requested. Deterministic; no model, no database."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from . import split_leakage


@dataclass(frozen=True)
class ReportingItem:
    key: str
    guideline: str  # core (always applies) | consort | stard | tripod | eeg
    label: str  # English label of the API; the web translates `writing.rc.<key>`
    patterns: tuple[str, ...]  # all must match within ONE sentence of the doc


def _i(key: str, guideline: str, label: str, *patterns: str) -> ReportingItem:
    return ReportingItem(key, guideline, label, patterns)


REPORTING: tuple[ReportingItem, ...] = (
    _i("sample_size", "core", "Number of participants / subjects stated",
       r"\b(?:n\s*=\s*\d+|\d+\s+(?:healthy\s+)?(?:participants|subjects|patients|volunteers|adults|children|"
       r"individuals))\b"),
    _i("power", "core", "Sample size justified (power analysis)",
       r"power analysis|statistical power|a priori sample size|sample size (?:was |were )?(?:calculated|determined|"
       r"estimated|justified)|G\*Power"),
    _i("statistics", "core", "Statistical tests or confidence intervals named",
       r"t-test|ANOVA|Wilcoxon|Mann-Whitney|permutation test|chi-square|confidence interval|\bp\s*[<=>≤]|"
       r"mixed[- ]effects"),
    _i("ethics", "core", "Ethics approval and consent",
       r"ethic\w* (?:committee|approval|board|review)|\bIRB\b|informed consent|Helsinki"),
    _i("data_availability", "core", "Data / code availability",
       r"(?:data|code) (?:are|is|will be) (?:publicly |openly )?available|available (?:at|on|from|upon)|github\.com|"
       r"zenodo|\bOSF\b|upon (?:reasonable )?request"),
    _i("randomisation", "consort", "Randomisation / allocation",
       r"randomi[sz]\w*|random allocation|allocation sequence"),
    _i("blinding", "consort", "Blinding", r"blind\w*|mask(?:ed|ing)"),
    _i("primary_outcome", "consort", "Primary outcome defined", r"primary (?:outcome|endpoint)"),
    _i("participant_flow", "consort", "Participant flow / exclusions",
       r"flow (?:diagram|chart)|lost to follow-up|withdr[ea]w\w*|drop-?outs?|were excluded"),
    _i("trial_registration", "consort", "Trial registration",
       r"ClinicalTrials\.gov|NCT\d{8}|ISRCTN|trial (?:was )?registered|registration number"),
    _i("reference_standard", "stard", "Reference standard", r"reference standard|gold standard|ground[- ]truth"),
    _i("index_test_threshold", "stard", "Index test threshold / cut-off", r"threshold|cut-?off"),
    _i("accuracy_ci", "stard", "Accuracy with confidence intervals",
       r"sensitivity|specificity|\bAUC\b|area under", r"95\s*%|confidence interval|\bCI\b"),
    _i("predictors", "tripod", "Predictors / input features defined",
       r"predictors?|candidate variables|input features|features? (?:were|was) (?:extracted|selected|computed)"),
    _i("missing_data", "tripod", "Handling of missing data", r"missing (?:data|values)|imput\w*|complete[- ]case"),
    _i("validation", "tripod", "Internal / external validation",
       r"external validation|internal validation|cross-validation|held-out|hold-out|bootstrap\w*|"
       r"independent test set"),
    _i("calibration", "tripod", "Calibration reported", r"calibration (?:plot|curve|slope|intercept)|Brier|Hosmer"),
    # how the split was done, not the setting: "subject-independent result" / "cross-subject generalisation" alone
    # does not report it (sample 2, F6a); any grouping unit (patient, site, speaker ...) for every data type (round 3)
    _i("subject_wise_split", "evaluation", "Train / test split by subject (patient, site ...)", split_leakage.GROUPED),
    _i("leakage", "evaluation", "Leakage control (preprocessing fitted on training data only)",
       r"leak\w*|(?:fit(?:ted)?|estimated|computed|learned|derived) (?:only )?(?:on|from) the training|"
       r"within (?:each|the) training fold|nested (?:within|cross-validation)"),
    _i("channels_reference", "eeg", "Electrodes / channels and reference", r"electrodes?|channels?", r"refer\w*"),
    _i("sampling_rate", "eeg", "Sampling rate", r"\d+(?:\.\d+)?\s*Hz", r"sampl\w*|record\w*"),
    _i("filtering", "eeg", "Filters with cut-off frequencies", r"filter\w*|band-pass|high-pass|low-pass|notch", r"Hz"),
    _i("artifact_handling", "eeg", "Artifact handling", r"artifacts?|artefacts?|\bICA\b|independent component|\bEOG\b|"
       r"ocular"),
)
# English and Chinese wording of the study type; `(?<![A-Za-z])` because `\b` sees no edge in "采集EEG信号"
PROFILES = {
    "consort": r"randomi[sz]ed (?:controlled )?trial|\bRCT\b|clinical trial|随机对照试验|随机化?临床试验|临床试验",
    "stard": r"diagnostic accuracy|index test|reference standard|sensitivity and specificity|诊断准确性|待评价试验|"
             r"参考标准|金标准|灵敏度和特异度",
    "tripod": r"prediction model|prognostic model|risk (?:score|model)|predictive model|classifier|"
              r"classification model|machine learning model|预测模型|预后模型|风险(?:评分|模型)|分类器|分类模型|"
              r"机器学习模型",
    # a model evaluated on data (any data type): the split / leakage items apply; an EEG draft always (round 3)
    "evaluation": r"\bclassifier|cross-validation|held-out|hold-out|\b(?:test|training|validation) (?:set|data|fold)|"
                  r"train-test|fine-tuned|deep learning|machine learning|neural network|random forest|"
                  r"gradient[- ]boost\w*|regression model|support vector|分类器|交叉验证|测试集|训练集",
    "eeg": r"(?<![A-Za-z])(?:EEG|ERP)(?![A-Za-z])|electroencephalogra\w*|event-related potential|脑电|事件相关电位",
}
# The item patterns are English: in a mainly Chinese draft an item no sentence matches is `undetermined` (the draft may
# state it in words the check cannot read), not `missing` (review W2W3W5 #6).
HAN = re.compile(r"[\u3400-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")
HAN_SHARE = 0.3
RC = "writing.rc."
STATUSES = ("met", "problem", "missing", "undetermined", "not_applicable")
MAX_EVIDENCE = 2


LITERAL = re.compile(r"\{\{lit:([^{}]+)\}\}")


# Mentioning an item is not reporting it: a match whose clause is negated ("No power analysis was performed",
# "consent was not obtained") or deferred ("should be added in future work") does not meet the item. Prevention
# wording ("to ensure no leakage") states the control, so it is not a negation.
CLAUSE = re.compile(r"[,;:()]|\b(?:but|although|though|whereas|while|however)\b", re.IGNORECASE)
NEGATED = re.compile(r"\b(?:not|no|never|none|neither|nor|without|cannot|lack\w*|absence of|omitted|unavailable|"
                     r"should|would|future (?:work|stud\w*)|(?:is|are|was|were) (?:needed|recommended))\b|n't\b",
                     re.IGNORECASE)
PREVENTION = re.compile(r"\b(?:(?:so as )?to (?:avoid|prevent|ensure|guarantee)|ensuring|avoiding|preventing|"
                        r"so that)\b", re.IGNORECASE)


def _affirmed(text: str, m: re.Match[str]) -> bool:
    start = max((c.end() for c in CLAUSE.finditer(text, 0, m.start())), default=0)
    end = next((c.start() for c in CLAUSE.finditer(text, m.end())), len(text))
    rest = text[start:m.start()] + " " + text[m.end():end]
    return not NEGATED.search(rest) or bool(PREVENTION.search(rest))


def _states(text: str, rx: re.Pattern[str]) -> bool:
    return any(_affirmed(text, m) for m in rx.finditer(text))


def _doc_evidence(paras: list[dict[str, Any]], patterns: Iterable[str]) -> list[dict[str, Any]]:
    """Sentences stating every pattern (a match in a negated / deferred clause does not count); `{{lit:12}}` is
    matched as 12, the quote stays verbatim."""
    rx = [re.compile(p, re.IGNORECASE) for p in patterns]
    return [{"source": "doc", "paragraph": p["index"], "sentence": s["index"], "heading": p["heading"],
             "quote": s["text"]} for p in paras for s in p["sentences"]
            if all(_states(LITERAL.sub(r"\1", s["text"]), r) for r in rx)]


def _profiles(paras: list[dict[str, Any]], requested: list[str] | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {"core": {"applies": True, "how": "always"}}
    for name, pattern in PROFILES.items():
        if requested is not None:
            out[name] = {"applies": name in requested, "how": "requested"}
            continue
        ev = _doc_evidence(paras, (pattern,))[:1]
        out[name] = {"applies": bool(ev), "how": "detected" if ev else "not_detected", "evidence": ev}
    if requested is not None:  # not requestable on its own: an EEG or prediction-model draft evaluates a model
        out["evaluation"] = {"applies": bool({"eeg", "tripod"} & set(requested)), "how": "requested"}
    elif not out["evaluation"]["applies"] and out["eeg"]["applies"]:
        out["evaluation"] = {"applies": True, "how": "eeg", "evidence": out["eeg"]["evidence"]}
    return out


def language_supported(paras: list[dict[str, Any]]) -> bool:
    """False for a mainly Chinese draft (Han characters >= HAN_SHARE of its letters)."""
    text = " ".join(s["text"] for p in paras for s in p["sentences"])
    han, latin = len(HAN.findall(text)), len(LATIN.findall(text))
    return han < HAN_SHARE * (han + latin) or not han


def evaluate(paras: list[dict[str, Any]], profiles: list[str] | None = None) -> dict[str, Any]:
    """Pure: the parsed draft -> profiles and items (met / missing / undetermined / not_applicable, or `problem` when a
    sentence describes a leaking split or preprocessing, see split_leakage) with their evidence."""
    applies = _profiles(paras, profiles)
    supported = language_supported(paras)
    grouped = bool(_doc_evidence(paras, (split_leakage.GROUPED,)))
    found = split_leakage.problems(paras, lambda t, rx: _states(LITERAL.sub(r"\1", t), rx), grouped)
    out = []
    for it in REPORTING:
        on = applies[it.guideline]["applies"]
        ev = _doc_evidence(paras, it.patterns)[:MAX_EVIDENCE] if on else []
        problems = found.get(it.key, []) if on else []
        unmatched = "missing" if supported else "undetermined"
        status = "problem" if problems else "met" if ev else unmatched if on else "not_applicable"
        notes = [RC + "language_unsupported"] if status == "undetermined" else []
        out.append({"key": it.key, "guideline": it.guideline, "code": RC + it.key, "label": it.label,
                    "status": status, "evidence": ev, "problems": problems, "notes": notes})
    counts = {k: sum(i["status"] == k for i in out) for k in STATUSES}
    return {"profiles": applies, "language_supported": supported, "items": out, "counts": counts}
