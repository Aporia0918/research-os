import { describe, expect, it } from 'vitest';
import { commonSlots, freeTime, hm, paceFactor, planTask } from '../src/mentor/schedule';
import { parseSteps, ruleBreakdown, selfCheck, titleOf } from '../src/mentor/breakdown';
import { compareRequirements, ownerOf, parseDue, ruleClassify, ruleRequirements, ruleTodos, splitLines } from '../src/mentor/meeting';
import { advisorOwes, overviewHtml, rows } from '../src/mentor/overview';
import { DEMO_NOTES, DEMO_TIMETABLE, demoData } from '../src/mentor/demo';
import { draftBreakdown, readMeeting, helpMessage } from '../src/mentor/ai';
import { simulate } from '../src/mentor/sim';
import { memoryKV } from '../src/storage/kv';
import type { Busy, Step } from '../src/mentor/types';

const MIN = 60_000;
const mon = new Date(2026, 10, 23, 7, 0).getTime(); // Monday 23 Nov 2026, 07:00 local
const at = (d: number, h: number, m = 0) => new Date(2026, 10, 23 + d, h, m).getTime();
const s = (minutes: number, extra: Partial<Step> = {}): Step => ({ id: `s${Math.random()}`, title: 't', output: 'o', minutes, done: false, ...extra });

describe('free time', () => {
  it('cuts classes out of the day window and drops slivers', () => {
    const tt: Busy[] = [{ day: 1, start: '08:00', end: '09:40' }, { day: 1, start: '10:00', end: '11:40' }];
    const f = freeTime(tt, at(0, 0), at(1, 0));
    expect(f[0].start).toBe(at(0, 11, 40)); // 09:40–10:00 is 20 min, under the 25-min floor
    expect(f[0].end).toBe(at(0, 23));
  });
  it('parses HH:MM', () => { expect(hm('9:05')).toBe(545 * MIN); expect(() => hm('nine')).toThrow(); });
});

describe('planTask', () => {
  it('never reminds during class and spreads work under the daily cap', () => {
    const p = planTask({ steps: [s(30), s(120), s(60)], due: at(4, 23, 59), now: mon, timetable: DEMO_TIMETABLE });
    const free = freeTime(DEMO_TIMETABLE, mon, at(14, 0));
    for (const x of p.placed) expect(free.some(f => f.start <= x.remind + 10 * MIN && x.remind + 10 * MIN < f.end)).toBe(true);
    const perDay = new Map<number, number>();
    for (const x of p.placed) for (const q of x.pieces) { const d = new Date(q.start).getDate(); perDay.set(d, (perDay.get(d) ?? 0) + (q.end - q.start) / MIN); }
    for (const v of perDay.values()) expect(v).toBeLessThanOrEqual(120);
    expect(p.shortMinutes).toBe(0);
    expect(p.slackHours).toBeGreaterThan(0);
  });
  it('says how short a plan is when the deadline is too close', () => {
    const p = planTask({ steps: [s(400), s(400)], due: at(0, 23, 59), now: mon, timetable: DEMO_TIMETABLE });
    expect(p.shortMinutes).toBeGreaterThan(0);
    expect(Object.keys(p.latestStart)).toHaveLength(0);
  });
  it('slows the rest of the plan for a student who runs slow', () => {
    const steps = [s(60, { done: true, actualMinutes: 120, doneAt: 1 }), s(60)];
    expect(paceFactor(steps)).toBeCloseTo(1.5);
    const p = planTask({ steps, due: at(6, 23), now: mon, timetable: [] });
    const minutes = p.placed[0].pieces.reduce((a, q) => a + (q.end - q.start) / MIN, 0);
    expect(minutes).toBe(90);
  });
  it('latest starts pack against the deadline in order', () => {
    const steps = [s(60), s(60)];
    const p = planTask({ steps, due: at(0, 23), now: mon, timetable: [], dailyCap: 600 });
    expect(p.latestStart[steps[1].id]).toBe(at(0, 22));
    expect(p.latestStart[steps[0].id]).toBe(at(0, 21));
  });
  it('finds a common meeting slot outside everyone\'s classes', () => {
    const a: Busy[] = [{ day: 1, start: '08:00', end: '12:00' }], b: Busy[] = [{ day: 1, start: '13:00', end: '18:00' }];
    const [first] = commonSlots([a, b], mon, 1);
    expect(first).toEqual({ start: at(0, 12), end: at(0, 13) });
  });
});

