"""跑测试集，出 report.md 和 results.json。用法：python3 eval.py [data/limits.jsonl]"""

from __future__ import annotations

import json
import statistics
import sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import sympy as sp
from cfq.attribute import FORM_GUESS, blind_lhopital, form, judge
from cfq.pipeline import run
from cfq.spec import same, show

HERE = Path(__file__).parent


def student_answers(v) -> list[tuple[str, str]]:
    """模拟学生作答：(答案文字, 应判成的类别)。错答来自同一套错因库，只能测「解析+比对+歧义」，不等于真学生。"""
    out = [(show(v.answer), "correct")]
    if not isinstance(v.answer, str) and v.answer.is_finite and not v.answer.is_Integer:
        out.append((f"{float(sp.N(v.answer)):.4g}", "correct"))  # 学生写小数
    out += [(show(t.value), t.kind) for t in v.traps]
    off = sp.Integer(7) if isinstance(v.answer, str) or v.answer.is_infinite else v.answer + 7
    out.append((show(off), "unknown"))
    return out


def published_errors(v, was_hard: bool) -> list[tuple[str, str]]:
    """按公开常见错误清单（data/common_errors.md）推出学生会写的错答：(答案文字, 错因)。"""
    out = []
    if (fm := form(v.spec)) is not None:
        out += [(show(g), "form") for g in FORM_GUESS[fm] if not same(g, v.answer)]
    if was_hard and (b := blind_lhopital(v.spec)) is not None and not same(b, v.answer):
        out.append((show(b), "method"))
    return out


def misflags(v, was_hard: bool) -> tuple[int, int]:
    """这些真实常见错答里，有几个会被误判成「漏看条件」。"""
    errs = published_errors(v, was_hard)
    return sum(judge(a, v.answer, v.traps, v.spec.params)[0] == "ignore" for a, _ in errs), len(errs)


def one(item: dict) -> dict:
    r = run(item["text"], item["given"])
    pool_mis = [misflags(v, r.was_hard) for v in r.found]
    picks = []
    for v in r.picks:
        sims = [(a, want, judge(a, v.answer, v.traps, v.spec.params)[0]) for a, want in student_answers(v)]
        picks.append(
            dict(
                text=v.text,
                change=str(v.change),
                kind=v.change.kind,
                answer=show(v.answer),
                traps=[dict(kind=t.kind, value=show(t.value), why=t.why) for t in v.traps],
                clear=v.clear,
                hard=v.hard,
                readback=v.readback,
                sims=sims,
                published=[
                    (a, k, judge(a, v.answer, v.traps, v.spec.params)[0]) for a, k in published_errors(v, r.was_hard)
                ],
            )
        )
    return dict(
        id=item["id"],
        source=item["source"],
        url=item["url"],
        text=item["text"],
        given=item["given"],
        expect_flag=item.get("expect_flag", False),
        status=r.status,
        truth=None if r.truth is None else show(r.truth),
        tried=r.tried,
        valid=r.valid,
        seconds=round(r.seconds, 2),
        orig_hard=r.was_hard,
        pool_mis=[sum(m for m, _ in pool_mis), sum(n for _, n in pool_mis)],
        picks=picks,
    )


def has_method(p: dict) -> bool:
    return any(t["kind"] == "method" for t in p["traps"])


def useful(p: dict) -> bool:
    """有考点：要真算，或形式变了、原方法不能照搬。"""
    return p["hard"] or has_method(p)


def pct(a: int, b: int) -> str:
    return f"{a}/{b}（{100 * a / b:.0f}%）" if b else "0/0"


