"""Plan 2.5 performance item: 结论考快速档 (20 null worlds) on small tabular data, target under 2 minutes.

Runs the unchanged engine on two public scikit-learn tables (wine 178 rows, breast_cancer 569 rows) with the honest
script, 20 null worlds, REPEATS times each, and prints the median and P90 wall time with the machine it ran on.

    python scripts/perf/nullworld_fast.py [--repeats 20] [--workers 4] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import runpy
import statistics
from pathlib import Path

RUN = runpy.run_path(str(Path(__file__).resolve().parents[2] / "examples" / "null_world_real" / "run.py"))


def p90(xs: list[float]) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, round(0.9 * (len(s) - 1)))]


def cpu() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=20)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--json")
    a = ap.parse_args()
    out = {"machine": f"{cpu()}, {os.cpu_count()} logical CPUs, {platform.system()} {platform.release()}",
           "python": platform.python_version(), "worlds": 20, "workers": a.workers, "repeats": a.repeats, "tables": {}}
    for name in ("wine", "breast_cancer"):
        secs, rows = [], 0
        for i in range(a.repeats):
            r = RUN["run_case"](name, "A", runs=20, seed=i, workers=a.workers)
            assert not r["errors"], r["errors"]
            secs.append(r["seconds"])
            rows = r["rows"]
        med, top = round(statistics.median(secs), 1), round(p90(secs), 1)
        out["tables"][name] = {"rows": rows, "median_s": med, "p90_s": top, "max_s": max(secs)}
        print(name, out["tables"][name], flush=True)
    print(json.dumps(out, ensure_ascii=False))
    if a.json:
        Path(a.json).write_text(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
