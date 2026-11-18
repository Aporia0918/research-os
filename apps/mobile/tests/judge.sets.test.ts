// The free grader (no model) on two answer sets the developers wrote and labelled (not real students' answers).
// Set A was scored before the contradiction guard (TURNS in ledger.ts) and then used to build it; set B was committed
// before the guard and scored once after. The plan reports set B. A model, when the user sets one, is not measured here.
import { describe, expect, it } from 'vitest';
import A from './fixtures/judge/answers.json';
import B from './fixtures/judge/answers-b.json';
import { gradeFree, unsureGrade } from '../src/ledger/ledger';

type Set = { items: { ref: string; attempts: { text: string; label: string; kind: string }[] }[] };
function score(set: Set) {
  const r = { ok: 0, okPass: 0, okUnsure: 0, no: 0, noPass: 0, noUnsure: 0, closePass: 0, paraphrasePass: 0 };
  for (const i of set.items) for (const a of i.attempts) {
    const g = gradeFree(i.ref, a.text);
    const unsure = !g.passed && unsureGrade(g);
    if (a.label === 'ok') {
      r.ok++; if (g.passed) r.okPass++; else if (unsure) r.okUnsure++;
      if (g.passed && a.kind === 'close') r.closePass++;
      if (g.passed && a.kind === 'paraphrase') r.paraphrasePass++;
    } else { r.no++; if (g.passed) r.noPass++; else if (unsure) r.noUnsure++; }
  }
  return r;
}

describe('free grader on labelled answers', () => {
  it.each([
    ['A', { ok: 40, okPass: 20, okUnsure: 2, no: 60, noPass: 3, noUnsure: 13, closePass: 20, paraphrasePass: 0 }],
    ['B', { ok: 40, okPass: 19, okUnsure: 1, no: 60, noPass: 4, noUnsure: 13, closePass: 19, paraphrasePass: 0 }],
  ] as const)('set %s is pinned', (name, want) => {
    expect(score(name === 'A' ? A : B)).toEqual(want);
  });
  it('a fluent answer that keeps the words and swaps 正比 for 反比 is never a pass', () => {
    const ref = '欧姆定律指出，在温度不变时，导体中的电流与两端电压成正比，与电阻成反比。';
    const g = gradeFree(ref, '温度不变时，导体中的电流与两端电压成反比，与电阻成正比');
    expect([g.passed, g.turned?.length ? 'turned' : 'none', unsureGrade(g)]).toEqual([false, 'turned', true]);
    expect(gradeFree(ref, '温度不变时导体中的电流与两端电压成正比，与电阻成反比').passed).toBe(true);
  });
});
