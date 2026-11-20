"""命令行试用：
python3 -m cfq "求极限 lim(x→3) (x^2-9)/(x-3)" 6
python3 -m cfq "求极限 lim(x→3) (x^2-9)/(x-3)" 6 --student 6
"""

import argparse

from .attribute import judge
from .pipeline import run
from .spec import show

ap = argparse.ArgumentParser(prog="cfq")
ap.add_argument("problem", help="题面，如：求极限 lim(x→0) sin(3x)/x")
ap.add_argument("answer", nargs="?", help="题目给的答案；不给就跳过核对")
ap.add_argument("--student", help="学生对变式的作答")
a = ap.parse_args()

r = run(a.problem, a.answer)
if r.status != "ok":
    msg = {"flagged": f"给的答案和求解器算的 {show(r.truth)} 对不上，先不出变式", "unverifiable": "求解器核不了这道题"}
    raise SystemExit(msg.get(r.status, r.status))
v = r.picks[0]
print(f"一问：{v.text}\n（只改了 {v.change}）")
if a.student:
    print(judge(a.student, v.answer, v.traps, v.spec.params)[1])
