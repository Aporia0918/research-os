#!/usr/bin/env python3
"""Diff the TypeScript rule port against the backend's own Python functions on identical inputs.

Run from app/:
  PYTHONPATH=../20261011-ResearchOS/services/api ../20261011-ResearchOS/.venv/bin/python scripts/rules-parity-fixtures.py > /tmp/parity-py.json
  npx tsx scripts/rules-parity.ts /tmp/parity-ts.json
  python3 scripts/rules-parity-check.py /tmp/parity-py.json /tmp/parity-ts.json
Exit 1 on any semantic difference (ids/timestamps/coverage float form are ignored).
"""
import json, sys

def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in ('id', 'evidence_id', 'user_text', 'page_index')}
    if isinstance(o, list):
        return [strip(x) for x in o]
    if isinstance(o, float):
        return round(o, 6)
    return o

def normq(o):
    if isinstance(o, dict) and set(o) == {'status', 'items'}:
        return [o['status'], strip(o['items'])]
    return strip(o)

py = json.load(open(sys.argv[1]))
ts = json.load(open(sys.argv[2]))
bad = 0
for k in sorted(set(ts) | set(py)):
    if k == 'specific':  # the python dump stored the function repr, not a value
        continue
    a, b = normq(py.get(k)), normq(ts.get(k))
    if a == b:
        print('SAME', k)
    else:
        bad += 1
        print('DIFF', k)
        print('  py:', json.dumps(a, ensure_ascii=False)[:600])
        print('  ts:', json.dumps(b, ensure_ascii=False)[:600])
print(f'parity_diffs={bad}')
sys.exit(1 if bad else 0)
