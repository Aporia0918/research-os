// AI 使用说明 (plan 1.3): the same ledger in three parts, plain text to attach to a thesis or report.
import { describe, expect, it } from 'vitest';
import { aiUseOf, aiUseText, settledOn } from '../src/ledger/aiUse';
import type { Entry } from '../src/ledger/ledger';

const base: Entry = { id: '1', clientId: 'c1', board: '学习', topic: '高数', question: '导数的几何意义', answer: '切线斜率', ownIdea: '',
  helpLevel: 'answer', weight: 'heavy', passes: 0, attempts: 0, dueOn: '2026-11-20', createdOn: '2026-11-10' };
const e = (o: Partial<Entry>): Entry => ({ ...base, ...o });

describe('AI 使用说明', () => {
  const es = [
    e({ id: 'a', question: '我先想的：链式法则', helpLevel: 'own', weight: null, createdOn: '2026-11-09', ownIdea: '外层导数乘内层导数' }),
    e({ id: 'b', ai: '豆包', passes: 2, attempts: 2, tries: [{ on: '2026-11-11', ok: true }, { on: '2026-11-17', ok: true }] }),
    e({ id: 'c', question: '换元积分', helpLevel: 'hint', weight: 'light', ownIdea: '先换元', createdOn: '2026-11-12' }),
    e({ id: 'd', question: '这句引用对吗', board: '科研', kind: 'citation', createdOn: '2026-11-14', origin: { page: 3, paper: '综述', quote: '原话' }, tries: [{ on: '2026-11-15', ok: true }] }),
    e({ id: 'x', question: '不用了的', dropped: '2026-11-13' }),
    e({ id: 'y', question: '成长空间的', board: '生活' }),
  ];
  it('splits into own ideas, AI help and later explained; dropped and 成长空间 stay out', () => {
    const r = aiUseOf(es);
    expect(r.own.map(x => x.id)).toEqual(['a', 'c']);
    expect(r.borrowed.map(x => x.id)).toEqual(['b', 'c', 'd']);
    expect(r.settled.map(x => [x.e.id, x.on])).toEqual([['b', '2026-11-17'], ['d', '2026-11-15']]);
    expect(aiUseOf(es, '科研').borrowed.map(x => x.id)).toEqual(['d']);
  });
  it('says the level, the AI, the day it was explained, and what the page is not', () => {
    const t = aiUseText(es, '2026-11-18');
    expect(t).toContain('自己先想的 2 处，AI 帮的 3 处，其中后来不靠 AI 讲清楚的 2 处');
    expect(t).toContain('导数的几何意义（完整答案，豆包）');
    expect(t).toContain('换元积分（提示）');
    expect(t).toContain('2026-11-17 导数的几何意义：讲清楚了');
    expect(t).toContain('《综述》第 3 页');
    expect(t).toContain('不是 AIGC 检测结果');
    expect(t).not.toContain('不用了的');
  });
  it('an untried debt is not settled', () => {
    expect(settledOn(e({}))).toBeNull();
  });
});
