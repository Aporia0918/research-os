"""W3 argument logic rules from the second acceptance sample (tests/fixtures/writing/sample_eeg_*), each with cases in
other wording, positive and negative: contradictions across sections (antonym pairs, English and Chinese), numbers
compared with prior work, certain predictions, every overclaim marker, own results and methods procedures."""

from __future__ import annotations

from researchos.services.writing import logic_check

NS = "writing."


def _contra(body: str) -> list[tuple[int, int, dict[str, int]]]:
    return [(f["paragraph"], f["sentence"], f["related"]) for f in logic_check.analyse(body)["flags"]
            if f["code"] == "writing.contradiction"]


def test_opposite_directions_on_the_same_topic_across_sections() -> None:
    """Same quantity, opposite direction, different sections and wording (antonym pairs in English and Chinese); the
    topic matches by a shared run of content words even when the rest of the sentences differ (sample 2, F3)."""
    first = {"paragraph": 0, "sentence": 0}
    for intro, results in (
        ("Imagining a hand movement causes a strong increase of mu-band power over the contralateral motor cortex.",
         "During imagery, mu-band power over the contralateral motor cortex decreased relative to rest in 17 of 20 "
         "subjects."),
        ("Previous work reports that alpha power over occipital electrodes rises with drowsiness {{cite:a2019}}.",
         "In our recordings, alpha power over occipital electrodes fell as participants became drowsy (n = 12)."),
        ("Sleep deprivation improved working memory accuracy in older adults {{cite:a2019}}.",
         "Working memory accuracy in older adults worsened after sleep deprivation (n = 30)."),
        ("Gene expression of BDNF was up-regulated in hippocampal tissue after exercise {{cite:a2019}}.",
         "Gene expression of BDNF was down-regulated in hippocampal tissue after exercise in our mice."),
        ("Reaction times of the patients went up after the first dose {{cite:a2019}}.",
         "Reaction times of the patients went down after the first dose in this cohort."),
        ("既往研究表明，运动想象时对侧运动皮层的节律功率升高。",
         "本研究中，运动想象时对侧运动皮层的节律功率明显降低。"),
    ):
        assert _contra(f"# Introduction\n\n{intro}\n\n# Results\n\n{results}\n") == [(1, 0, first)], results


def test_no_contradiction_without_opposite_directions_on_one_topic() -> None:
    for intro, results in (
        ("Alpha power increased during rest {{cite:a2019}}.", "Beta power decreased during the task."),
        ("Mu-band power over the motor cortex increased with practice {{cite:a2019}}.",
         "Mu-band power over the motor cortex rose further in the second session."),
        ("Mu-band power did not increase during imagery {{cite:a2019}}.",
         "Mu-band power decreased during imagery in 15 of 18 subjects."),
        ("The electrodes were set up before each session and accuracy improved with training {{cite:a2019}}.",
         "Impedance of the reference electrode fell below 10 kOhm."),
        ("左侧额叶的theta功率升高。", "右侧顶叶的alpha功率降低。"),
        ("Heart rate went up during the stress task {{cite:a2019}}.",
         "Skin conductance went down after the relaxation block."),
    ):
        assert _contra(f"# Introduction\n\n{intro}\n\n# Results\n\n{results}\n") == [], results


def _at(body: str, code: str) -> list[tuple[int, int]]:
    return [(f["paragraph"], f["sentence"]) for f in logic_check.analyse(body)["flags"] if f["code"] == NS + code]



def test_a_number_compared_with_prior_work_needs_a_source() -> None:
    """A number against prior / published / state-of-the-art results is a claim about others' work: our own number
    does not support it, only a citation or evidence does (sample 2, F5)."""
    for text in (
        "The CCN improved accuracy by 12 percentage points over the best prior subject-independent result.",
        "Our model is 8% more accurate than previously published methods.",
        "Compared with earlier studies, our error rate is 30% lower.",
        "Our F1 of 0.91 surpasses the best reported result of 0.85.",
        "With {{metric:run_a/accuracy/test}}, the classifier outperforms existing methods by 5 points.",
        "This exceeds the state-of-the-art accuracy by 0.05.",
    ):
        res = logic_check.analyse(text + "\n")
        f = [x for x in res["flags"] if x["code"] == NS + "claim_without_evidence"]
        assert [(x["sentence"], x.get("reason")) for x in f] == [(0, "number_without_source")], text


def test_a_sourced_or_own_baseline_comparison_is_not_flagged() -> None:
    for body in (
        "The CCN improved accuracy by 12 percentage points over the best prior result {{cite:a2019}}.",
        "The CCN improved accuracy by 6 points over our CSP baseline.",
        "Prior to training, data were filtered at 1 Hz.",
        "Accuracy was 4 points higher than in previous work {{evidence:ev1}}.",
        "Previously published accuracy was 0.70 {{cite:a2019}}, and ours was 12 points higher.",
        "Smith reported an accuracy of 0.70 {{cite:a2019}}. Our accuracy is therefore 5 points above that published "
        "result.",
    ):
        assert _at(body + "\n", "claim_without_evidence") == [], body


