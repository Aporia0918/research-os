"""思维账本 model cost per user per month, measured where we can and assumed where we must (both printed).

Measured: on tests/fixtures/mindledger/repayments.json, how many repayments the free grader settles alone (compute
follows the debt, judge.needs_model) and the prompt size of each model grading call. Assumed (named constants
below): usage per month, the debt mix, the retry rate, the record call's size, chars-to-tokens and the FX rate.
No network, no model calls. Run: PYTHONPATH=services/api python scripts/ledger_cost.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from researchos.services.mindledger import judge, rules

FIXTURE = Path(__file__).parents[1] / "tests/fixtures/mindledger/repayments.json"
# Prices: OpenRouter /api/v1/models, read 2026-11-13, USD per million tokens (input, output).
PRICES = {"deepseek/deepseek-v4.1-flash-1017": (0.15, 0.60), "deepseek/deepseek-v4.1-flash-1017:batch": (0.05, 0.15)}
USD_CNY = 7.1  # assumed, round figure
CN_TOKENS_PER_CHAR, OTHER_TOKENS_PER_CHAR = 0.6, 0.3  # DeepSeek's published rule of thumb
GRADE_OUTPUT_CHARS = 160  # the JSON reply: 2-6 short points and hit indexes
RECORD_IN_CHARS, RECORD_OUT_CHARS = 1500, 300  # assumed: split one AI answer into 1-3 knowledge points + key points
MIX = {"light": 0.40, "medium": 0.35, "heavy": 0.25}  # assumed share of debts by weight
RETRY = 0.30  # assumed: share of repayments that fail once and come back the next day
PERSONAS = {"本科生（学习为主）": 5 * 22, "研究生（科研为主）": 8 * 22, "重度用户": 20 * 30}  # debts per month


def tokens(text: str) -> float:
    cn = len(re.findall(r"[一-鿿]", text))
    return cn * CN_TOKENS_PER_CHAR + (len(text) - cn) * OTHER_TOKENS_PER_CHAR


def usd(tin: float, tout: float, model: str) -> float:
    pin, pout = PRICES[model]
    return (tin * pin + tout * pout) / 1e6


def main() -> None:
    cases = json.loads(FIXTURE.read_text("utf-8"))["cases"]
    frees = [(c, judge.grade_deterministic(c["ref"], c["attempt"])) for c in cases]
    unsure = sum(judge.needs_model("medium", g, c["attempt"]) for c, g in frees) / len(cases)
    settled = [(c, g) for c, g in frees if not judge.needs_model("medium", g, c["attempt"])]
    agree = sum(g.passed == c["human"] for c, g in settled)
    grade_in = sum(tokens("".join(judge.GRADE_REPAYMENT.render(question="", reference=c["ref"], attempt=c["attempt"])))
                   for c in cases) / len(cases)
    grade_usd = usd(grade_in, tokens("x" * GRADE_OUTPUT_CHARS), "deepseek/deepseek-v4.1-flash-1017")
    model_share = {w: 1.0 if w == "heavy" else unsure for w in MIX}
    repays = {w: len(rules.STEPS[w]) * (1 + RETRY) for w in MIX}
    calls_new = sum(MIX[w] * repays[w] * model_share[w] for w in MIX)
    calls_all = sum(MIX[w] * repays[w] for w in MIX)
    rec_tin, rec_tout = RECORD_IN_CHARS * CN_TOKENS_PER_CHAR, RECORD_OUT_CHARS * CN_TOKENS_PER_CHAR
    record = {m: usd(rec_tin, rec_tout, m) for m in PRICES}

    print(f"Sample: {len(cases)} hand-written repayments. Free grader settles {len(settled)} alone "
          f"({1 - unsure:.0%}); it agrees with the human label on {agree}/{len(settled)} of those.")
    print(f"One grading call: about {grade_in:.0f} input tokens, ${grade_usd * 1e6:.0f} per million calls.")
    print(f"Model grading calls per debt: {calls_new:.2f} with compute-follows-debt, {calls_all:.2f} if every "
          f"repayment called the model ({1 - calls_new / calls_all:.0%} fewer).")
    for name, n in PERSONAS.items():
        for label, rec in (("record now", record[next(iter(PRICES))]), ("record in batch", record[list(PRICES)[1]])):
            month = n * (rec + calls_new * grade_usd)
            print(f"{name}: {n} debts/month, {label}: ${month:.3f} ≈ ¥{month * USD_CNY:.2f}")


if __name__ == "__main__":
    main()