def report(rows: list[dict]) -> str:
    real = [r for r in rows if not r["expect_flag"]]
    bad = [r for r in rows if r["expect_flag"]]
    anchored = [r for r in real if r["status"] in ("ok", "no_variant")]
    ok = [r for r in anchored if r["status"] == "ok"]
    picks = [p for r in ok for p in r["picks"]]
    best = [r["picks"][0] for r in ok]
    sims = [s for p in picks for s in p["sims"]]
    by_want = Counter(w for _, w, _ in sims)
    hit_want = Counter(w for _, w, g in sims if w == g)
    secs = [r["seconds"] for r in rows]
    kinds = Counter(p["kind"] for p in best)
    mean_tried = statistics.mean(r["tried"] for r in anchored)
    hard_ok = [r for r in ok if r["orig_hard"]]
    pool_m, pool_n = (sum(r["pool_mis"][i] for r in ok) for i in (0, 1))
    pub = [x for r in ok for x in r["picks"][0]["published"]]
    pub_m, pub_n = sum(g == "ignore" for _, _, g in pub), len(pub)
    mean_valid = statistics.mean(r["valid"] for r in anchored)

    lines = [
        "# 反事实一问 · 高数极限原型 · 自测报告",
        "",
        f"测试集：{len(rows)} 条，其中 {len(real)} 道公开题"
        "（OpenStax《Calculus Volume 1》2.3、4.8 节习题，答案取原页），"
        f"另有 {len(bad)} 条是把其中几道的答案人为改错，用来测锚定能否拦下。",
        "这是自建题集上的机器自测，不是真实学生数据。",
        "",
        "## 数字",
        "",
        "| 指标 | 结果 |",
        "|---|---|",
        f"| 规则读题（打字题面 → 结构） | {pct(sum(r['status'] != 'unreadable' for r in rows), len(rows))} |",
        f"| 锚定：公开题答案与求解器一致 | {pct(len(anchored), len(real))} |",
        f"| 锚定：改错的答案被拦下 | {pct(sum(r['status'] == 'flagged' for r in bad), len(bad))} |",
        f"| 至少出 1 道「只改一个条件」的有效变式 | {pct(len(ok), len(anchored))} |",
        f"| 每题平均候选 / 有效变式 | {mean_tried:.1f} / {mean_valid:.1f} |",
        f"| 首选变式里「漏看条件」能和别的错因分开 | {pct(sum(p['clear'] for p in best), len(best))} |",
        f"| 首选变式要真算（不能直接代入） | {pct(sum(p['hard'] for p in best), len(best))} |",
        f"| 首选变式带「方法不能照搬」陷阱 | {pct(sum(map(has_method, best)), len(best))} |",
        f"| 首选变式有考点（上面两条至少占一条） | {pct(sum(map(useful, best)), len(best))} |",
        f"| 原题本身要技巧的题里，首选变式有考点 | {pct(sum(useful(r['picks'][0]) for r in hard_ok), len(hard_ok))} |",
        f"| 变式改写回题面并回读一致 | {pct(sum(p['readback'] for p in picks), len(picks))} |",
        f"| 模拟错答归因正确 | {pct(sum(hit_want.values()), len(sims))} |",
        f"| 单题耗时 中位 / 最长 | {statistics.median(secs):.1f} 秒 / {max(secs):.1f} 秒 |",
        "| 模型调用与费用 | 0 次，0 元（本轮全走规则与求解器） |",
        "",
        "归因分项：" + "，".join(f"{k} {hit_want[k]}/{n}" for k, n in sorted(by_want.items())),
        "",
        "首选变式的改法分布：" + "，".join(f"{k} {n}" for k, n in kinds.most_common()),
        "",
        "怎么读这些数：读题、回读两项是规则写法自己读自己写，100% 不说明模型读截图的能力；"
        "错答归因用的是同一套错因库生成的模拟答案，只证明答案解析、等价比对和歧义检查没写错，"
        "不说明能猜中真学生的错。真正有分量的是锚定、有效变式、「有考点」，以及下一节用公开错误清单测的误判率。",
        "",
        "## 用公开常见错误测「漏看条件」会不会误判",
        "",
        "按 data/common_errors.md 里三份公开资料"
        "（Lamar 大学 Paul's Notes、波特兰州立大学辅导中心、ERIC 收录的 MERGA 2025 论文）"
        "列出的错误，推出学生在每道变式上会写的错答（把不定式当定值、1/0 当 ∞、不是 0/0 也用洛必达），"
        "看系统会不会把它们误判成「漏看了改动的条件」。",
        "",
        "| | 真实常见错答数 | 被误判成漏看条件 |",
        "|---|---|---|",
        f"| 全部有效变式（不筛选） | {pool_n} | {pct(pool_m, pool_n)} |",
        f"| 系统选出的首选变式 | {pub_n} | {pct(pub_m, pub_n)} |",
        "",
        "说明：错答是按清单规则推出来的，不是真学生写的；"
        "清单里只有 0/0 当 0、0/0 当不存在是论文里学生的原话，其余取值是规则落地。",
        "",
        "## 没过的",
        "",
    ]
    for r in rows:
        if (r["status"] != "ok" and not r["expect_flag"]) or (r["expect_flag"] and r["status"] != "flagged"):
            lines.append(f"- {r['id']}：{r['text']}，状态 {r['status']}，原页答案 {r['given']}，求解器 {r['truth']}")
    weak = [r for r in ok if not useful(r["picks"][0])]
    lines += ["流程全过，但首选一问没有考点（一眼能看出）的："] + [
        f"- {r['id']}：{r['text']} → {r['picks'][0]['text']}" for r in weak
    ]
    lines += ["", "## 样例", ""]
    for r in ok[:: max(1, len(ok) // 6)][:6]:
        p = r["picks"][0]
        lines += [
            f"**原题**（{r['id']}）：{r['text']}，答案 {r['given']}",
            f"**一问**：{p['text']}　（改了 {p['change']}）",
            f"正确答案 {p['answer']}；" + "；".join(f"答 {t['value']} → {t['why']}" for t in p["traps"]),
            "",
        ]
    lines += ["## 逐题", "", "| 编号 | 原页答案 | 求解器（符号+数值双核） | 状态 | 首选一问 |", "|---|---|---|---|---|"]
    for r in rows:
        p = r["picks"][0] if r["picks"] else None
        q = f"{p['change']}，答案 {p['answer']}" if p else ""
        lines.append(f"| {r['id']} | {r['given']} | {r['truth']} | {r['status']} | {q} |")
    lines += ["", "## 来源", ""] + sorted({f"- {r['source'].split('第')[0]}：{r['url']}" for r in rows})
    return "\n".join(lines) + "\n"


def main() -> None:
    data = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data/limits.jsonl"
    items = [json.loads(line) for line in data.read_text().splitlines() if line.strip()]
    with Pool(4) as pool:
        rows = pool.map(one, items)
    (HERE / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    (HERE / "report.md").write_text(report(rows))
    print(report(rows))


if __name__ == "__main__":
    main()