def test_overreaching_predictions_exceed_the_results() -> None:
    """Certain predictions about the future (will eliminate / will certainly / all future / never / guaranteed) are
    conclusions no reported result can show (sample 2, F9)."""
    for text in (
        "The results show that the network will eliminate the need for user calibration in all future BCIs.",
        "Clinicians will certainly adopt this approach.",
        "This decoder will never fail on new users.",
        "The method is guaranteed to work on new headsets.",
        "Wearable EEG will definitely replace laboratory systems.",
        "All future studies should adopt this protocol.",
    ):
        assert _at(text + "\n", "conclusion_exceeds_results") == [(0, 0)], text


def test_plain_or_hedged_future_statements_are_not_overclaims() -> None:
    for text in (
        "Future work will extend the evaluation to additional datasets.",
        "We will release the code upon publication.",
        "This approach may eliminate some calibration time in future BCIs.",
        "Participants had never used a BCI before.",
        "The next section will describe the preprocessing.",
        "We expect that clinicians will adopt this approach once it is validated.",
    ):
        assert logic_check.analyse(text + "\n")["flags"] == [], text


def test_every_overclaim_marker_of_a_sentence_is_reported() -> None:
    """One conclusion_exceeds_results flag per sentence, listing every marker in order, not only the first."""
    for text, markers in (
        ("This proves that compact deep networks always generalise across users.", ["proves", "always"]),
        ("Our method universally solves the problem for all datasets.", ["universally", "solves", "all"]),
        ("The approach is clinically ready and will never fail.", ["clinically ready", "will never"]),
        ("The network will eliminate calibration in all future BCIs.", ["will eliminate", "all future"]),
        ("This definitively proves the theory.", ["definitively", "proves"]),
        ("It always outperforms the baseline on every subject, always.", ["always", "every"]),
        ("This proves the point.", ["proves"]),
    ):
        f = [x for x in logic_check.analyse(text + "\n")["flags"] if x["code"] == NS + "conclusion_exceeds_results"]
        assert [(x["quote"], x["markers"]) for x in f] == [(markers[0], markers)], text


def test_own_result_supported_by_the_next_sentence_is_not_a_claim_without_evidence() -> None:
    """"We achieved ..." reports our result; its citation, metric, evidence or table / figure reference may sit in the
    same or the next sentence (sample 2, false alarm P8.0)."""
    for body in (
        "Our compact network achieved higher mean accuracy than the CSP baseline on held-out epochs. The gain is "
        "modest {{cite:a2019}}.",
        "We obtained better F1 scores with the shallow model. Table 2 lists the per-subject values.",
        "Our pipeline reached lower error rates than the baseline (Table 3).",
        "We found that the classifier performed better on session two. Per-session results are shown in Fig. 4.",
        "Our method achieved superior sensitivity. The value was {{metric:run_a/sensitivity/test}}.",
        "We observed improved decoding with longer windows. This is consistent with {{evidence:ev1}}.",
    ):
        assert _at(body + "\n", "claim_without_evidence") == [], body


def test_unsupported_or_general_results_are_still_claims_without_evidence() -> None:
    for body in (
        "Our compact network achieved higher accuracy than the baseline. Future work will extend this.",
        "Our method outperforms deep networks. Table 2 lists the per-subject values.",
        "Deep networks achieved higher accuracy than CSP. See Table 1.",
        "We achieved better decoding than every earlier pipeline.",
        "Our results reveal a robust effect of imagery. We discuss limitations below.",
        "We obtained higher accuracy with ICA. Table quality was not assessed.",
    ):
        assert _at(body + "\n", "claim_without_evidence") == [(0, 0)], body


def test_a_methods_procedure_is_not_a_claim() -> None:
    """In a Methods-like section, "X was reduced / improved with (using, by, via, through) <method>" describes what
    was done (sample 2, false alarm P4.4)."""
    for sentence in (
        "Ocular artifacts were reduced with independent component analysis (ICA), removing components correlated "
        "with frontal channels.",
        "Line noise was reduced using a notch filter.",
        "Spatial resolution was enhanced by a surface Laplacian.",
        "Signal quality was improved through careful electrode preparation.",
        "Contrast was increased via histogram equalisation.",
        "Inter-trial variability was decreased by averaging across trials.",
    ):
        for heading in ("Methods", "2.3 Preprocessing", "Materials and methods"):
            assert logic_check.analyse(f"# {heading}\n\n{sentence}\n")["flags"] == [], (heading, sentence)


def test_claims_in_methods_or_results_are_still_flagged() -> None:
    for body in (
        "# Results\n\nErrors were reduced by the new model compared with the baseline.",
        "# Methods\n\nOur filter clearly improves decoding.",
        "# Methods\n\nICA is known to be effective for ocular artifact removal.",
        "# Methods\n\nArtifacts were removed with ICA, which outperforms other methods.",
        "# Discussion\n\nLine noise was reduced using a notch filter.",
        "# Methods\n\nThe proposed features are superior to band power.",
    ):
        assert _at(body + "\n", "claim_without_evidence") == [(0, 0)], body
