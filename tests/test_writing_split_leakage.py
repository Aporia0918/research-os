"""W5 split and leakage checks for every data type (round 3, failure class of blind test 1, F6): the subject-wise split
and leakage items apply to any draft that evaluates a model (imaging, tabular, text, audio, wearables ...), not only
EEG, and a sentence that describes a leaking design is reported as a problem: sub-subject units (windows, patches,
slices, visits, sentences ...) pooled and randomly split; normalisation / feature selection / oversampling fitted on all
data before the split; tuning on the test set; a patient- / subject- / site-independent claim with a random split. A
grouped split ("split by patient") passes. Every case is written fresh (the blind draft is retired as evidence)."""

from __future__ import annotations

from typing import Any

from researchos.services.writing import logic_check, reporting_checklist

INTRO = "# Methods\n\nWe trained a gradient-boosted classifier and evaluated it on a held-out test set.\n\n"


def _items(body: str) -> dict[str, dict[str, Any]]:
    paras = logic_check.paragraphs(body)
    return {i["key"]: i for i in reporting_checklist.evaluate(paras)["items"]}


def _problems(body: str, key: str) -> list[str]:
    return [p["code"].removeprefix("writing.rc.problem.") for p in _items(body)[key]["problems"]]


def test_split_and_leakage_items_apply_to_any_model_evaluation() -> None:
    for text in ("A convolutional network was trained on chest radiographs and tested on a held-out set.",
                 "We fitted a logistic regression model with five-fold cross-validation on the registry data.",
                 "A transformer classifier was fine-tuned on clinical notes."):
        paras = logic_check.paragraphs(text + "\n")
        res = reporting_checklist.evaluate(paras)
        assert res["profiles"]["evaluation"]["applies"], text
        it = {i["key"]: i for i in res["items"]}
        assert it["subject_wise_split"]["status"] == "missing" and it["leakage"]["status"] == "missing", text
    paras = logic_check.paragraphs("Participants completed a questionnaire about sleep quality.\n")
    it = {i["key"]: i for i in reporting_checklist.evaluate(paras)["items"]}
    assert it["subject_wise_split"]["status"] == "not_applicable"


def test_sub_subject_units_pooled_and_randomly_split_are_a_problem() -> None:
    for sentence in (
        "All 30-second windows from the 52 wrist recordings were pooled and randomly divided into 80% training and "
        "20% test windows.",
        "Patches extracted from all whole-slide images were shuffled and split 70/15/15 into training, validation "
        "and test sets.",
        "Slices from every MRI volume were randomly assigned to the training or the test set.",
        "Sentences from all discharge summaries were pooled and randomly split into training and test sets.",
        "All hospital visits of the cohort were randomly split into training (80%) and test (20%) data.",
        "Speech frames from all speakers were randomly partitioned into five cross-validation folds.",
    ):
        body = INTRO + sentence + "\n"
        assert _problems(body, "subject_wise_split") == ["random_split_of_segments"], sentence
        assert _items(body)["subject_wise_split"]["status"] == "problem", sentence


def test_preprocessing_fitted_on_all_data_or_tuning_on_test_data_is_leakage() -> None:
    for sentence, kind in (
        ("Features were standardised using the mean and standard deviation of the whole dataset before splitting.",
         "fit_before_split"),
        ("Feature selection with LASSO was performed on all 1,200 patients prior to cross-validation.",
         "fit_before_split"),
        ("Intensities were min-max normalised over the entire cohort, and the data were then split into folds.",
         "fit_before_split"),
        ("SMOTE oversampling was applied to the full dataset before the train-test split.", "fit_before_split"),
        ("Principal component analysis was fitted on all samples and the first 20 components were kept.",
         "fit_before_split"),
        ("The TF-IDF vocabulary was built from the complete corpus before dividing it into training and test "
         "documents.", "fit_before_split"),
        ("The learning rate and depth were tuned on the test set.", "test_set_tuning"),
    ):
        body = INTRO + sentence + "\n"
        assert _problems(body, "leakage") == [kind], sentence
        assert _items(body)["leakage"]["status"] == "problem", sentence


def test_an_independence_claim_with_a_random_split_is_a_problem() -> None:
    for claim in (
        "The detector generalises to unseen patients.",
        "We report patient-independent performance.",
        "This is the first site-independent evaluation of lesion segmentation.",
        "Our subject-independent results support deployment in new users.",
        "Cross-patient accuracy reached 0.87.",
        "Inter-patient classification was evaluated on the test set.",
    ):
        body = INTRO + "Images were randomly split into training and test sets.\n\n# Results\n\n" + claim + "\n"
        assert "independence_claim_with_random_split" in _problems(body, "subject_wise_split"), claim


def test_a_grouped_split_or_fold_internal_preprocessing_passes() -> None:
    for sentence in (
        "Windows were split by patient, so no patient contributed to both training and test sets.",
        "Patients were randomly divided into training (70%) and test (30%) groups, and all slices of a patient "
        "stayed in one group.",
        "We used GroupKFold with the patient identifier as the group.",
        "Data were split at the hospital level: two sites for training and one site for testing.",
        "We used leave-one-speaker-out cross-validation.",
        "Records were partitioned with a patient-wise split into five folds.",
    ):
        for claim in ("", "\n\n# Results\n\nWe report patient-independent and site-independent performance.\n"):
            body = INTRO + sentence + "\n" + claim
            it = _items(body)
            assert it["subject_wise_split"]["status"] == "met" and it["subject_wise_split"]["problems"] == [], \
                (sentence, claim)
    for sentence in (
        "Normalisation parameters were estimated on the training fold only and applied to the test fold.",
        "Feature selection was nested within each training fold.",
        "Participants were randomly assigned to the intervention or control arm.",
        "Images were acquired from all patients in random order.",
        "Normalisation was not fitted on the whole dataset.",
        "Hyperparameters were tuned on the validation set, and the test set was used once.",
    ):
        body = INTRO + sentence + "\n"
        it = _items(body)
        assert it["leakage"]["problems"] == [] and it["subject_wise_split"]["problems"] == [], sentence
        assert it["leakage"]["status"] != "problem" and it["subject_wise_split"]["status"] != "problem", sentence


def test_a_random_split_inside_the_training_patients_after_a_grouped_split_passes() -> None:
    body = INTRO + ("Recordings were split by patient into training and test sets. Within the training patients, "
                    "windows were randomly split into training and validation subsets.\n")
    it = _items(body)
    assert it["subject_wise_split"]["status"] == "met" and it["subject_wise_split"]["problems"] == []
