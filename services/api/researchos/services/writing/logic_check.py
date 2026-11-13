"""Argument logic check (W3), deterministic part: per paragraph, the sentences that make a claim and the citations /
evidence / metrics / numbers in that sentence, plus sentence-located flags:
- `claim_without_evidence`: a claim with no support in its sentence (a sentence that draws on the previous one -
  "This shows ...", "therefore" - inherits that sentence's support), not hedged; a number compared with prior /
  published / state-of-the-art work needs a citation or evidence, our own number is no source for it
  (`reason: number_without_source`);
- not a claim: in a Methods-like section, a procedure ("artifacts were reduced with ICA, removing ..."); not without
  evidence: our own result ("we achieved ...", "our network reached ...") with a citation, metric, evidence or table /
  figure reference in it or in the next sentence; any sentence with a table / figure reference is supported;
- `conclusion_exceeds_results`: generalising / absolute wording (all, always, proves, solves, clinically ready, any
  dataset ...), certain predictions (will eliminate, will certainly, all future, will never, guaranteed) or
  "significant" without a reported statistic; superiority (outperformed, superior, better than ...) in a section that
  reports own findings (Abstract, Results, Discussion ...) of a draft that names no test / CI / p-value, and no sample
  size in its paragraph (`reason: superiority_without_statistics`); one flag
  per sentence, `markers` lists every marker in order; results of one selected run / seed / split when the draft
  never states the number of runs (`reason: selective_reporting`, logic_cues);
- `contradiction`: two sentences about the same topic (shared content words, or a shared run of them across
  sections) with opposite direction (higher / lower, rises / fell, improved / worsened or did not improve, 升高 / 降低),
  the later one flagged with the location of the earlier one; or the same quantity (metric, p, n, mean ...) with
  another value in an earlier section (`reason: numeric_mismatch`, `metric`, `values`; logic_numbers);
- `overstrong_causal_wording`: causal verbs (causes, leads to, drives, determines, is responsible for ...) unless the
  paragraph describes an experimental manipulation (randomised, ablation, ...) or hedges.
English wording only, except the direction words of the contradiction check (a Chinese draft gets at most
contradiction flags; the model pass covers the rest). A contradiction subsumes a
missing-evidence flag on the same sentence. Codes are `writing.<flag>`; the
English message is for the API, the web translates by code (ADR-247 pattern)."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from ...contracts.exporters import CiteSpan, MetricSpan, TextSpan
from ..knowledge.text import EXEMPT, PROSE_NUMBER_RE
from . import doc_snapshot, logic_cues, logic_numbers
from .doc_snapshot import EvidenceSpan, LiteralSpan, SourceSpan
from .logic_cues import BACKGROUND, INTRO, REPORTING, SAMPLE_SIZE, SUPERIOR, SUPERLATIVE, THAN

NS = "writing."
FLAGS = ("claim_without_evidence", "conclusion_exceeds_results", "contradiction", "overstrong_causal_wording")
MESSAGES = {
    "claim_without_evidence": "claim without a citation, evidence or result in its sentence",
    "conclusion_exceeds_results": "wording goes beyond what the reported results can show",
    "contradiction": "contradicts an earlier claim on the same topic",
    "overstrong_causal_wording": "causal wording without a design that supports causation",
}
FIX = {"claim_without_evidence": "writing.fix.cite_or_hedge", "conclusion_exceeds_results": "writing.fix.limit_scope",
       "contradiction": "writing.fix.reconcile", "overstrong_causal_wording": "writing.fix.associative_wording"}


def _rx(words: str) -> re.Pattern[str]:
    return re.compile(rf"\b(?:{words})\b", re.IGNORECASE)


CLAIM = _rx(r"outperform\w*|improv\w*|impair\w*|enhanc\w*|reduc\w*|increas\w*|decreas\w*|superior|inferior|better|"
            r"worse|higher|lower|essential|effective|robust|generali[sz]\w*|solv\w*|prov(?:e|es|ed|en)|"
            r"demonstrat\w*|shown|shows|reveal\w*|confirm\w*|caus\w*|leads? to|led to|drives?|driven|determin\w*|"
            r"responsible for|associated|correlat\w*|predict\w*|significant\w*|ready|detects?|mediat\w*|"
            r"well known|it is known|perform\w* (?:equally )?well|(?:more|less) \w+ than")  # any comparison is a claim
HEDGE = _rx(r"may|might|could|suggests?|suggested|possibly|likely|appears?|we hypothesi[sz]e|we propose|we expect|"
            r"we aim|potentially|preliminary|hypothesis")
ANAPHOR = re.compile(r"^\s*(?:this|these|thus|hence|consequently|overall|together|taken together|accordingly|"
                     r"our results|the results)\b|\btherefore\b", re.IGNORECASE)
# A prediction stated as certain or universal: "will" followed within a few words by a certainty adverb, a universal
# quantifier or an end state ("will soon be used in every clinic", "will no longer need"); no reported result shows
# the future. A plan ("we will", "future work will") or "will be made available" is no prediction; "may" hedges.
FUTURE = (r"(?<!\bwe )(?<!work )(?<!studies )(?<!research )will (?!be made )(?:\w+ ){0,6}?"
          r"(?:certainly|definitely|surely|undoubtedly|inevitably|always|never|no longer|no more|every|all|any|"
          r"eliminat\w*|replac\w*|obsolete|unnecessary)|all future|(?:is|are|be) guaranteed")
OVERREACH = _rx(FUTURE + r"|all|always|never|any|every|universally|definitively|conclusively|guarantee\w*|"
                r"solv(?:e|es|ed)|prov(?:e|es|ed|en)|clinically (?:ready|useful|applicable)|"
                r"ready for (?:clinical )?deployment|deployment in|in general|generali[sz]es? to")
STRONG = _rx(FUTURE + r"|universally|definitively|conclusively|guarantee\w*|solv(?:e|es|ed)|prov(?:e|es|ed|en)|"
             r"clinically (?:ready|useful|applicable)|ready for (?:clinical )?deployment|deployment in|"
             r"generali[sz]es? to")  # absolute wording that is a claim by itself (bare quantifiers are not)
PRIOR = re.compile(r"\b(?:prior(?! to)|previous(?:ly)?|published|state[- ]of[- ]the[- ]art|existing (?:methods?|"
                   r"approaches|work|studies|systems)|earlier (?:work|studies|reports?|methods)|(?:the )?literature|"
                   r"other (?:studies|groups|methods|authors)|best (?:known|reported))\b", re.IGNORECASE)
COMPARE = _rx(r"than|over|compared (?:with|to)|relative to|exceed\w*|surpass\w*|outperform\w*|improv\w*|beyond|"
              r"above|below|ahead of|versus|vs")
METHODS = re.compile(r"method|material|procedure|preprocess|acquisition|recording|experimental (?:setup|design)|"
                     r"protocol|方法", re.IGNORECASE)
# "<x> was reduced with / using / via <method>" plus a trailing participle clause (", removing ..."); "by" + a number
# or amount is a result ("reduced by 12%")
PROCEDURE = re.compile(r"\b(?:was|were|is|are|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\s+(?:with|using|via|through|"
                       r"by(?!\s+(?:\d|about|approximately|nearly|almost|up to|a factor|more|less|half)))\b[^,;]*"
                       r"(?:,\s*\w+ing\b[^,;.]*)?", re.IGNORECASE)
OWN = re.compile(r"^\s*(?:we|our\b[^.]{0,40}?)\s+(?:\w+\s+)?(?:achieved|reached|obtained|attained|yielded|found|"
                 r"observed|measured|scored)\b", re.IGNORECASE)
REFERENCE = re.compile(r"\b(?:Tables?|Fig(?:ure)?s?\.?|Supplementary (?:Table|Fig\w*))\s*S?\d")
SIGNIFICANT = _rx(r"significant(?:ly)?")
STATISTIC = re.compile(r"\bp\s*[<=>≤]|\bCI\b|confidence interval|credible interval|\b[tF]\(|χ2|chi-square|Wilcoxon|"
                       r"t-test|ANOVA|permutation|DeLong|McNemar|Mann-Whitney|Kruskal|Fisher'?s exact|bootstrap\w*|"
                       r"mixed[- ]effects", re.IGNORECASE)
CAUSAL = _rx(r"causes?(?! of)|caused|causing|leads? to|led to|drives?|driven by|determines?|determined by|"
             r"(?:is|are) responsible for|results? in|mediates?")
EXPERIMENT = _rx(r"randomi[sz]ed|randomly assigned|interventional|controlled trial|ablation|manipulat\w*")
# Direction of a change, English and Chinese antonym pairs (Han words without \b: it sees no edge inside a run of Han
# characters). Bare "up" / "down" / "gain" are not listed ("set up", "down-sampled"), only "went up" / "up-regulated".
UP = re.compile(r"\b(?:increas\w*|higher|more|improv\w*|better|enhanc\w*|outperform\w*|superior|ris(?:e|es|en|ing)|"
                r"rose|rais(?:e|es|ed|ing)|grew|grows?|grown|climb\w*|elevated|(?:go|goes|going|went|gone) up|"
                r"up-?regulat\w*)\b|"
                r"增加|增大|增强|升高|上升|提高|改善|更高|更好|优于", re.IGNORECASE)
DOWN = re.compile(r"\b(?:decreas\w*|reduc\w*|lower|less|worse|worsen\w*|impair\w*|inferior|underperform\w*|"
                  r"fall|falls|fell|fallen|falling|drops?|dropped|dropping|shr[iau]nk\w*|declin\w*|deteriorat\w*|"
                  r"(?:go|goes|going|went|gone) down|"
                  r"down-?regulat\w*)\b|减少|减小|减弱|降低|下降|恶化|更低|更差|劣于", re.IGNORECASE)
NEGATION = re.compile(r"\b(?:not|no|never|failed to|cannot|\w+n't)\b|未(?!来|知|经)|没有|并非", re.IGNORECASE)
HAN_RUN = re.compile(r"[\u3400-\u9fff]+")
HAN_FUNCTION = re.compile(r"[的了在和与及是对于中时后前]")  # function characters split a run (no bigram across them)
STOP = {"the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "with", "by", "at", "from", "as", "is", "are",
        "was", "were", "be", "been", "this", "that", "these", "those", "our", "we", "it", "its", "their", "than",
        "then", "however", "later", "same", "also", "which", "into", "over", "under", "per"}
BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(\[{])|(?<=[。！？])\s*")
RUN = 3  # consecutive content words two sentences must share to be on one topic at a lower overlap (MIN_SHARED_RUN)
TOPIC, MIN_SHARED_RUN = 0.4, 0.25  # word overlap (shared / union) for the same topic, without and with a shared run
MAX_POSTINGS = 64  # earlier claims kept per topic stem and direction for the contradiction check
ABBREV = re.compile(r"(?:\b(?:e\.g|i\.e|et al|Figs?|Eqs?|vs|cf|approx|resp|Refs?|No|Dr|Mr|Ms)\.)$", re.IGNORECASE)


def source(ss: tuple[SourceSpan, ...]) -> str:
    """The doc text of parsed spans (placeholders written back as in the body)."""
    out = []
    for s in ss:
        if isinstance(s, CiteSpan):
            out.append(f"{{{{cite:{s.citekey}}}}}")
        elif isinstance(s, MetricSpan):
            out.append(f"{{{{metric:{s.run_id}/{s.name}/{s.split}}}}}")
        elif isinstance(s, EvidenceSpan):
            out.append(f"{{{{evidence:{s.evidence_id}}}}}")
        elif isinstance(s, LiteralSpan):
            out.append(f"{{{{lit:{s.text}}}}}")
        else:
            out.append(s.text)
    return "".join(out)


def sentences(text: str) -> list[str]:
    out: list[str] = []
    start = 0
    for m in BOUNDARY.finditer(text):
        if m.start() <= start or ABBREV.search(text[start:m.start()]):
            continue
        out.append(text[start:m.start()].strip())
        start = m.end()
    tail = text[start:].strip()
    return [s for s in [*out, tail] if s]


def prior_comparison(text: str) -> re.Match[str] | None:
    """The prior-work wording of a comparison with prior work ("over the best prior result"), or None."""
    return PRIOR.search(text) if COMPARE.search(text) else None


def is_claim(text: str) -> bool:
    """Claim cue, causal verb, strong absolute wording or a comparison with prior work ("all participants gave
    consent" is not a claim)."""
    return bool(CLAIM.search(text) or CAUSAL.search(text) or STRONG.search(text) or SUPERIOR.search(text)
                or SUPERLATIVE.search(text) or prior_comparison(text))


def plain(ss: tuple[SourceSpan, ...]) -> str:
    return " ".join(s.text for s in ss if isinstance(s, TextSpan))


def support(ss: tuple[SourceSpan, ...]) -> dict[str, list[str]]:
    nums = [m.group(0) for s in ss if isinstance(s, TextSpan)
            for m in PROSE_NUMBER_RE.finditer(EXEMPT.sub(" ", s.text))]
    return {"citations": [s.citekey for s in ss if isinstance(s, CiteSpan)],
            "evidence": [s.evidence_id for s in ss if isinstance(s, EvidenceSpan)],
            "metrics": [f"{s.run_id}/{s.name}/{s.split}" for s in ss if isinstance(s, MetricSpan)], "numbers": nums}


def supported(sup: dict[str, list[str]]) -> bool:
    return any(sup.values())


def topic_words(text: str) -> list[str]:
    """Content words in order (5-letter stems; Han text as character bigrams), direction and negation words removed."""
    text = NEGATION.sub(" ", DOWN.sub(" ", UP.sub(" ", text.lower())))
    out = []
    for m in re.finditer(r"[a-z][a-z-]+|[\u3400-\u9fff]+", text):
        if HAN_RUN.fullmatch(w := m.group(0)):
            out += [r[i:i + 2] for r in HAN_FUNCTION.split(w) for i in range(len(r) - 1)]
        elif w not in STOP:
            out.append(w[:5])
    return out


def stems(text: str) -> set[str]:
    return set(topic_words(text))


def runs(words: list[str], n: int = RUN) -> set[tuple[str, ...]]:
    """Runs of n consecutive content words; two sentences sharing one name the same quantity ("mu-band power over the
    contralateral motor cortex")."""
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def direction(text: str) -> int:
    up, down = bool(UP.search(text)), bool(DOWN.search(text))
    if up == down:
        return 0
    d = 1 if up else -1
    return -d if NEGATION.search(text) else d


def flag(code: str, p: dict[str, Any], s: dict[str, Any], quote: str, **extra: Any) -> dict[str, Any]:
    return {"code": NS + code, "severity": "warning", "paragraph": p["index"], "sentence": s["index"],
            "heading": p["heading"], "quote": quote, "sentence_text": s["text"], "message": MESSAGES[code],
            "source": "heuristic", "fix": {"code": FIX[code]}, **extra}


def _referenced(s: dict[str, Any] | None) -> bool:
    """A citation, evidence, metric or table / figure reference (bare numbers are not: "The gain is modest")."""
    if s is None:
        return False
    return any(s["support"][k] for k in ("citations", "evidence", "metrics")) or bool(REFERENCE.search(s["plain"]))


def _background(heading: str, text: str) -> bool:
    """A generic background fact in the Introduction ("X is common and associated with Y", "is essential because"):
    every claim cue is a background cue, no comparison, superlative, causal or absolute wording (round 3)."""
    cues = [m.group(0) for m in CLAIM.finditer(text)]
    return bool(INTRO.search(heading)) and all(BACKGROUND.fullmatch(c) for c in cues) and not (
        THAN.search(text) or SUPERIOR.search(text) or SUPERLATIVE.search(text) or CAUSAL.search(text)
        or STRONG.search(text) or prior_comparison(text))


def _sentence_flags(p: dict[str, Any], s: dict[str, Any], prev: dict[str, Any] | None, nxt: dict[str, Any] | None,
                    para: str, doc_statistics: bool = True) -> list[dict[str, Any]]:
    text, out = s["plain"], []
    hedged = bool(HEDGE.search(text))
    inherited = bool(prev and ANAPHOR.search(text) and supported(prev["support"]))
    inherited |= bool(REFERENCE.search(text))  # "results are shown in Fig. 4" points at the data
    inherited |= bool(OWN.search(text) and _referenced(nxt))  # our result, its source in the next sentence
    sourced = any(s["support"][k] or (prev and ANAPHOR.search(text) and prev["support"][k])
                  for k in ("citations", "evidence"))
    prior = prior_comparison(text)
    if prior and s["support"]["numbers"] and not sourced:  # hedged or not: the number about others is unsourced
        out.append(flag("claim_without_evidence", p, s, prior.group(0), reason="number_without_source"))
    elif not supported(s["support"]) and not hedged and not inherited and not _background(p["heading"], text):
        m = CLAIM.search(text) or CAUSAL.search(text) or STRONG.search(text)
        out.append(flag("claim_without_evidence", p, s, m.group(0) if m else text.strip()))
    markers = list(dict.fromkeys(m.group(0) for m in OVERREACH.finditer(text)))
    sig = SIGNIFICANT.search(text)
    if markers and not hedged:
        out.append(flag("conclusion_exceeds_results", p, s, markers[0], markers=markers))
    elif sig and not STATISTIC.search(para) and not s["support"]["numbers"] and not s["support"]["metrics"]:
        out.append(flag("conclusion_exceeds_results", p, s, sig.group(0)))
    elif (sup := SUPERIOR.search(text)) and not doc_statistics and REPORTING.search(p["heading"]) and not hedged \
            and not sourced and not SAMPLE_SIZE.search(para):
        out.append(flag("conclusion_exceeds_results", p, s, sup.group(0), reason="superiority_without_statistics"))
    causal = CAUSAL.search(text)
    if causal and not hedged and not EXPERIMENT.search(para):
        out.append(flag("overstrong_causal_wording", p, s, causal.group(0)))
    return out


def _contradictions(paragraphs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each directional sentence against the earlier ones of the OPPOSITE direction that share a topic stem (an inverted
    index per direction; an identical earlier sentence is indexed once; at most MAX_POSTINGS earliest sentences per
    stem), so a long draft costs about linear time instead of all pairs (review W2W3W5 #5). Same topic: word overlap
    >= TOPIC, or >= MIN_SHARED_RUN with a shared run of RUN content words - the changed quantity named the same way
    in two otherwise different sentences, e.g. Introduction vs Results (sample 2, F3)."""
    seen: list[tuple[dict[str, Any], dict[str, Any], set[str], set[tuple[str, ...]]]] = []
    index: dict[int, dict[str, list[int]]] = {1: {}, -1: {}}
    indexed: set[tuple[int, frozenset[str]]] = set()
    out = []
    for p in paragraphs:
        for s in p["sentences"]:
            if not (d := direction(s["plain"])):
                continue
            words = topic_words(s["plain"])
            topic, word_runs = set(words), runs(words)
            shared = Counter(i for w in topic for i in index[-d].get(w, ()))
            for i in sorted(i for i, n in shared.items() if n >= 2):
                q, t, other, other_runs = seen[i]
                overlap = shared[i] / len(topic | other)
                if overlap >= TOPIC or overlap >= MIN_SHARED_RUN and not word_runs.isdisjoint(other_runs):
                    m = UP.search(s["plain"]) or DOWN.search(s["plain"])
                    out.append(flag("contradiction", p, s, m.group(0) if m else s["plain"].strip(),
                                    related={"paragraph": q["index"], "sentence": t["index"]}))
                    break
            if (d, frozenset(topic)) in indexed:
                continue
            indexed.add((d, frozenset(topic)))
            seen.append((p, s, topic, word_runs))
            for w in topic:
                if len(posting := index[d].setdefault(w, [])) < MAX_POSTINGS:
                    posting.append(len(seen) - 1)
    return out


def paragraphs(body: str) -> list[dict[str, Any]]:
    """Paragraph / list blocks with their heading and sentences (`plain` = text without placeholders)."""
    paragraphs: list[dict[str, Any]] = []
    heading = ""
    for b in doc_snapshot.parse(body):
        if b.kind == "heading":
            heading = plain(b.spans).strip()
        if b.kind not in ("paragraph", "list"):
            continue
        sents = []
        for i, text in enumerate(sentences(source(b.spans))):
            ss = doc_snapshot.spans(text)
            # a procedure or a selection ("the checkpoint with the best validation loss") in Methods is no claim
            claim_text = SUPERLATIVE.sub(" ", PROCEDURE.sub(" ", plain(ss))) if METHODS.search(heading) else plain(ss)
            sents.append({"index": i, "text": text, "plain": plain(ss), "claim": is_claim(claim_text),
                          "support": support(ss)})
        paragraphs.append({"index": len(paragraphs), "heading": heading, "sentences": sents})
    return paragraphs


def analyse(body: str) -> dict[str, Any]:
    """Pure: the doc body -> paragraphs with sentence claims + support, and the heuristic flags."""
    paras = paragraphs(body)
    flags = _contradictions(paras)
    directional = {(f["paragraph"], f["sentence"]) for f in flags}
    for p, s, q, t, was, now, quote in logic_numbers.contradictions(paras, topic_words):
        if (p["index"], s["index"]) not in directional:
            flags.append(flag("contradiction", p, s, quote, reason="numeric_mismatch", metric=now.key,
                              values=[was.raw, now.raw], related={"paragraph": q["index"], "sentence": t["index"]}))
    contradicted = {(f["paragraph"], f["sentence"]) for f in flags}
    statistics = any(STATISTIC.search(s["plain"]) for p in paras for s in p["sentences"])
    for p in paras:
        para = " ".join(s["plain"] for s in p["sentences"])
        for s in p["sentences"]:
            prev = p["sentences"][s["index"] - 1] if s["index"] else None
            nxt = p["sentences"][s["index"] + 1] if s["index"] + 1 < len(p["sentences"]) else None
            for f in _sentence_flags(p, s, prev, nxt, para, statistics) if s["claim"] else []:
                if not (f["code"] == NS + "claim_without_evidence" and (p["index"], s["index"]) in contradicted):
                    flags.append(f)
    exceeding = {(f["paragraph"], f["sentence"]) for f in flags if f["code"] == NS + "conclusion_exceeds_results"}
    flags += [flag("conclusion_exceeds_results", p, s, quote, reason="selective_reporting")
              for p, s, quote in logic_cues.selective(paras) if (p["index"], s["index"]) not in exceeding]
    flags.sort(key=lambda f: (f["paragraph"], f["sentence"], f["code"]))
    for p in paras:
        for s in p["sentences"]:
            del s["plain"]
    return {"paragraphs": paras, "flags": flags, "counts": {
        "paragraphs": len(paras), "claims": sum(s["claim"] for p in paras for s in p["sentences"]),
        "flags": len(flags), **Counter(f["code"] for f in flags)}}

