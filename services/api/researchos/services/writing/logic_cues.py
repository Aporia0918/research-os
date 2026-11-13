"""Wording cues of the W3 logic check added in round 3 (failure classes of blind test 1): superiority without
statistics, superlatives, generic background facts of an Introduction that are not claims needing a citation, and
results of one selected run (selective reporting)."""

from __future__ import annotations

import re
from typing import Any


def _rx(words: str) -> re.Pattern[str]:
    return re.compile(rf"\b(?:{words})\b", re.IGNORECASE)


# superiority over another method; with no test / CI / p-value anywhere in the draft and no sample size in its paragraph
# it exceeds what the results can show (round 3, blind test 1 F7 class)
SUPERIOR = _rx(r"outperform\w*|superior(?:ity)?|better than|beats?|beating|surpass\w*|"
               r"(?:significantly|substantially|clearly|markedly|considerably|far) (?:better|higher|lower|more|less|"
               r"improved|superior)")
REPORTING = re.compile(r"abstract|summary|result|finding|discussion|conclusion|evaluation|experiment|performance|"
                       r"摘要|结果|讨论|结论", re.IGNORECASE)  # sections that report the authors' own findings
SAMPLE_SIZE = re.compile(r"\bn\s*=\s*\d|\b\d[\d,]*\s+(?:[a-z-]+\s+)?(?:patients|participants|subjects|volunteers|"
                         r"individuals|cases|images|recordings)\b", re.IGNORECASE)
SUPERLATIVE = _rx(r"best|most (?:effective|accurate|reliable|robust|promising|powerful|sensitive|specific|efficient|"
                  r"important)|the leading|the only|unmatched|unrivall?ed|unprecedented")
THAN = _rx(r"than|compared (?:with|to)|relative to|versus|vs")
# background cues in an Introduction: a known association or need, not a finding of ours or a comparison
INTRO = re.compile(r"introduction|background|motivation|引言|背景", re.IGNORECASE)
BACKGROUND = re.compile(r"associated|correlated?|correlates|correlation|essential|detects?|detecting|detection|"
                        r"well known|it is known|increasing(?:ly)?", re.IGNORECASE)
# selective reporting: results of one chosen run / seed / split while the draft never says how many runs there were
# (round 3, blind test 1 F10 class); choosing on validation data is model selection, not selective reporting
SELECTED = re.compile(r"\b(?:(?:random )?seed\s*(?:=\s*|#\s*|no\.?\s*)?\d+|"
                      r"(?:single )?best(?:-performing)? (?:training )?(?:run|seed|configuration|checkpoint|trial|"
                      r"split|fold|repetition)|single (?:best )?(?:training )?(?:run|seed)|"
                      r"most favou?rable (?:run|seed|data split|split|fold))\b", re.IGNORECASE)
REPORTED = _rx(r"results?|report\w*|correspond\w*|shown|shows?|scores?|numbers|values|present\w*|obtained|Table|"
               r"Fig\w*|below|above|F1|accuracy|AUC")
SELECTION_DATA = _rx(r"validation|development|inner|tuning")
RUNS = re.compile(r"\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred)\s+(?:independent\s+|"
                  r"random\s+|different\s+)*(?:runs|seeds|repetitions|repeats|initiali[sz]ations|restarts|trials)\b|"
                  r"\b(?:repeated|run|trained)\s+(?:\d+|two|three|five|ten)\s+times\b|\b(?:averaged|mean)\s+(?:over|across)"
                  r"\s+(?:\d+|three|five|ten)\b", re.IGNORECASE)


def selective(paras: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any], str]]:
    """(paragraph, sentence, selection wording) of results from one selected run when no sentence of the draft states
    the number of runs / seeds / repetitions."""
    sents = [(p, s) for p in paras for s in p["sentences"]]
    if any(RUNS.search(s["plain"]) for _, s in sents):
        return []
    return [(p, s, m.group(0)) for p, s in sents if (m := SELECTED.search(s["plain"]))
            and REPORTED.search(s["plain"]) and not SELECTION_DATA.search(s["plain"])]
