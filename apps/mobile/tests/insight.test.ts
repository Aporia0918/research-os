import { describe, expect, it } from 'vitest';
import { Book, unsureGrade, gradeFree, originOf } from '../src/ledger/ledger';
import { balanceCurve, balanceOn, ideaBook, streak, todayCard, weekBill } from '../src/ledger/insight';
import { memoryKV } from '../src/storage/kv';

const DERIV = '导数是函数在某点的瞬时变化率。几何上它是切线的斜率。求导要先写出差商再取极限。';
const GOOD = '导数是函数某点的瞬时变化率，几何上是切线斜率，求导先写差商再取极限';
const D0 = '2026-12-01'; // a Tuesday

async function seeded() {
  const book = new Book(memoryKV());
  const a = await book.add({ clientId: 'a', board: '学习', topic: '高数', question: '什么是导数', answer: DERIV, helpLevel: 'answer' }, D0);
  await book.add({ clientId: 'b', board: '学习', topic: '高数', question: '链式法则', helpLevel: 'own', ownIdea: '外导乘内导' }, D0);
  const c = await book.add({ clientId: 'c', board: '学习', topic: '线代', question: '秩是什么', helpLevel: 'hint', ownIdea: '线性无关的行数' }, D0);
  return { book, a, c };
}

describe('改天再聊、这个不用了、拿不准', () => {
  it('snooze moves a due debt to tomorrow and counts nothing; drop takes it off the schedule, report and balance', async () => {
    const { book, a, c } = await seeded();
    await book.snooze(a.id, '2026-12-02');
    expect((await book.all()).find(e => e.id === a.id)).toMatchObject({ dueOn: '2026-12-03', attempts: 0 });
    expect(balanceOn(await book.all(), D0)).toBe(2 - 2);
    await book.drop(c.id, D0);
    const es = await book.all();
    expect(es.find(e => e.id === c.id)).toMatchObject({ dueOn: null, dropped: D0 });
    expect(balanceOn(es, D0)).toBe(2 - 1);
    expect((await book.report(D0, '2026-12-05')).total).toBe(2);
    expect(await book.processRecord(D0)).toContain('不用了');
  });

  it('a half-right explanation is 拿不准 and preview books nothing', async () => {
    const { book, a } = await seeded();
    const half = await book.preview(a.id, '导数就是瞬时变化率');
    expect([half.passed, unsureGrade(half)]).toEqual([false, true]);
    expect(unsureGrade(gradeFree(DERIV, '不会'))).toBe(false);
    expect((await book.all()).find(e => e.id === a.id)!.attempts).toBe(0);
  });
});

describe('引用债', () => {
  const paper = { name: '滤波综述', pages: ['Intro.', '脑电信号先做 0.5 到 40 Hz 的带通滤波，再按 2 秒切段。'] };
  it('is owed today and settles only with an original sentence that has the same numbers', async () => {
    const book = new Book(memoryKV());
    const e = await book.addCitation({ clientId: 'k', claim: '论文里用的是 0.5 到 40 Hz 带通滤波', usedIn: '第二章' }, D0);
    expect([e.kind, e.dueOn, e.board, e.usedIn]).toEqual(['citation', D0, '科研', '第二章']);
    expect(await book.findOrigin(e.id, '脑电信号先做 1 到 30 Hz 的带通滤波', [paper], D0)).toBe(false);
    expect(await book.findOrigin(e.id, '脑电信号先做 0.5 到 40 Hz 的带通滤波', [paper], D0)).toBe(true);
    const done = (await book.all())[0];
    expect([done.dueOn, done.origin?.page]).toEqual([null, 2]);
    await expect(book.repay(e.id, '讲一遍', D0)).rejects.toThrow();
    expect(originOf('没有数字的说法', '短', [paper])).toBeNull();
  });
});

describe('账本上的今天、思考结余、想法本、每周账单', () => {
  it('reads everything from the entries', async () => {
    const { book, a } = await seeded();
    await book.repay(a.id, '不会', '2026-12-02');
    await book.repay(a.id, GOOD, '2026-12-03');
    const es = await book.all();
    expect(todayCard(es, D0)).toMatchObject({ explained: 0, again: 0 });
    expect(todayCard(es, D0).ideas.map(e => e.clientId)).toEqual(['b', 'c']);
    expect(todayCard(es, D0).asked.map(e => e.clientId)).toEqual(['a', 'c']);
    expect(todayCard(es, '2026-12-02')).toMatchObject({ explained: 0, again: 1 });
    expect(todayCard(es, '2026-12-03')).toMatchObject({ explained: 1, again: 0 });
    expect(balanceCurve(es, '2026-12-03', 3)).toEqual([0, 0, 0]); // a heavy debt needs two passes to settle
    expect(streak(es, '2026-12-03')).toBe(1); // 12-02 had only a miss
    expect(ideaBook(es, '学习', '没写课程').map(g => [g.topic, g.ideas.length])).toEqual([['线代', 1], ['高数', 1]]);
    const bill = weekBill(es, '2026-12-03');
    expect(bill).toMatchObject({ from: '2026-11-30', to: '2026-12-06', withIdea: 0.5, lastWithIdea: null, explained: 1, owed: 2 });
  });
});
