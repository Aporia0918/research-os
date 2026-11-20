// 「听懂导师」 core: requirement memory, gap questions (with memory filling what the advisor already settled), rehearsal.
import { describe, expect, it } from 'vitest';
import { askLine, chooseQuestions, ruleMissing } from '../src/mentor/gaps';
import { buildMemory, relevant } from '../src/mentor/memory';
import { habits, ruleFeedback, ruleProbes } from '../src/mentor/rehearse';
import { demoData } from '../src/mentor/demo';
import { findGaps, rehearse } from '../src/mentor/ai';
import { memoryKV } from '../src/storage/kv';
import type { Meeting } from '../src/mentor/types';

const now = new Date(2026, 10, 23, 9).getTime();
const req = (id: string, text: string, at: number) => ({ id, text, meetingId: 'x', at });
const meeting = (id: string, at: number, reqs: string[], extra: Partial<Meeting> = {}): Meeting =>
  ({ id, at, text: '', todos: [], changes: [], source: 'rules', requirements: reqs.map((t, i) => req(`${id}${i}`, t, at)), ...extra });

describe('requirement memory', () => {
  it('merges the same topic across meetings, newest wording on top', () => {
    const m = buildMemory([meeting('a', 1, ['方法对比要同时看准确率和速度', '组会 PPT 不要超过 8 页']), meeting('b', 2, ['方法对比只看准确率就行'])]);
    expect(m).toHaveLength(2);
    const topic = m.find(s => s.now.text.includes('只看准确率'))!;
    expect(topic.before.map(r => r.text)).toEqual(['方法对比要同时看准确率和速度']);
    expect(topic.state).toBe('有效');
  });
  it('an unsettled change keeps the topic 待确认', () => {
    const b = meeting('b', 2, ['方法对比只看准确率就行']);
    b.changes = [{ kind: '改变', now: b.requirements[0], before: req('a0', '方法对比要同时看准确率和速度', 1), settled: false }];
    expect(buildMemory([meeting('a', 1, ['方法对比要同时看准确率和速度']), b])[0].state).toBe('待确认');
  });
  it('finds the requirements that bear on a piece of work', () => {
    const m = buildMemory([meeting('a', 1, ['方法对比要同时看准确率和速度', '组会 PPT 不要超过 8 页'])]);
    expect(relevant(m, '把三篇论文的方法对比做出来')[0].now.text).toContain('准确率');
  });
});

describe('gap questions', () => {
  it('a vague ask gets at most two questions, the costliest first', () => {
    const r = chooseQuestions('把这几个方法对比一下', []);
    expect(r.ask.length).toBeLessThanOrEqual(2);
    expect(r.ask[0].slot).toBe('按什么标准');
    expect(askLine(r.ask)).toMatch(/^老师，我想确认一下：1\. /);
  });
  it('a clear ask asks nothing', () => {
    const r = chooseQuestions('下周三前把三篇论文按准确率和速度做成一张对比表', []);
    expect(r.ask).toEqual([]);
  });
  it('what the advisor already settled is filled from memory, not asked again', () => {
    const memory = buildMemory([meeting('a', 1, ['方法对比要同时看准确率和速度'])]);
    const r = chooseQuestions('把这几个方法对比一下', memory);
    expect(r.ask.map(g => g.slot)).not.toContain('按什么标准');
    expect(r.filled.find(g => g.slot === '按什么标准')?.filledBy?.now.text).toContain('准确率和速度');
  });
  it('a requirement still 待确认 does not count as settled', () => {
    const b = meeting('b', 2, ['方法对比只看准确率就行']);
    b.changes = [{ kind: '改变', now: b.requirements[0], settled: false }];
    const memory = buildMemory([b]);
    expect(chooseQuestions('把这几个方法对比一下', memory).ask[0].slot).toBe('按什么标准');
  });
  it('slots the work does not need are never asked', () => {
    expect(ruleMissing('今晚把 PPT 发群里')['材料在哪']).toBe(0);
  });
  it('model gap estimates go through the same chooser; with no key the rules answer', async () => {
    const r = await findGaps('把这几个方法对比一下', [], { kv: memoryKV() });
    expect(r.source).toBe('rules');
    expect(r.value.ask.length).toBeGreaterThan(0);
  });
});

describe('rehearsal', () => {
  const d = demoData(now);
  const memory = buildMemory(d.meetings);
  it('learns the advisor\'s usual questions from past meetings', () => {
    expect(habits(d.meetings)[0]).toMatchObject({ kind: '为什么', count: 2 });
  });
  it('asks about earlier requirements on this work first, then habits', () => {
    const p = ruleProbes('三篇论文方法对比的结果', memory, d.meetings);
    expect(p[0].question).toMatch(/我之前说过「/);
    expect(p.some(x => /为什么/.test(x.question))).toBe(true);
    expect(p.length).toBeLessThanOrEqual(4);
  });
  it('feedback names the required words an answer leaves out', () => {
    const p = { question: 'q', why: '', keys: ['准确率', '速度'] };
    expect(ruleFeedback(p, '我做了一张表，比较了三种方法的准确率')).toContain('速度');
    expect(ruleFeedback(p, '准确率和速度都比了，B 最快 A 最准')).toContain('覆盖');
  });
  it('works offline', async () => {
    const r = await rehearse('三篇论文方法对比', memory, d.meetings, { kv: memoryKV() });
    expect(r.source).toBe('rules'); expect(r.value.length).toBeGreaterThan(0);
  });
});
