"""Score the 讲给我听 point grader (services/mindledger/explain.py) on a labelled answer set. No network, no model.

Each item is a reference answer and attempts labelled ok (should count) or no (wrong, partial or off topic), with
a kind (close, paraphrase, fluent-wrong, partial, off-topic). One attempt is one first round: pass, unsure (待复核,
asked again) or fail. Reported: pass rate of ok attempts and of paraphrases, wrong-pass rate (no attempts that
pass), unsure rate, the knowledge-type guess against the set's type (when it has one) and time per attempt.

Sets: the phone's dev set A (apps/mobile/tests/fixtures/judge/answers.json, tune here only) and the held-out set D
(tests/fixtures/mindledger/answers-d.json, score once with the grader frozen). --semantic adds the local reranker
(semantic.py, needs fastembed and the model downloaded); without it the run stops rather than pretend.

Run: PYTHONPATH=services/api python scripts/judge_eval.py tests/fixtures/mindledger/answers-d.json [--semantic]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

from researchos.services.mindledger import explain, semantic


def score(items: list[dict], match: explain.Matcher | None) -> dict:
    seen: Counter[tuple[str, str]] = Counter()  # (label or kind, outcome)
    ms, typed = [], []
    for it in items:
        points = [p.text for p in explain.points_of(it["q"], it["ref"])]
        if "type" in it:
            typed.append(explain.type_of(it["q"]) == it["type"])
        for a in it["attempts"]:
            t0 = time.perf_counter()
            got = explain.outcome(explain.judge_points(points, a["text"], match))
            ms.append((time.perf_counter() - t0) * 1000)
            seen[(a["label"], got)] += 1
            seen[(a["kind"], got)] += 1

    def rate(key: str, got: str) -> str:
        n = sum(v for (k, _), v in seen.items() if k == key)
        return f"{seen[(key, got)]}/{n}"

    n_all = sum(v for (k, _), v in seen.items() if k in ("ok", "no"))
    return {
        "ok_pass": rate("ok", "pass"), "paraphrase_pass": rate("paraphrase", "pass"),
        "wrong_pass": rate("no", "pass"), "fluent_wrong_pass": rate("fluent-wrong", "pass"),
        "unsure": f"{seen[('ok', 'unsure')] + seen[('no', 'unsure')]}/{n_all}",
        "paraphrase_unsure": rate("paraphrase", "unsure"),
        "type_right": f"{sum(typed)}/{len(typed)}" if typed else None,
        "ms_median": round(statistics.median(ms), 2), "ms_p95": round(sorted(ms)[int(len(ms) * 0.95) - 1], 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("set", type=Path)
    ap.add_argument("--semantic", action="store_true", help="add the local reranker (fastembed)")
    args = ap.parse_args()
    match = None
    if args.semantic:
        match = semantic.matcher()
        if match is None:
            print(f"semantic matcher unavailable: {semantic.why_not()}", file=sys.stderr)
            return 2
    items = json.loads(args.set.read_text("utf-8"))["items"]
    print(json.dumps({"set": args.set.name, "semantic": args.semantic, **score(items, match)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
