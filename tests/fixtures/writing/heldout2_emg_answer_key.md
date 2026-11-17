# Answer key for heldout2_emg_draft.md (synthetic held-out fixture 2)

Written by the ResearchOS developers (not independent) on 2026-11-13, after the unchanged checker was scored on the
ECG draft and BEFORE any rule change. Machine-readable copy: `tests/writing_eval.py` (`HELDOUT2`).

| # | Flaw | Sentence (quote) | Expected check |
|---|---|---|---|
| G1 | Claim without evidence | "Surface EMG is the most practical input modality for prosthetic control." | W3 claim_without_evidence |
| G2 | Overclaim beyond the sample (able-bodied -> all amputees) | "Our results establish that the classifier works reliably for all amputees." | W3 conclusion_exceeds_results |
| G3 | Contradiction: Results "Accuracy fell when the electrodes were shifted by 1 cm" vs Discussion "Shifting the electrodes by 1 cm ... increased accuracy" | Results / Discussion | W3 contradiction (later sentence) |
| G4 | Causal overreach | "Muscle fatigue drives the drift in EMG amplitude over a session." | W3 overstrong_causal_wording |
| G5 | Comparative number vs prior work without citation | "Our accuracy exceeds the best results reported in earlier studies by 6%." | W3 claim_without_evidence |
| G6a | Windows of all participants shuffled into folds, title says "participant-independent" | Methods | W5 subject_wise_split not met |
| G6b | Feature selection on the full dataset before cross-validation | Methods | W5 leakage not met |
| G7 | No power / sample-size justification | whole draft | W5 power not met |
| G8 | Negation: "Ethics approval was not sought for this pilot." must not count as ethics approval | Methods | W5 ethics not met |
| G9 | Future overclaims: "Amputees will never again need ..." and "... will become the standard controller in all commercial prostheses." | Discussion | W3 conclusion_exceeds_results on both |

Clean control paragraphs (no W3 flag expected): Results paragraph 2 ("Wrist flexion and extension were recognised ...")
and Discussion paragraph 1 ("The random forest reached a higher mean accuracy than the LDA baseline ...").
Stated W5 items (not met = false alarm): sample_size ("n = 10"). Scoring as for the ECG draft.