describe('breakdown', () => {
  it('templates pass the rule gate', () => {
    for (const ask of ['读三篇论文', '复现代码', '准备组会 PPT', '做实验', '随便什么事']) expect(selfCheck(ruleBreakdown(ask)).ok).toBe(true);
  });
  it('the gate names each problem', () => {
    const r = selfCheck([{ title: '读', output: '', minutes: 60 }, { title: '', output: 'x', minutes: 0 }], 30);
    expect(r.problems.join('|')).toMatch(/3 到 7.*没有写交什么.*没有内容.*没有预计时长.*第一步超过 30 分钟.*截止前只有 30 分钟/);
  });
  it('reads a model reply and rejects junk', () => {
    expect(parseSteps('好的：[{"title":"读摘要","output":"清单","minutes":20}]')?.[0].minutes).toBe(20);
    expect(parseSteps('没有 JSON')).toBeNull();
    expect(titleOf('下周组会前把这三篇论文的方法对比做出来，越快越好')).toBe('下周组会前把这三篇论文的方法对比…');
  });
});

describe('meeting rules', () => {
  const meetingAt = at(0, 15); // Monday
  it('splits speakers', () => {
    expect(splitLines('老师：要做 A。也要 B。\n小林：好的').map(l => l.speaker)).toEqual(['导师', '导师', '学生']);
  });
  it('dates: weekday, next week, month-day', () => {
    expect(new Date(parseDue('周三之前', meetingAt)!).getDate()).toBe(25);
    expect(new Date(parseDue('下周三之前', meetingAt)!).getDate()).toBe(2);
    expect(new Date(parseDue('下周一', meetingAt)!).getDate()).toBe(30);
    expect(new Date(parseDue('12月5日', meetingAt)!).getDate()).toBe(5);
    expect(parseDue('有空再说', meetingAt)).toBeUndefined();
  });
  it('owners: advisor promises vs student jobs', () => {
    expect(ownerOf({ speaker: '导师', text: '我这周五前把数据集链接发你' })).toBe('导师');
    expect(ownerOf({ speaker: '导师', text: '你下周三之前把第四篇补进去' })).toBe('学生');
    expect(ownerOf({ speaker: '学生', text: '我周五前把结果发您' })).toBe('学生');
  });
  it('the demo notes give both sides\' to-dos and a requirement change', () => {
    const todos = ruleTodos(DEMO_NOTES, 'm1', meetingAt);
    expect(todos.filter(t => t.who === '导师').map(t => t.what)).toEqual(['我这周五前把数据集链接发你']);
    expect(todos.some(t => t.who === '学生' && /第四篇/.test(t.what))).toBe(true);
    const reqs = ruleRequirements(DEMO_NOTES, 'm1', meetingAt);
    const history = demoData(mon).meetings[0].requirements;
    const changes = compareRequirements(reqs, history);
    expect(changes.find(c => /准确率/.test(c.now.text))?.kind).toMatch(/改变|矛盾/);
  });
  it('four-way rules', () => {
    expect(ruleClassify('数据集用 CIFAR', '组会时间改到周四')).toBe('新增');
    expect(ruleClassify('不要用预训练模型', '用预训练模型初始化')).toBe('矛盾');
    expect(ruleClassify('方法对比只看准确率', '方法对比要看准确率和速度')).toBe('改变');
  });
});

describe('advisor overview', () => {
  it('one row per student, overdue counted, advisor promises listed, text escaped', () => {
    const d = demoData(mon);
    const r = rows(d.tasks, mon);
    expect(r.map(x => x.student)).toEqual(['小林', '小陈', '小王']);
    expect(r.find(x => x.student === '小王')!.overdue).toBe(1);
    const html = overviewHtml([...d.tasks, { ...d.tasks[0], student: '<b>', id: 'x' }], [{ ...d.meetings[0], todos: [{ id: 't', who: '导师', what: '发数据集', meetingId: 'm', done: false }] }], mon);
    expect(html).toContain('&lt;b&gt;'); expect(html).toContain('发数据集');
    expect(advisorOwes(d.meetings)).toEqual([]);
  });
});

describe('model calls fall back cleanly', () => {
  const kv = memoryKV();
  it('no key: rules, and the note says so', async () => {
    const b = await draftBreakdown('读三篇论文', 600, { kv });
    expect(b.source).toBe('rules'); expect(b.note).toMatch(/离线模板/);
    const m = await readMeeting(DEMO_NOTES, 'm1', mon, [], { kv });
    expect(m.source).toBe('rules'); expect(m.value.todos.length).toBeGreaterThan(0);
    const h = await helpMessage('复现代码', '配环境', '装 torch 报错', { kv });
    expect(h.value).toContain('装 torch 报错');
  });
});

describe('simulation (synthetic students)', () => {
  it('is deterministic and reports both policies', () => {
    const a = simulate(120), b = simulate(120);
    expect(a).toEqual(b);
    expect(a.map(x => x.policy)).toEqual(['按课表倒排', '截止前三天 9 点提醒']);
    expect(a[0].inClassRate).toBe(0);
    console.log('模拟结果（合成学生）', JSON.stringify(a));
  });
});
