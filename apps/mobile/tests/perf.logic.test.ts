// Plan 2.5 targets, the part that runs on the phone with no model: 记一笔 (a debt booked, target under 5 s) and
// 知识类判定 (an explanation graded with the free grader, target under 10 s). A book that already holds 300 debts,
// 20 timed runs each, median and P90. This is logic time in Node, not on a phone, and without the model call that a
// heavy debt adds; PERF_OUT=<file> writes the numbers for the test report.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Book } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';
import A from './fixtures/judge/answers.json';

const D0 = '2026-12-01';
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))];
  return { median_ms: Math.round(at(0.5) * 10) / 10, p90_ms: Math.round(at(0.9) * 10) / 10, runs: s.length };
};

describe('phone logic timings (Node, no model)', () => {
  it('记一笔 and 判定 stay far under their targets', async () => {
    const book = new Book(memoryKV());
    const items = A.items;
    for (let n = 0; n < 300; n++) {
      const i = items[n % items.length];
      await book.add({ clientId: `seed-${n}`, board: '学习', topic: '高数', question: i.q, answer: i.ref, helpLevel: 'answer' }, D0);
    }
    const add: number[] = [], judge: number[] = [];
    for (let n = 0; n < 20; n++) {
      const i = items[n % items.length];
      let t = performance.now();
      const e = await book.add({ clientId: `run-${n}`, board: '学习', topic: '高数', question: i.q, answer: i.ref, helpLevel: 'answer' }, D0);
      add.push(performance.now() - t);
      t = performance.now();
      await book.repay(e.id, i.attempts[1].text, '2026-12-02');
      judge.push(performance.now() - t);
    }
    const out = { where: `Node ${process.version}, ${process.platform}`, book: 300, add: stats(add), judge: stats(judge) };
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(out, null, 1));
    console.info('[perf]', JSON.stringify(out));
    expect(out.add.p90_ms).toBeLessThan(5000);
    expect(out.judge.p90_ms).toBeLessThan(10000);
  }, 60_000);
});
