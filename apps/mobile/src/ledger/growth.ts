// 成长空间 (owner 2026-11-17, 板块修改总结; the 生活 board renamed and narrowed to studying): deadlines that pull a
// course's debts in front of them, broken into small steps the user confirms, focus sessions that end in 讲给我听, and a
// weekly growth report. It books no debts of its own. Kept on this phone in its own key; nothing here is chat.
import type { KV } from '../storage/kv';
import { addDays, type Entry } from './ledger';
import { monday } from './life';

export const DEADLINE_KINDS = ['作业', '实验报告', '考试', '组会', '其他'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export interface Step { text: string; done?: boolean }
export interface Deadline { id: string; title: string; course: string; kind: DeadlineKind; on: string; done?: string; steps?: Step[] }
export interface Focus { on: string; minutes: number; repaid: boolean }
export interface Growth { deadlines: Deadline[]; focus: Focus[] }

const KEY = 'growth.v1';
export const FOCUS_MINUTES = 25;
/** An exam or group meeting this close pulls its course's debts in front of it (same window as frontLoad). */
export const PULL_WINDOW_DAYS = 7;

export class GrowthBook {
  constructor(private kv: KV) {}
  async get(): Promise<Growth> {
    const g = JSON.parse((await this.kv.get(KEY)) ?? '{}') as Partial<Growth>;
    return { deadlines: g.deadlines ?? [], focus: g.focus ?? [] };
  }
  private async edit(f: (g: Growth) => void): Promise<Growth> {
    const g = await this.get(); f(g);
    await this.kv.set(KEY, JSON.stringify(g));
    return g;
  }

  async addDeadline(d: Deadline): Promise<Growth> {
    const title = d.title.trim();
    if (!title || !d.on) return this.get();
    return this.edit(g => { g.deadlines = [...g.deadlines.filter(x => x.id !== d.id), { ...d, title, course: d.course.trim() }]; });
  }
  async finish(id: string, today: string): Promise<Growth> { return this.edit(g => { g.deadlines = g.deadlines.map(d => d.id === id ? { ...d, done: today } : d); }); }
  /** 任务拆解: the small steps the user confirmed (written only after they press 写进去). */
  async setSteps(id: string, steps: Step[]): Promise<Growth> { return this.edit(g => { g.deadlines = g.deadlines.map(d => d.id === id ? { ...d, steps } : d); }); }
  async toggleStep(id: string, i: number): Promise<Growth> {
    return this.edit(g => { const d = g.deadlines.find(x => x.id === id); const st = d?.steps?.[i]; if (st) st.done = !st.done; });
  }
  async removeDeadline(id: string): Promise<Growth> { return this.edit(g => { g.deadlines = g.deadlines.filter(d => d.id !== id); }); }
  async focused(today: string, minutes: number): Promise<Growth> { return this.edit(g => { g.focus = [...g.focus, { on: today, minutes, repaid: false }]; }); }
  /** The latest focus session today that has not yet led to a repayment now has. */
  async repaidAfterFocus(today: string): Promise<Growth> {
    return this.edit(g => { const f = [...g.focus].reverse().find(x => x.on === today && !x.repaid); if (f) f.repaid = true; });
  }
}

// ---- rules ------------------------------------------------------------------------------------------------
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Open deadlines from today on, nearest first, with days left. */
export function upcoming(ds: Deadline[], today: string): (Deadline & { left: number })[] {
  return ds.filter(d => !d.done && d.on >= today).map(d => ({ ...d, left: daysBetween(today, d.on) }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** The nearest exam or group meeting per course inside the pull window: the day that course's debts must come before. */
export function pullDays(ds: Deadline[], today: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of upcoming(ds, today)) {
    if ((d.kind === '考试' || d.kind === '组会') && d.course && d.left > 0 && d.left <= PULL_WINDOW_DAYS && !out.has(d.course)) out.set(d.course, d.on);
  }
  return out;
}

/** 那年今日: a debt explained well exactly a month ago, to look at again. */
export function monthAgo(es: Entry[], today: string): Entry | null {
  const then = addDays(today, -30);
  return es.find(e => !e.dropped && e.board !== '生活' && (e.tries ?? []).some(t => t.ok && t.on === then)) ?? null;
}

export const STEP_MAX = 6;
const STEP_LEN = 40;
/** Steps out of free text (the user's own or a model's): one a line, bullets and numbers taken off, at most STEP_MAX. */
export function parseSteps(text: string): Step[] {
  return text.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•·]|\d+[.、)）]|[（(]?\d+[)）])\s*/, '').trim().slice(0, STEP_LEN))
    .filter(Boolean).slice(0, STEP_MAX).map(text => ({ text }));
}

/** What the model is asked when the user wants a deadline broken down; it suggests, the user edits and confirms. */
export const SPLIT_SYSTEM = '把用户给的一项学习任务拆成 3 到 5 个能在一次坐下完成的小步骤，按先后排。每行一个步骤，不编号，每步不超过 20 个字，' +
  '只写要做的事，不写答案或内容本身。';

export interface GrowthWeek {
  from: string; to: string;
  /** Debts explained well this week, and debts booked. */ repaid: number; booked: number;
  /** Of the debts booked, how many with the user's own idea written first (先想). */ thoughtFirst: number;
  focus: number; focusRepaid: number; due: number; done: number;
  /** 下周待办: deadlines and debts due next Monday to Sunday. */ nextDeadlines: number; nextDebts: number;
}

/** 成长周报: this Monday to Sunday — real progress (explained well, booked, thought first), focus, deadlines met, next week. */
export function growthWeek(g: Growth, es: Entry[], today: string): GrowthWeek {
  const from = monday(today), to = addDays(from, 6), next = addDays(from, 7), nextEnd = addDays(from, 13);
  const inWeek = (d: string) => d >= from && d <= to;
  const study = es.filter(e => e.board !== '生活' && !e.dropped);
  const booked = study.filter(e => inWeek(e.createdOn));
  const f = g.focus.filter(x => inWeek(x.on));
  const ds = g.deadlines.filter(d => inWeek(d.on));
  return {
    from, to,
    repaid: study.filter(e => (e.tries ?? []).some(t => t.ok && inWeek(t.on))).length,
    booked: booked.length,
    thoughtFirst: booked.filter(e => e.ownIdea.trim() || e.helpLevel === 'own').length,
    focus: f.length, focusRepaid: f.filter(x => x.repaid).length,
    due: ds.length, done: ds.filter(d => d.done).length,
    nextDeadlines: g.deadlines.filter(d => !d.done && d.on >= next && d.on <= nextEnd).length,
    nextDebts: study.filter(e => e.dueOn && e.dueOn >= next && e.dueOn <= nextEnd).length,
  };
}
