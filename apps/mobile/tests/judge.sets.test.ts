// The free grader (no model) on three answer sets the developers wrote and labelled (not real students' answers).
// Set A was scored before the contradiction guard (TURNS in ledger.ts) and then used to build it; set B was committed
// before the guard and scored once after. Set C was committed before the "said in other words" check (looseCover) and
// scored once after; that check was tuned on set A only. The plan reports sets B and C. A model, when the user sets one,
// is not measured here. The two operation pairs (减/加, 除/乘) were added after the computer's held-out set D showed
// swapped operations passing; they change no grade on sets A, B or C.
import { describe, expect, it } from 'vitest';
import A from './fixtures/judge/answers.json';
import B from './fixtures/judge/answers-b.json';
import C from './fixtures/judge/answers-c.json';
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
    ['A', A, { ok: 40, okPass: 20, okUnsure: 13, no: 60, noPass: 3, noUnsure: 14, closePass: 20, paraphrasePass: 0 }],
    ['B', B, { ok: 40, okPass: 19, okUnsure: 14, no: 60, noPass: 4, noUnsure: 15, closePass: 19, paraphrasePass: 0 }],
    ['C', C, { ok: 40, okPass: 19, okUnsure: 7, no: 60, noPass: 4, noUnsure: 12, closePass: 19, paraphrasePass: 0 }],
  ] as const)('set %s is pinned', (_name, set, want) => {
    expect(score(set)).toEqual(want);
  });
  it('an explanation in other words is 拿不准, never a pass and never a plain fail', () => {
    const ref = '导数是函数在某一点的瞬时变化率。几何上，它等于函数图像在该点切线的斜率。导数为正时函数在该点附近递增。';
    const g = gradeFree(ref, '表示函数在那一刻变得多快，画出图来就是那点切线有多陡，正的话说明附近往上走');
    expect([g.passed, g.loose, unsureGrade(g)]).toEqual([false, true, true]);
    expect(gradeFree(ref, '导数就是求导').loose).toBeUndefined();
  });
  it('a fluent answer that keeps the words and swaps 正比 for 反比 is never a pass', () => {
    const ref = '欧姆定律指出，在温度不变时，导体中的电流与两端电压成正比，与电阻成反比。';
    const g = gradeFree(ref, '温度不变时，导体中的电流与两端电压成反比，与电阻成正比');
    expect([g.passed, g.turned?.length ? 'turned' : 'none', unsureGrade(g)]).toEqual([false, 'turned', true]);
    expect(gradeFree(ref, '温度不变时导体中的电流与两端电压成正比，与电阻成反比').passed).toBe(true);
  });
});
