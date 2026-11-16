import { describe, expect, it } from 'vitest';
import fixture from './fixtures/ledger-repayments.json';
import { Book, countdown, gradeFree, needsModel, nextDue, weightOf, type LedgerRemote } from '../src/ledger/ledger';
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

  it('trial switch: persisted start, half held back, quiz opens after two weeks or on request', async () => {
    const kv = memoryKV();
    const book = new Book(kv);
    await book.add({ clientId: 'pre', board: '学习', question: '试用前', answer: DERIV, helpLevel: 'answer' }, '2026-11-30');
    expect(await book.quizDue('2026-12-20', true)).toEqual([]); // no trial, no quiz
    await book.startTrial(D0); await book.startTrial('2026-12-03');
    expect(await new Book(kv).trialStart()).toBe(D0); // survives a restart, first start wins
    for (let i = 0; i < 20; i++) await book.add({ clientId: `s${i}`, board: '学习', question: `题 ${i}`, answer: DERIV, helpLevel: 'answer' }, D0);
    expect((await book.all()).filter((e) => e.held).length).toBeGreaterThan(5);
    expect(await book.quizDue('2026-12-14')).toEqual([]);
    expect((await book.quizDue('2026-12-14', true)).length).toBe(20); // ending early opens it, pre-trial debt left out
    const due = await book.quizDue('2026-12-15');
    await book.quiz(due[0].id, '不会');
    expect((await book.quizDue('2026-12-15')).length).toBe(19);
  });

  it('process record stays on the phone: one pass is half explained, own ideas count as independent', async () => {
    const book = new Book(memoryKV());
    const e = await book.add({ clientId: 'p1', board: '科研', question: '这个 p 值为什么不能直接比较', answer: DERIV, helpLevel: 'answer', ownIdea: '样本量不同' }, D0);
    await book.add({ clientId: 'p2', board: '学习', question: '链式法则', helpLevel: 'own', ownIdea: '外导乘内导' }, '2026-12-02');
    await book.repay(e.id, '导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限', '2026-12-04');
    const all = (await book.processRecord('2026-12-05', '2026-12-20')).split('\n');
    expect(all[0]).toBe('思维账本过程记录 · 2026-12-05');
    expect(all[1]).toBe('独立掌握度 50%，共 2 笔');
    expect(all[2]).toBe('2026-12-01 · 科研 · 这个 p 值为什么不能直接比较 · 完整答案 · 先想过 · 讲到一半');
    expect(all[3]).toBe('2026-12-02 · 学习 · 链式法则 · 自己想的 · 先想过 · 自己想的');
    const research = (await book.processRecord('2026-12-05', undefined, '科研')).split('\n');
    expect(research).toEqual(['思维账本过程记录 · 2026-12-05 · 科研', all[2]]);
  });

  it('several devices: offline first, replays without double counting, takes in debts borrowed on the computer', async () => {
    const book = new Book(memoryKV());
    const e = await book.add({ clientId: 'm1', board: '学习', question: '什么是导数', answer: DERIV, helpLevel: 'answer' }, D0);
    await book.saveDraft(e.id, '导数是瞬时变化率');
    expect(await book.draftOf(e.id)).toBe('导数是瞬时变化率'); // an interruption keeps what was said
    await book.repay(e.id, '导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限', '2026-12-02');
    expect(await book.draftOf(e.id)).toBe('');
    const seen: string[] = [];
    let up = false;
    const computer: LedgerRemote = {
      async entry(b, key) { if (!up) throw new Error('offline'); seen.push(key); return { id: `srv_${b.client_id}` }; },
      async attempt(id, _t, key) { seen.push(`${id}:${key}`); },
      async due() { return [{ id: 'srv_x', client_id: 'ext1', topic: '', question: '电脑上问的链式法则', answer: '外导乘内导', own_idea: '',
        help_level: 'answer', due_on: '2026-12-02', created_on: D0 }]; },
    };
    expect(await book.sync(computer, '2026-12-02')).toEqual({ sent: 0, pulled: 0, stopped: true }); // no computer: nothing lost
    up = true;
    expect(await book.sync(computer, '2026-12-02')).toEqual({ sent: 2, pulled: 1, stopped: false });
    expect(seen).toEqual(['entry-m1', 'srv_m1:attempt-m1-1']);
    expect(await book.sync(computer, '2026-12-02')).toEqual({ sent: 0, pulled: 0, stopped: false }); // nothing sent twice
    expect((await book.due('2026-12-02')).map((x) => [x.question, x.fromComputer])).toEqual([['电脑上问的链式法则', true]]);
  });
});

describe('还债提醒带上日期', () => {
  it('counts days only when the date is within a week and something is owed', () => {
    expect(countdown('2026-12-01', '2026-12-04', 3)).toBe(3);
    expect(countdown('2026-12-01', '2026-12-04', 0)).toBeNull();
    expect(countdown('2026-12-01', '2026-12-20', 3)).toBeNull();
    expect(countdown('2026-12-01', undefined, 3)).toBeNull();
    expect(countdown('2026-12-05', '2026-12-04', 3)).toBeNull();
  });
});

