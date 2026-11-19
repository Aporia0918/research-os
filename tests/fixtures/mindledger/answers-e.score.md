# 讲给我听 point grader on held-out set E (scored once)

Scored 2026-11-19 with `scripts/judge_eval.py tests/fixtures/mindledger/answers-e.json`, after the operation pairs
(减/加, 除/乘) and the step-order check were added and frozen. Set E was committed before those changes. Free grader,
no model, no semantic matcher (no model download reachable where this was run). One attempt = one first round.

| answer kind (20 each) | pass | 待复核 (asked again) | fail |
|---|---|---|---|
| close (should count) | 19 | 1 | 0 |
| paraphrase (should count) | 0 | 18 | 2 |
| fluent but wrong | 6 | 14 | 0 |
| partial | 0 | 0 | 20 |
| off topic | 0 | 0 | 20 |

- Right answers that pass: 19/40. Paraphrases that pass: 0/20 (18/20 asked again).
- Wrong answers that pass: 6/60, worse than set D (3/72, before the fix). Five of the six swap words the turn guard
  has no pair for (更薄/更厚, 更少 for 更多, 第一类/第二类, 交感/副交感, 有/没有 inside one sentence); one says the
  steps backwards with 低频 for 高频 and the order check did not catch it. A word-pair list will always lag new
  wording: wrong answers that copy the reference's words need a model (heavy debts already get one) or a check that
  reads meaning, not more pairs.
- 待复核: 33/100. Knowledge type guessed from the question: 19/20.
- Time per attempt: median 0.10 ms, p95 0.16 ms.

Caveats as for set D: written by the team, by the grader's writer; do not tune on it.
