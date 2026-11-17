"""W3 / W5 rules of round 3 (failure classes of blind test 1 in the WritingAssist acceptance notes). The blind draft is
retired as evidence: every case here is written fresh, in other domains and wording (retinal imaging, sepsis, gait,
speech, histopathology, clinical text ...), positive and negative."""

from __future__ import annotations

from typing import Any

from researchos.services.writing import logic_check

NS = "writing."


def _numeric(body: str) -> list[dict[str, Any]]:
    return [f for f in logic_check.analyse(body)["flags"]
            if f["code"] == NS + "contradiction" and f.get("reason") == "numeric_mismatch"]


def _two_sections(first: str, second: str, h1: str = "Abstract", h2: str = "Results") -> str:
    return f"# {h1}\n\n{first}\n\n# {h2}\n\n{second}\n"


def test_the_same_quantity_with_different_values_in_two_sections_is_a_contradiction() -> None:
    """Same metric, same subject, different value beyond rounding, in two sections (blind test 1, F3 class)."""
    for first, second, metric in (
        ("The retinal classifier reached a sensitivity of 91.3% for referable retinopathy.",
         "Sensitivity for referable retinopathy was 87.9% (95% CI 85.0-90.4).", "sensitivity"),
        ("The sepsis model achieved an AUROC of 0.89 in the emergency department cohort.",
         "In the emergency department cohort, the area under the ROC curve was 0.84.", "auc"),
        ("Gait speed differed between fallers and non-fallers (p = 0.012).",
         "Gait speed of fallers and non-fallers differed (p = 0.21, Mann-Whitney U).", "p"),
        ("We analysed voice recordings from 214 participants.",
         "Voice recordings of n = 198 participants entered the analysis.", "n"),
        ("Mean age of the histopathology cohort was 63.4 years.",
         "The mean age in the histopathology cohort was 58.2 years.", "mean age"),
        ("Our speech-based screening tool detected mild cognitive impairment with 0.82 accuracy.",
         "Accuracy of the screening tool for mild cognitive impairment was 76.5%.", "accuracy"),
        ("The segmentation network obtained a Dice score of 0.91 on liver lesions.",
         "On liver lesions, the segmentation network had a Dice coefficient of 0.86.", "dice"),
    ):
        f = _numeric(_two_sections(first, second))
        assert [(x["paragraph"], x["sentence"], x["related"], x["metric"]) for x in f] == \
            [(1, 0, {"paragraph": 0, "sentence": 0}, metric)], (first, second)


def test_the_headline_value_of_each_section_is_compared_even_without_shared_words() -> None:
    """A metric reported once in the Abstract and once in the Results names the same headline quantity."""
    body = _two_sections("Our transformer classified radiology reports with a specificity of 94.0%.",
                         "Specificity was 89.5% (Table 2).")
    assert [(x["paragraph"], x["sentence"]) for x in _numeric(body)] == [(1, 0)]


def test_rounding_other_subjects_or_other_metrics_are_not_numeric_contradictions() -> None:
    for first, second in (
        ("The retinal classifier reached a sensitivity of 87.9% for referable retinopathy.",
         "Sensitivity for referable retinopathy was 88% (95% CI 85-90)."),  # rounding
        ("Our speech-based screening tool reached 0.78 accuracy.", "Accuracy of the screening tool was 78.0%."),
        ("The CNN reached an accuracy of 0.91 on the slides.", "The SVM reached an accuracy of 0.85 on the slides."),
        ("Validation accuracy of the sepsis model was 0.93.", "Test accuracy of the sepsis model was 0.88."),
        ("Sensitivity of the sepsis model was 0.90.", "Specificity of the sepsis model was 0.80."),
        ("Overall sensitivity for referable retinopathy was 92%.",
         "In women, sensitivity for referable retinopathy was 85%."),
        ("The AUROC of the sepsis model was 0.89 six hours before onset.",
         "The AUROC of the sepsis model was 0.81 at 12 hours before onset, and 0.89 at 6 hours."),
        ("Gait speed differed between fallers and non-fallers (p < 0.05).",
         "Gait speed of fallers and non-fallers differed (p = 0.03)."),  # an inequality is not a value
        ("Sensitivity and specificity of the classifier were 91% and 84%, respectively.",
         "Specificity of the classifier was 91%."),  # a "respectively" list is not bound
        ("The triage model improved accuracy by 9 percentage points.",
         "Accuracy of the triage model was 0.81."),  # a change, not the level
    ):
        assert _numeric(_two_sections(first, second)) == [], (first, second)


