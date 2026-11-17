"""W7 citation over-reach check: modality levels, citation keys, n-gram coverage in English and Chinese, verdicts, and
the pinned precision / recall on the synthetic fixture (tests/fixtures/writing/citation_overreach.json, written by the
developers; its first run found 9/10, then the possessive "'s" token was dropped and 与...相关 keeps its topic)."""

from __future__ import annotations

import json
from pathlib import Path

from researchos.services.writing import citation_check as cc

FIXTURE = Path(__file__).parent / "fixtures" / "writing" / "citation_overreach.json"


def test_strength_levels_in_both_languages() -> None:
    en = ("X proves Y.", "X shows Y.", "X reduces Y.", "X may reduce Y.", "X is associated with Y.",
          "We demonstrate that X may reduce Y.")
    assert [cc.strength(t) for t in en] == [3, 2, 2, 1, 1, 1]
    zh = ("研究证实X降低Y。", "结果表明X降低Y。", "X降低Y。", "X可能降低Y。", "X与Y相关。")
    assert [cc.strength(t) for t in zh] == [3, 2, 2, 1, 1]


def test_citation_keys_placeholders_and_numeric_ranges() -> None:
    assert cc.keys("A {{cite:smith2020}} and [1, 3] then [5-7] and [9–10].") == \
        ["smith2020", "1", "3", "5", "6", "7", "9", "10"]
    assert cc.keys("No citation here, only a list [a].") == []


def test_coverage_ignores_markers_and_modality_words() -> None:
    claim = cc.grams("Walking proves lower glucose {{cite:a}}.")
    assert cc.coverage(claim, cc.grams("Walking may lower glucose.")) == 1.0
    assert cc.coverage(cc.grams("睡眠不足导致血压升高"), cc.grams("睡眠不足与血压升高相关")) > 0.5


def test_verdicts() -> None:
    sources = {"a": "Exercise was associated with lower blood pressure in older adults.", "b": "Unrelated text."}
    verdict = {f["key"]: f["verdict"] for f in cc.check(
        "Exercise lowers blood pressure in older adults {{cite:a}} {{cite:b}} {{cite:c}}.", sources)}
    assert verdict == {"a": "over_reach", "b": "no_support", "c": "no_source"}
    assert cc.check("Exercise may lower blood pressure in older adults [1].", {"1": sources["a"]})[0]["verdict"] == "ok"
    assert cc.check("# Heading {{cite:a}}\n\nA sentence without citations.", sources) == []


def test_fixture_precision_and_recall_are_pinned() -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    pairs = [(it["expected"], cc.check(it["sentence"], fx["sources"])[0]["verdict"]) for it in fx["items"]]
    for label in ("over_reach", "no_support"):
        tp = sum(e == p == label for e, p in pairs)
        predicted, actual = sum(p == label for _, p in pairs), sum(e == label for e, _ in pairs)
        assert (tp, predicted, actual) == (3, 3, 3), label  # precision 1.0, recall 1.0 per class
    assert sum(e == p for e, p in pairs) == 10