describe('讲不出来那一笔标红，排在考前清单第一行（演示第一段）', () => {
  const SUB = '换元积分：令 u 等于里层函数，dx 换成 du 除以 u 的导数，积完再把 u 换回去。';

  it('right after booking: 讲不出来 marks it red, first on the list, no score; a later pass clears it', async () => {
    const book = new Book(memoryKV());
    const exam = '2026-12-02'; // tomorrow
    const older = await book.add({ clientId: 'o', board: '学习', question: '什么是导数', answer: DERIV, helpLevel: 'answer' }, '2026-11-28');
    const e = await book.add({ clientId: 'r', board: '学习', question: '这道换元积分怎么做', answer: SUB, helpLevel: 'answer' }, D0, exam);
    expect(await book.checkNow(e.id, '', D0, exam)).toBeNull(); // nothing graded
    const rep = await book.report(D0, exam);
    expect(rep.repayBeforeExam.map((i) => [i.id, Boolean(i.red)])).toEqual([[e.id, true], [older.id, false]]);
    expect((await book.due(D0))[0].id).toBe(e.id);
    expect((await book.processRecord(D0)).split('\n').pop()).toContain('讲不出来');
    const r = await book.repay(e.id, '令 u 等于里层函数，dx 换成 du 除以 u 的导数，积完再把 u 换回去', D0, exam);
    expect([r.passed, (await book.all()).find((x) => x.id === e.id)!.red]).toEqual([true, false]);
  });

  it('a good explanation right after reading the answer leaves the schedule alone; a weak one marks it red', async () => {
    const book = new Book(memoryKV());
    const a = await book.add({ clientId: 'a', board: '学习', question: '换元积分', answer: SUB, helpLevel: 'answer' }, D0);
    const g = await book.checkNow(a.id, '令 u 等于里层函数，dx 换成 du 除以 u 的导数，积完再把 u 换回去', D0);
    const after = (await book.all())[0];
    expect([g!.passed, after.dueOn, after.attempts, after.passes, Boolean(after.red)]).toEqual([true, a.dueOn, 0, 0, false]);
    const w = await book.checkNow(a.id, '先换元再积分', D0);
    const red = (await book.all())[0];
    expect([w!.passed, red.red, red.dueOn, red.attempts]).toEqual([false, true, '2026-12-02', 1]);
  });

  it('a failed repayment on the due day also marks it red', async () => {
    const book = new Book(memoryKV());
    const e = await book.add({ clientId: 'f', board: '学习', question: '什么是导数', answer: DERIV, helpLevel: 'answer' }, D0);
    await book.repay(e.id, '不会', '2026-12-02');
    expect((await book.all())[0].red).toBe(true);
  });
});

describe('结论体检崩分记结论债（演示第二段）', () => {
  const crash = { key: '/p/train.py|/p/f.csv|af', question: 'train.py 在 f.csv 上跑出的结论', outcome: 'fail' as const };

  it('a crash books a red 结论债 on 科研 that leads the list before the group meeting', async () => {
    const book = new Book(memoryKV());
    await book.add({ clientId: 'k1', board: '学习', question: '什么是导数', answer: DERIV, helpLevel: 'answer' }, D0);
    const e = await book.checkup(crash, D0);
    expect(e).toMatchObject({ board: '科研', kind: 'conclusion', red: true, dueOn: D0, attempts: 1 });
    const r = await book.report(D0, '2026-12-04');
    expect(r.repayBeforeExam[0].id).toBe(e.id);
    expect(await book.processRecord(D0)).toContain('AI 写的分析 · 崩分，改好再考');
  });

  it('only a null-world pass repays it, on the same debt; explaining does not', async () => {
    const book = new Book(memoryKV());
    const e = await book.checkup(crash, D0);
    await expect(book.repay(e.id, '我讲一遍', D0)).rejects.toThrow('repay_by_exam');
    await expect(book.checkNow(e.id, '', D0)).rejects.toThrow('repay_by_exam');
    await book.checkup({ ...crash, outcome: 'unsure' }, D0);
    expect((await book.all())[0]).toMatchObject({ red: false, dueOn: D0 });
    await book.checkup({ ...crash, outcome: 'pass' }, '2026-12-02');
    const all = await book.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ red: false, dueOn: null, attempts: 3 });
    expect((await book.report(D0, '2026-12-04')).counts.settled).toBe(1);
    expect(await book.due('2026-12-02')).toEqual([]);
  });

  it('stays on the phone: never sent to the computer and kept out of the trial quiz', async () => {
    const book = new Book(memoryKV());
    await book.checkup(crash, D0);
    const sent: string[] = [];
    const remote: LedgerRemote = { entry: async (b) => { sent.push(b.client_id); return { id: 's' }; }, attempt: async () => ({}), due: async () => [] };
    await book.sync(remote, D0);
    expect(sent).toEqual([]);
    await book.startTrial(D0);
    expect(await book.quizDue(D0, true)).toEqual([]);
  });
});

