import { describe, expect, it } from 'vitest';
import { checkLoop } from '../src/ledger/loop';

// Made-up conversations for the rule's behaviour only. They say nothing about how often real users loop.
const following = [
  { q: '怎么让模型准确率更高', a: '可以试试调整学习率、增加正则化，或者做数据增强。' },
  { q: '学习率怎么调整', a: '学习率可以用余弦退火，也可以用预热再衰减。' },
  { q: '余弦退火和预热衰减哪个好', a: '预热衰减在大批量训练时更稳，余弦退火更省事。' },
  { q: '大批量训练时预热衰减怎么设置', a: '预热步数一般取总步数的百分之五左右。' },
];
const branching = [
  { q: '怎么让模型准确率更高', a: '可以试试调整学习率、增加正则化，或者做数据增强。' },
  { q: '学习率怎么调整', a: '学习率可以用余弦退火，也可以用预热再衰减。' },
  { q: '会不会是标签本身有错，先抽一百条人工核对', a: '可以，抽样核对能发现标注噪声。', own: '我怀疑数据标注有问题' },
  { q: '测试集和训练集是不是同一批病人', a: '如果是，同一病人的样本会泄漏。' },
];

describe('顺从回路, by rule, no model', () => {
  it('flags a run of questions that only reuse the last answer', () => {
    const r = checkLoop(following);
    expect(r.looping).toBe(true);
    expect(r.run).toBe(3);
    expect(r.ownTurns).toBe(0);
    expect(r.follow.slice(1).every((s) => s >= 0.5)).toBe(true);
  });
  it('a question in the user\'s own words breaks the run', () => {
    const r = checkLoop(branching);
    expect(r.looping).toBe(false);
    expect(r.ownTurns).toBe(1);
    expect(r.lastOwn).toBe(3);
  });
  it('empty input is not a loop', () => {
    expect(checkLoop([])).toEqual({ follow: [], run: 0, ownTurns: 0, lastOwn: -1, looping: false });
  });
});