def test_values_in_the_same_section_are_not_compared() -> None:
    body = ("# Results\n\nAccuracy of the decoder was 0.88 with all features.\n\n"
            "Accuracy of the decoder was 0.81 when spectral features were removed.\n")
    assert _numeric(body) == []


def test_numeric_contradiction_cost_is_bounded() -> None:
    import time
    body = "# Abstract\n\n" + " ".join(f"Accuracy of model {i} was 0.{i % 90 + 10}." for i in range(3000)) + \
        "\n\n# Results\n\n" + " ".join(f"Accuracy of model {i} was 0.{(i + 1) % 90 + 10}." for i in range(3000)) + "\n"
    t = time.perf_counter()
    logic_check.analyse(body)
    assert time.perf_counter() - t < 5


def _superiority(body: str) -> list[tuple[int, int]]:
    return [(f["paragraph"], f["sentence"]) for f in logic_check.analyse(body)["flags"]
            if f["code"] == NS + "conclusion_exceeds_results" and f.get("reason") == "superiority_without_statistics"]


METHODS = "# Methods\n\nWe compared the models on a held-out set.\n\n# Results\n\n"


def test_superiority_without_any_statistic_in_the_draft_exceeds_the_results() -> None:
    """"Outperformed / superior / significantly better" when the draft names no test, CI or p-value anywhere and no
    sample size near the claim (blind test 1, F7 class)."""
    for sentence in (
        "The proposed gait classifier outperformed the threshold-based detector.",
        "Our retinal model was superior to two human graders.",
        "The attention model achieved significantly better recall than the LSTM (0.84 vs 0.79).",
        "On the sepsis cohort, XGBoost beat logistic regression with an AUROC of 0.86 versus 0.81.",
        "The speech model performs better than clinicians at detecting early dysarthria.",
        "Our segmentation network clearly surpasses U-Net on small lesions (Dice 0.78 vs 0.71).",
    ):
        assert _superiority(METHODS + sentence + "\n") == [(1, 0)], sentence


def test_superiority_with_a_statistic_sample_size_hedge_or_citation_is_not_flagged() -> None:
    for body in (
        METHODS + "The proposed gait classifier outperformed the threshold-based detector.\n\n"
        "# Statistics\n\nAUROCs were compared with the DeLong test.\n",
        METHODS + "Our retinal model was superior to two human graders.\n\nAccuracy was 0.91 (95% CI 0.88-0.93).\n",
        METHODS + "The attention model may outperform the LSTM on longer notes.\n",
        "# Introduction\n\nTransformers outperform recurrent networks on clinical text {{cite:a2020}}.\n",
        METHODS + "In 340 patients, the triage score outperformed the clinical judgement of nurses.\n",
        METHODS + "The model performed similarly to the baseline.\n",
        METHODS + "Recall was higher in the second session than in the first.\n",
        "# Related work\n\nGraph networks outperform convolutional networks on molecular data.\n",  # about others
        "Model B performed better than model A.\n",  # no section: not a manuscript whose statistics we can judge
    ):
        assert _superiority(body) == [], body


def test_background_facts_in_the_introduction_are_not_claims_without_evidence() -> None:
    """Generic background ("X is common and associated with Y", "monitoring is needed to detect ...", "is essential
    because ...") is not flagged in an Introduction / Background section (blind test 1 false-alarm class)."""
    for heading in ("Introduction", "1. Background"):
        for sentence in (
            "Obstructive sleep apnoea is common and associated with hypertension.",
            "Continuous glucose monitoring is needed to detect nocturnal hypoglycaemia.",
            "Accurate staging of liver fibrosis is essential because treatment decisions depend on it.",
            "Falls are frequent in older adults and are associated with loss of independence.",
            "Long-term monitoring of gait is required to detect gradual decline.",
            "Low heart rate variability is correlated with poor prognosis after myocardial infarction.",
            "Speech changes are an early sign of Parkinson's disease and are well known to neurologists.",
            "The prevalence of type 2 diabetes is increasing in young adults.",
        ):
            assert logic_check.analyse(f"# {heading}\n\n{sentence}\n")["flags"] == [], (heading, sentence)


