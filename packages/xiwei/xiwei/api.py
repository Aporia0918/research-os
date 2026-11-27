"""手机端（Pyodide）和测试调用的唯一入口：JSON 进，JSON 出。每个函数都只读入参，不存任何状态。"""

from __future__ import annotations

import json

from . import bkt
from .diagnose import diagnose, label, options
from .engine import ROUNDS, STOP_BITS, explain, generate, key
from .grade import VERIFIER, parse_answer, same
from .operators import KC
from .problem import Problem
from .read import methods as methods_of
from .read import read
from .render import LABELS, segments, slot_text
from .solve import IllDefined


def _view(p: Problem) -> dict:
    return {"problem": p.to_json(), "segments": [list(s) for s in segments(p)],
            "premises": [{"id": s.id, "label": LABELS[s.type], "text": slot_text(p, s), "kc": KC[s.type]} for s in p.slots]}


def _changed(p: Problem, q: Problem) -> str:
    return next(s.id for s, t in zip(p.slots, q.slots, strict=True) if s != t)


def api_read(text: str) -> dict:
    try:
        p, claim = read(text)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, **_view(p), "claim": claim, "methods": methods_of(text)}


def api_generate(problem: dict, mastery: dict | None = None, methods: list | None = None, claim: str | None = None,
                 exclude: list | None = None, asked: int = 0) -> dict:
    """出下一道变式。exclude 是这一轮出过的改动（不重复出）；asked 是这一轮已出的题数，到 ROUNDS 或信息增益太小就停。"""
    if asked >= ROUNDS:
        return {"ok": True, "stop": True, "variant": None}
    try:
        p = Problem.from_json(problem)
        r = generate(p, mastery, methods, exclude)
    except (ValueError, IllDefined) as e:
        return {"ok": False, "error": f"这道题求解器算不出来（{e}），先手动出题或只复做原题"}
    out = {"ok": True, "original": {**_view(p), "answer": r.original.to_json()}, "tried": r.tried}
    if claim:
        out["aiDisagrees"] = not same(parse_answer(claim, p.kind), r.original)
    v = r.variant
    if v is None:
        return {**out, "stop": True, "variant": None,
                "error": None if asked else "候选都没过四道检查，这道题先不出变式（记为待人工出题）"}
    if asked and v.bits < STOP_BITS:
        return {**out, "stop": True, "variant": None}
    q, sid = v.problem, v.change.slot
    out["original"]["premises"] = [{**x, "key": x["id"] == sid} for x in out["original"]["premises"]]
    return {**out, "stop": False, "variant": {
        **_view(q), "answer": v.answer.to_json(), "changed": sid, "key": key(v.change), "op": v.change.op.code,
        "kc": v.change.kc, "bits": round(v.bits, 3), "explain": explain(p, q, sid),
        "options": [a.to_json() for a in options(q, p, v.answer)]}}


def api_grade(original: dict, variant: dict, answer: str, mastery: dict | None = None, choices: int = 0) -> dict:
    """判对错、反推漏看前提，再对这道题看得出的所有知识成分做联合更新。choices>0 是选择题（猜中率取 1/选项数）。"""
    p, q = Problem.from_json(original), Problem.from_json(variant)
    sid = _changed(p, q)
    d = diagnose(q, p, parse_answer(answer, q.kind))
    truth, probe = d.pop("truth"), d.pop("probe")
    readings = {KC[q.slot(sid).type]: (), **probe.readings}  # 改动处的知识成分总要更新，哪怕没有可区分的错答
    before = {k: (mastery or {}).get(k, bkt.P0) for k in readings}
    after = before if d["obs"] is None else bkt.update(bkt.Probe(readings), before, d["obs"],
                                                       1 / choices if choices else bkt.GUESS)
    return {"ok": True, **d, "correct": d["verdict"] == "correct", "truth": truth.to_json(), "verifier": VERIFIER,
            "mastery": {k: round(v, 4) for k, v in after.items()},
            "mastered": sorted(k for k, v in after.items() if v >= bkt.MASTERED),
            "missed": [explain(p, q, s) if s == sid else label(q, s) for s in d["slots"]]}


CALLS = {"read": api_read, "generate": api_generate, "grade": api_grade}


def call(name: str, args_json: str) -> str:
    """手机端 worker 只调这一个：call("generate", '{"problem": …}')。"""
    try:
        return json.dumps(CALLS[name](**json.loads(args_json)), ensure_ascii=False)
    except Exception as e:  # 引擎内部出错也要给手机一句人话，不能让页面卡住
        return json.dumps({"ok": False, "error": f"引擎出错（{type(e).__name__}），这道题先手动处理"}, ensure_ascii=False)
