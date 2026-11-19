# 讲给我听 point grader on held-out set D (scored once)

Scored 2026-11-19 with `scripts/judge_eval.py tests/fixtures/mindledger/answers-d.json`, after the grader in
`services/mindledger/explain.py` was frozen (LOOSE_POINT set on the phone's dev set A only). Free grader, no model,
no semantic matcher (the reranker could not be downloaded where this was run). One attempt = one first round.

| answer kind (24 each) | pass | 待复核 (asked again) | fail |
|---|---|---|---|
| close (should count) | 22 | 2 | 0 |
| paraphrase (should count) | 0 | 21 | 3 |
| fluent but wrong | 3 | 19 | 2 |
| partial | 0 | 0 | 24 |
| off topic | 0 | 0 | 24 |

- Right answers that pass: 22/48. Paraphrases that pass: 0/24 (21/24 are asked again instead of failed).
- Wrong answers that pass: 3/72. All three are method questions with steps swapped or changed (K-fold with the train
  and validation shares swapped, variance with "sum of differences ÷ (n+1)", z-score with max/min); the turn guard has
  no word pairs for steps.
- 待复核: 42/120. Knowledge type guessed from the question: 24/24.
- Time per attempt: median 0.11 ms, p95 0.19 ms (laptop-class CPU, cloud container).

Caveats: the answers were written by the team, not students, by the same writer who wrote the grader, and the type
cues were written knowing the four question styles, so 24/24 says little. Do not tune on this set; write a new one.
