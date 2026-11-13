# Answer key for draft.md (synthetic fixture)

Paragraph indices are 0-based as counted by `logic_check.paragraphs` (paragraph/list blocks only; headings not counted):
P0 fixture HTML comment (the parser counts it), P1 Abstract, P2 Intro-1, P3 Intro-2, P4 Methods-1, P5 Methods-2, P6 Results-1, P7 Results-2, P8 Discussion-1 (control), P9 Discussion-2, P10 References line.

| # | Flaw | Location | Expected check |
|---|---|---|---|
| F1 | Claim without evidence: "Deep networks clearly outperform hand-crafted feature pipelines for MI decoding." | P2 | W3 claim_without_evidence |
| F2 | Overclaim: "This proves that compact deep networks always generalise across users." | P1 | W3 conclusion_exceeds_results |
| F3 | Contradiction: Intro "causes a strong increase of mu-band power" vs Results "mu-band power ... decreased" | P3 vs P7 | W3 contradiction |
| F4 | Causal overreach: "Imagining a hand movement causes ..." | P3 | W3 overstrong_causal_wording |
| F5 | Unbacked number: "improved accuracy by 12 percentage points over the best prior subject-independent result" (no citation, contradicts 0.06 gain) | P6 | W3 claim_without_evidence (W2 free_number gate not run here) |
| F6 | Missing subject-wise split / leakage: epochs pooled across subjects, global z-scoring, random epoch split, tuning on test set; yet title/Abstract say "subject-independent" | P5 | W5 subject_wise_split = missing, leakage = missing |
| F7 | No power / sample-size justification | whole doc | W5 power = missing |
| F8 | Negation: "No power analysis was performed." must NOT count as power reported | P5 | W5 power must stay missing (known false-met risk) |
| F9 | Future overclaim: "will eliminate the need for user calibration in all future BCIs" / "will certainly adopt" | P9 | W3 conclusion_exceeds_results |
| C  | Control paragraph, correctly hedged and cited | P8 | no W3 flag expected |

Also missing on purpose (bonus W5): data availability statement, ethics statement.
