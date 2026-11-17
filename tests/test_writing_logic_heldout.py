"""W3 / W5 rules generalised on the held-out drafts (tests/fixtures/writing/heldout*_), each with fresh cases in other
wording, positive and negative, and the pinned scores of all three synthetic drafts (tests/writing_eval.py)."""

from __future__ import annotations

from researchos.services.writing import logic_check, reporting_checklist

from .writing_eval import DRAFTS, score

NS = "writing."


def _codes(body: str) -> dict[tuple[int, int], set[str]]:
    out: dict[tuple[int, int], set[str]] = {}
    for f in logic_check.analyse(body)["flags"]:
        out.setdefault((f["paragraph"], f["sentence"]), set()).add(f["code"].removeprefix(NS))
    return out


def _status(body: str, key: str) -> str:
    items = reporting_checklist.evaluate(logic_check.paragraphs(body))["items"]
    return next(i["status"] for i in items if i["key"] == key)


def test_direction_antonyms_on_the_same_subject_contradict_across_paragraphs() -> None:
    for before, after in (
        ("Specificity dropped when the sampling window was halved.", "Halving the sampling window raised specificity."),
        ("Tumour volume shrank after the second cycle.", "Tumour volume grew after the second cycle."),
        ("Gait speed climbed steadily over the first six training weeks.",
         "Gait speed declined steadily over the first six training weeks."),
    ):
        codes = _codes(f"## Results\n\n{before}\n\n## Discussion\n\n{after}\n")
        assert "contradiction" in codes.get((1, 0), set()), after
    # another subject, or the same direction, is no contradiction
    assert not _codes("## Results\n\nSpecificity dropped when the window was halved.\n\n"
                      "## Discussion\n\nTraining time dropped when the window was halved.\n")


def test_heartbeats_are_not_superiority_but_beat_as_a_verb_is() -> None:
    for noun in ("Ectopic beats were removed before training.", "We classified all beats of the test records.",
                 "Fusion beats made up a small share of the data.", "Each beat was labelled by two annotators."):
        assert not logic_check.analyse(f"## Methods\n\n{noun}\n")["counts"]["claims"], noun
    assert logic_check.analyse("## Results\n\nThe model beats the expert panel.\n")["counts"]["claims"] == 1
    assert logic_check.analyse("## Results\n\nXGBoost beat logistic regression on recall.\n")["counts"]["claims"] == 1


def test_cause_as_a_noun_is_not_causal_wording() -> None:
    assert "overstrong_causal_wording" not in _codes(
        "## Introduction\n\nStroke is a leading cause of disability {{cite:a}}.\n").get((0, 0), set())
    assert "overstrong_causal_wording" in _codes("## Introduction\n\nSleep loss causes insulin resistance.\n")[(0, 0)]


def test_certain_or_universal_predictions_exceed_the_results() -> None:
    for sentence in ("Clinics will soon screen every newborn with this device.",
                     "Radiologists will no longer need to review negative scans.",
                     "The method will replace manual counting.", "Pathologists will certainly adopt the tool."):
        codes = _codes(f"## Discussion\n\n{sentence}\n")
        assert "conclusion_exceeds_results" in codes.get((0, 0), set()), sentence
    for plan in ("Future work will test the model on all three cohorts.", "We will release the code for all users.",
                 "The code will be made available to all researchers.", "This may eventually help every clinic.",
                 "Future studies will extend the evaluation."):
        assert not _codes(f"## Discussion\n\n{plan}\n"), plan


def test_comparative_and_superlative_wording_is_a_claim() -> None:
    for sentence in ("Wearable sensors are more accurate than clinical scales for tremor.",
                     "Ultrasound is the most practical modality for bedside screening."):
        assert "claim_without_evidence" in _codes(f"## Introduction\n\n{sentence}\n")[(0, 0)], sentence
    assert not _codes("## Results\n\nThe left hand was used most often (Fig. 2).\n")


def test_comparison_with_prior_work_needs_a_citation_for_its_number() -> None:
    bare = "## Results\n\nOur F1 exceeds the best results reported in earlier studies by 4 points.\n"
    assert "claim_without_evidence" in _codes(bare)[(0, 0)]
    cited = "## Results\n\nOur F1 exceeds the best results reported in earlier studies {{cite:x}} by 4 points.\n"
    assert not _codes(cited)


def test_reported_result_with_a_citation_in_an_adjacent_sentence_is_supported() -> None:
    for first, second in (
        ("The gradient-boosted model reached a higher AUROC than the logistic baseline on our cohort.",
         "The gain is small and should be confirmed externally {{cite:ext}}."),
        ("Our detector achieved higher sensitivity than the rule-based alarm.", "See Table 3 for all values."),
    ):
        assert not _codes(f"## Discussion\n\n{first} {second}\n"), first
        assert not _codes(f"## Discussion\n\n{second} {first}\n"), first  # the source before the result
    # a bare generic comparison is not a reported result
    assert _codes("## Discussion\n\nDeep models give higher AUROC than logistic baselines. It is fast.\n")


def test_methods_procedures_are_not_claims_but_strong_conclusions_are() -> None:
    methods = "## Methods\n\nMotion artifacts were reduced with an adaptive filter, removing epochs above 100 uV.\n"
    assert not _codes(methods)
    assert "conclusion_exceeds_results" in _codes(
        "## Abstract\n\nOur results establish that the device works reliably for all patients.\n")[(0, 0)]


def test_negated_or_deferred_statements_do_not_meet_a_reporting_item() -> None:
    for sentence, key in (("No power analysis was performed.", "power"),
                          ("Confidence intervals were not computed for any metric.", "statistics"),
                          ("Ethics approval was not sought for this pilot.", "ethics"),
                          ("A power analysis should be added in future work.", "power")):
        assert _status(f"## Methods\n\n{sentence}\n", key) == "missing", sentence
    assert _status("## Methods\n\nAn a priori power analysis set the sample size at 40.\n", "power") == "met"


def test_independence_claim_in_a_result_is_not_a_split_statement() -> None:
    body = ("## Methods\n\nWe trained a classifier on EEG windows.\n\n"
            "## Results\n\nThe subject-independent result was 0.71 accuracy.\n")
    assert _status(body, "subject_wise_split") != "met"
    grouped = body.replace("on EEG windows", "with leave-one-subject-out cross-validation")
    assert _status(grouped, "subject_wise_split") == "met"


def test_scores_on_the_synthetic_drafts_are_pinned() -> None:
    """EEG sample (tuning), ECG and EMG drafts (written before the rule changes, then used for them): 10/10 each and no
    false alarm. A rule change that loses a planted flaw or adds a false alarm fails here."""
    for name, key in DRAFTS:
        r = score(name, key)
        assert (r["detected"], r["rows"], r["false_alarms"]) == (10, 10, 0), (name, r["hits"], r["w3_false_alarms"])
