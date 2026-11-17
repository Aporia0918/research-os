import { expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { ratingOf, recallChance, review } from '../src/ledger/memory';
import { Book } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';

it('rates a repayment from the share of points covered', () => {
  expect([ratingOf(false, 0.9), ratingOf(true, 0.6), ratingOf(true, 0.85), ratingOf(true, 1)]).toEqual([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
});

it('spaces good repayments out and pulls a lapse back in', () => {
  const a = review(undefined, '2026-11-01', '2026-11-02', Rating.Good);
  const b = review(a, '2026-11-01', a.due, Rating.Good);
  const c = review(b, '2026-11-01', b.due, Rating.Again);
  expect(a.due > '2026-11-02').toBe(true);
  expect(b.s).toBeGreaterThan(a.s);
  expect(Date.parse(b.due) - Date.parse(b.last)).toBeGreaterThan(Date.parse(a.due) - Date.parse(a.last));
  expect([c.lapses, c.s < b.s, c.d > b.d]).toEqual([1, true, true]);
  // on the due day, recall is predicted at about the 90 % target
  expect(recallChance(b, b.due)).toBeGreaterThan(0.85);
  expect(recallChance(b, b.due)).toBeLessThan(0.95);
  expect(recallChance(undefined, '2026-11-02')).toBeNull();
});

it('the ledger keeps the memory state on the debt and a failed try still comes back tomorrow', async () => {
  const book = new Book(memoryKV());
  const e = await book.add({ clientId: 'm1', board: '学习', question: '什么是导数', answer: '导数是瞬时变化率，几何上是切线斜率', helpLevel: 'answer' }, '2026-12-01');
  const r = await book.repay(e.id, '不知道', '2026-12-02');
  expect([r.passed, r.nextDue, r.mem.lapses]).toEqual([false, '2026-12-03', 0]);
  expect((await book.all())[0].mem?.reps).toBe(1);
});
