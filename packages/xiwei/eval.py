"""在冻结题集上跑一遍：读题、核对答案、出变式、四道门控，再用模拟错答检验错答反推（补充方案 1.7 的四个指标）。

模拟错答：变式的每条前提消融答案当成「漏看了这个前提」的学生答案，错因库答案当成「不是漏看条件」的答案。
用法：python eval.py [题集.jsonl ...] [--json 输出.json]
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

from xiwei.diagnose import diagnose, errors
from xiwei.engine import generate
from xiwei.grade import parse_answer, same
from xiwei.read import read
from xiwei.solve import IllDefined, as_answer, solve

DATA = Path(__file__).parent / "data"


def given(p, text: str):
    """题目自带的答案可以含参数（如 1/(2a)），先代入参数取值。"""
    try:
        return as_answer(p.value(text))
    except Exception:
        return parse_answer(text, p.kind)


def run(path: Path) -> dict:
    n = read_ok = solved = agree = made = 0
    located = review = wrong = slips = slip_as_miss = 0
    times: list[float] = []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        n += 1
        row = {"id": item["id"]}
        t0 = time.perf_counter()
        try:
            p, _ = read(item["text"])
            read_ok += 1
            truth = solve(p)
            solved += 1
            ok = same(given(p, item["given"]), truth)
            agree += ok
            v = generate(p).variant
        except (ValueError, IllDefined) as e:
            rows.append({**row, "error": str(e)})
            continue
        times.append(time.perf_counter() - t0)
        row.update(agree=ok, variant=None)
        if v is not None:
            made += 1
            row["variant"] = {"change": f"{v.change.slot}={v.change.new}", "answer": v.answer.text(), "readings": len(v.misses)}
            for m in v.misses:  # 漏看前提 m.slot 的学生会答 m.answer
                d = diagnose(v.problem, p, m.answer)
                if d["verdict"] == "missed":
                    located += d["slots"] == [m.slot]
                    wrong += d["slots"] != [m.slot]
                else:
                    review += d["verdict"] == "review"
            for _, a in errors(v.problem, v.answer):
                slips += 1
                slip_as_miss += diagnose(v.problem, p, a)["verdict"] == "missed"
        rows.append(row)
    sims = sum(r["variant"]["readings"] for r in rows if r.get("variant"))
    times.sort()
    return {"set": path.name, "questions": n, "read": read_ok, "solved": solved, "answer_agrees": agree, "variants": made,
            "simulated_misses": sims, "located": located, "review": review, "mislocated": wrong,
            "library_errors": slips, "library_errors_judged_missed": slip_as_miss,
            "median_seconds": round(times[len(times) // 2], 3) if times else None,
            "max_seconds": round(times[-1], 3) if times else None, "rows": rows}


def main(argv: list[str]) -> None:
    logging.disable(logging.WARNING)
    out = argv[argv.index("--json") + 1] if "--json" in argv else None
    paths = [Path(a) for a in argv if a.endswith(".jsonl")] or sorted(DATA.glob("*.jsonl"))
    results = [run(p) for p in paths]
    for r in results:
        print(f"{r['set']}: 题 {r['questions']}，读出 {r['read']}，答案一致 {r['answer_agrees']}，出变式 {r['variants']}；"
              f"模拟漏看 {r['simulated_misses']} 条：定位正确 {r['located']}、待复核 {r['review']}、定位错 {r['mislocated']}；"
              f"错因库答案 {r['library_errors']} 条，误判为漏看 {r['library_errors_judged_missed']}；"
              f"单题耗时中位 {r['median_seconds']}s，最长 {r['max_seconds']}s")
        for row in r["rows"]:
            if row.get("error") or not row.get("agree") or not row.get("variant"):
                print("   ", row)
    if out:
        Path(out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
