"""问卷选择题：系统对每个选项的判断，和答案键对一遍。以后把真学生选项填进来就能直接打分。
用法：python3 check_key.py [data/questionnaire_d2.jsonl]
"""

import json
import sys
from pathlib import Path

from cfq.attribute import direct, judge, traps
from cfq.perturb import Change, show_point
from cfq.solve import solve
from cfq.text import parse

path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "data/questionnaire_d2.jsonl")
agree = total = 0
for item in map(json.loads, path.read_text().splitlines()):
    orig, var = parse(item["original"]), parse(item["variant"])
    change = Change("point", "趋向点", show_point(orig.point), show_point(var.point))
    answer = solve(var)
    trap_list, _ = traps(solve(orig), var, answer, change, direct(orig) is None)
    print(f"{item['id']}：{item['variant']}")
    for opt, text in item["options"].items():
        kind, why = judge(text, answer, trap_list, var.params)
        want = item["key"].get(opt, "unknown")
        ok = kind == want
        agree, total = agree + ok, total + 1
        print(f"  {opt}. {text:6} 系统：{kind:8} 答案键：{want:8} {'✓' if ok else '✗'}  {why}")
print(f"\n一致 {agree}/{total}")
