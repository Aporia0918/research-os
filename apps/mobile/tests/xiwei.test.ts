import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { Book, overHand, statusOf, type LedgerRemote, type Retest } from '../src/ledger/ledger';
import { retestRating } from '../src/ledger/memory';
import { problemKey, type Problem } from '../src/xiwei/xiwei';
import { memoryKV } from '../src/storage/kv';

const P: Problem = { kind: 'limit', expr: 'Abs(x)/x', var: 'x', ask: 'value', rhs: [],
  slots: [{ id: 'c1', type: 'point', value: '0', name: '' }, { id: 'c2', type: 'side', value: '+', name: '' }] };
const R = (over: Partial<Retest>): Retest =>
  ({ key: problemKey(P), kc: '单侧方向', question: 'lim(x→0⁺) |x|/x', problem: P, ok: false, fast: false, mastery: 0.2, ...over });

describe('析微 变式债 in the ledger', () => {
  it('rates a retest: wrong Again, slow or from options Hard, quick Good, quick twice Easy', () => {
    expect([retestRating(false, true, true), retestRating(true, false, true), retestRating(true, true, false), retestRating(true, true, true)])
      .toEqual([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
  });

  it('过手 needs two right answers on different days and mastery at 0.95', () => {
    const two = [{ on: '2026-12-01', ok: true }, { on: '2026-12-02', ok: true }];
    expect(overHand(two, 0.96)).toBe(true);
    expect(overHand(two, 0.9)).toBe(false);
    expect(overHand([{ on: '2026-12-01', ok: true }, { on: '2026-12-01', ok: true }], 0.99)).toBe(false);
    expect(overHand([{ on: '2026-12-01', ok: true }, { on: '2026-12-02', ok: false }], 0.99)).toBe(false);
  });

  it('a right first answer owes nothing; a miss books one debt per problem and condition, due tomorrow', async () => {
    const book = new Book(memoryKV());
    expect(await book.retest(R({ ok: true, fast: true, mastery: 0.7 }), '2026-12-01')).toBeNull();
    const e = (await book.retest(R({}), '2026-12-01'))!;
    expect([e.kind, e.topic, e.red, e.dueOn, e.attempts]).toEqual(['variant', '单侧方向', true, '2026-12-02', 1]);
    await book.retest(R({ kc: '绝对值与符号' }), '2026-12-01');
    expect((await book.all()).length).toBe(2);
  });

  it('right answers move the retest out by FSRS, and 过手 settles the debt', async () => {
    const book = new Book(memoryKV());
    await book.retest(R({}), '2026-12-01');
    const a = (await book.retest(R({ ok: true, fast: true, mastery: 0.8 }), '2026-12-02'))!;
    expect(a.dueOn! > '2026-12-02').toBe(true);
    expect(statusOf(a.passes, a.attempts, a.weight)).toBe('shaky');
    const b = (await book.retest(R({ ok: true, fast: true, mastery: 0.97 }), a.dueOn!))!;
    expect([b.dueOn, statusOf(b.passes, b.attempts, b.weight), b.tries!.at(-1)]).toEqual([null, 'settled', { on: a.dueOn, ok: true, fast: true }]);
    expect(await book.processRecord(a.dueOn!)).toContain('变式漏看条件 · 过手');
  });

  it('stays on the phone: the computer never receives a 变式债', async () => {
    const book = new Book(memoryKV());
    await book.retest(R({}), '2026-12-01');
    const sent: string[] = [];
    const remote: LedgerRemote = { entry: async (b) => { sent.push(b.question); return { id: 's' }; }, attempt: async () => ({}), due: async () => [] };
    await book.sync(remote, '2026-12-01');
    expect(sent).toEqual([]);
  });
});
