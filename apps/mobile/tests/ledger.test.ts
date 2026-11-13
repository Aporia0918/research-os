import { describe, expect, it } from 'vitest';
import fixture from './fixtures/ledger-repayments.json';
import { Book, gradeFree, needsModel, nextDue, weightOf } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';

const DERIV = '导数是函数在某点的瞬时变化率。几何上它是切线的斜率。求导要先写出差商再取极限。';
const D0 = '2026-12-01';

describe('思维账本 on the phone, no key', () => {
  it('free grader matches the Python grader on every sample repayment', () => {
    for (const c of fixture.cases) {
      const g = gradeFree(c.ref, c.attempt);
      expect([g.points.length, g.hits, needsModel('medium', g, c.attempt)]).toEqual([c.py.points, c.py.hits, c.py.model]);
    }
  });

  it('more thinking, less debt; schedules match the server', () => {
    expect([weightOf('own', false), weightOf('answer', false), weightOf('answer', true), weightOf('hint', true)])
      .toEqual([null, 'heavy', 'medium', 'light']);
    expect([nextDue('light', 0, D0), nextDue('medium', 1, D0), nextDue('heavy', 1, D0), nextDue('heavy', 2, D0)])
      .toEqual(['2026-12-04', '2026-12-03', '2026-12-08', null]);
    expect(nextDue('heavy', 1, D0, '2026-12-05')).toBe('2026-12-04'); // exam week pulls it forward
  });

  it('books, repays and reports with no model at all', async () => {
    const book = new Book(memoryKV());
    const e = await book.add({ clientId: 'c1', board: '学习', topic: '高数', question: '什么是导数', answer: DERIV,
      helpLevel: 'answer' }, D0);
    expect(await book.add({ clientId: 'c1', board: '学习', question: '重复', helpLevel: 'hint' }, D0)).toEqual(e);
    await book.add({ clientId: 'c2', board: '学习', question: '链式法则', helpLevel: 'own', ownIdea: '外导乘内导' }, D0);
    const r1 = await book.repay(e.id, '导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限', '2026-12-02');
    expect([r1.passed, r1.method, r1.nextDue]).toEqual([true, 'deterministic', '2026-12-09']);
    const rep = await book.report('2026-12-02', '2026-12-06');
    expect([rep.total, rep.counts, rep.independence]).toEqual([2, { own: 1, settled: 0, shaky: 1, untested: 0 }, 0.5]);
    expect(rep.repayBeforeExam.map((i) => [i.id, i.dueOn])).toEqual([[e.id, '2026-12-05']]);
  });

  it('asks a model only where it can change the result', async () => {
    let calls = 0;
    const ask = async () => { calls += 1; return '{"points": ["变化率", "切线斜率", "差商极限"], "hits": [0, 1]}'; };
    const book = new Book(memoryKV());
    const light = await book.add({ clientId: 'l', board: '学习', question: '什么是导数', answer: DERIV, helpLevel: 'hint' }, D0);
    expect((await book.repay(light.id, '不会', '2026-12-04', undefined, ask)).method).toBe('deterministic');
    expect(calls).toBe(0);
    const unsure = await book.repay(light.id, '导数大概和变化有关系吧', '2026-12-05', undefined, ask);
    expect([unsure.method, unsure.passed, calls]).toEqual(['model', true, 1]);
  });

  it('trial: half the debts held back, quiz on all, counts only', async () => {
    const book = new Book(memoryKV(), true);
    for (let i = 0; i < 20; i++) await book.add({ clientId: `t${i}`, board: '学习', question: `题 ${i}`, answer: DERIV, helpLevel: 'answer' }, D0);
    const all = await book.all();
    const held = all.filter((e) => e.held);
    expect(held.length).toBeGreaterThan(5);
    expect(held.every((e) => e.dueOn === null) && all.filter((e) => !e.held).every((e) => e.dueOn)).toBe(true);
    await book.opened(D0); await book.opened('2026-12-09');
    await book.quiz(held[0].id, '导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限');
    const s = await book.trialSummary('2026-12-09');
    expect([s.heldBack.debts, s.heldBack.quizzed, s.heldBack.quizPassed, s.repaid.debts + s.heldBack.debts, s.back7])
      .toEqual([held.length, 1, 1, 20, true]);
    expect(JSON.stringify(s)).not.toContain('导数');
  });
});

