# Answer key for heldout_ecg_draft.md (synthetic held-out fixture)

Written by the ResearchOS developers (not an independent annotator) on 2026-11-13, committed BEFORE any rule change of
the ported W3/W5 checker. Topic, wording and sentence structure differ from the EEG sample, the flaw kinds are the same.
Locations are given by a quote of the sentence; `tests/writing_eval.py` holds the same key in machine-readable form.

| # | Flaw | Sentence (quote) | Expected check |
|---|---|---|---|
| H1 | Claim without evidence (comparison with clinicians, no citation) | "Convolutional networks are more reliable than cardiologists ..." | W3 claim_without_evidence |
| H2 | Overclaim from one dataset | "These findings demonstrate that the network universally detects arrhythmias in any patient population." | W3 conclusion_exceeds_results |
| H3 | Contradiction: Results "Sensitivity ... dropped ... when the input window was shortened" vs Discussion "Shortening the input window ... raised the sensitivity" | Results P6 / Discussion P9 | W3 contradiction (on the later sentence) |
| H4 | Causal overreach from observational literature | "Reduced heart rate variability leads to ventricular ectopy after myocardial infarction." | W3 overstrong_causal_wording |
| H5 | Comparative number vs prior work without citation | "This is 9 percentage points higher than previously published patient-independent methods." | W3 claim_without_evidence |
| H6a | Beats of all patients pooled and randomly split, yet title and Results say "patient-independent" | Methods P5 | W5 subject_wise_split not met (missing or problem) |
| H6b | Leakage: standardisation on the entire dataset; hyperparameters selected on the test beats | Methods P5 | W5 leakage not met (missing or problem) |
| H7 | No sample-size / power justification anywhere | whole draft | W5 power not met |
| H8 | Negation: "Confidence intervals were not computed for any metric." must NOT count as statistics reported | Methods P5 | W5 statistics not met |
| H9 | Future overclaims: "Hospitals will soon deploy this network for every Holter recording." and "Cardiologists will no longer need to over-read ambulatory ECGs." | Discussion P9 | W3 conclusion_exceeds_results on both sentences |

Clean control paragraphs (no W3 flag expected): Results P7 ("Ventricular ectopic beats were most often confused ...")
and Discussion P8 ("Our network achieved a higher macro F1-score than the RR-interval baseline ..." with the citation in
the next sentence, hedged). "Future work will validate the network on the INCART database." is a plain plan, no flag.

W5 items the draft does state (a "not met" result counts as a false alarm): sample_size ("from 47 patients"),
ethics ("approved by the institutional ethics committee").

Scoring: a W3 row counts when every listed sentence carries the expected code; a W5 row counts when the item is not
`met`. W3 false alarms = sentences outside all planted rows that carry any W3 flag; W5 false alarms = stated items not
`met`.