def test_strong_comparative_superlative_or_prior_work_number_in_the_introduction_is_still_flagged() -> None:
    for sentence, reason in (
        ("Transfer learning is the most effective strategy for small histology datasets.", None),
        ("Gradient boosting is the best model for tabular clinical data.", None),
        ("Deep models outperform radiologists in detecting pneumothorax.", None),
        ("Retinal screening is more effective than opportunistic examination.", None),
        ("Sleep apnoea is strongly associated with stroke and is the leading cause of daytime sleepiness.", None),
        ("Previously published detectors reach only 70% sensitivity, below what screening requires.",
         "number_without_source"),
        ("Remote monitoring is associated with fewer readmissions than usual care.", None),
    ):
        f = [x for x in logic_check.analyse(f"# Introduction\n\n{sentence}\n")["flags"]
             if x["code"] == NS + "claim_without_evidence"]
        assert [(x["sentence"], x.get("reason")) for x in f] == [(0, reason)], sentence


def test_a_selection_by_the_best_value_in_methods_is_not_a_claim() -> None:
    for sentence in ("The checkpoint with the best validation loss was kept.",
                     "We kept the most important 20 features by mutual information on the training folds."):
        assert logic_check.analyse(f"# Methods\n\n{sentence}\n")["flags"] == [], sentence


def test_background_wording_outside_the_introduction_is_unchanged() -> None:
    for body in ("# Discussion\n\nLong-term monitoring is essential for these patients.\n",
                 "# Conclusion\n\nThe marker is associated with poor outcome.\n"):
        assert _at(body, "claim_without_evidence") == [(0, 0)], body


def _at(body: str, code: str) -> list[tuple[int, int]]:
    return [(f["paragraph"], f["sentence"]) for f in logic_check.analyse(body)["flags"] if f["code"] == NS + code]


def _selective(body: str) -> list[tuple[int, int]]:
    return [(f["paragraph"], f["sentence"]) for f in logic_check.analyse(body)["flags"]
            if f["code"] == NS + "conclusion_exceeds_results" and f.get("reason") == "selective_reporting"]


def test_results_of_one_selected_run_without_the_number_of_runs_exceed_the_results() -> None:
    """Results of one seed / the best run / the most favourable split, and the draft never says how many runs there
    were (blind test 1, F10 class)."""
    for sentence in (
        "All results below correspond to random seed 7.",
        "We report the best run of our experiments.",
        "Scores in this section are from the best-performing seed.",
        "For brevity, only the single best training run is presented.",
        "The reported F1 corresponds to the most favourable data split.",
        "Numbers in Table 3 were obtained with seed 42.",
    ):
        body = "# Methods\n\nWe trained a U-Net on knee MRI.\n\n# Results\n\n" + sentence + "\n"
        assert _selective(body) == [(1, 0)], sentence


def test_selection_on_validation_data_or_with_the_number_of_runs_is_not_selective_reporting() -> None:
    runs = "Each configuration was trained with five random seeds; we report the mean and standard deviation.\n\n"
    for body in (
        "# Methods\n\n" + runs + "# Results\n\nAll results below correspond to random seed 7.\n",
        "# Methods\n\nThe checkpoint with the best validation loss was used for testing.\n",
        "# Methods\n\nThe best configuration on the validation folds was evaluated once on the test set.\n",
        "# Methods\n\nWe fixed the random seed to 0 for reproducibility.\n",
        "# Results\n\nResults averaged over 10 runs are shown in Table 2, and the best run in Fig. 3.\n",
        "# Introduction\n\nThe best model in the literature reached 0.90 accuracy {{cite:a2020}}.\n",
    ):
        assert _selective(body) == [], body
