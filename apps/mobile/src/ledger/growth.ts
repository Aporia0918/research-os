// 成长空间 (owner 2026-11-17; the 生活 board renamed and narrowed to studying): deadlines that pull a course's debts in
// front of them, focus sessions that end in 讲给我听, and a weekly growth report. The 主意账 (own decision vs handed to AI,
// ledger/life.ts) stays as the 认知债 line of this space. Kept on this phone in its own key; nothing here is chat.
import type { KV } from '../storage/kv';
import { addDays, type Entry } from './ledger';
import { monday, type Week } from './life';

export const DEADLINE_KINDS = ['作业', '实验报告', '考试', '组会', '其他'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export interface Deadline { id: string; title: string; course: string; kind: DeadlineKind; on: string; done?: string }
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

export interface GrowthWeek { from: string; to: string; repaid: number; booked: number; focus: number; focusRepaid: number; due: number; done: number; own: number; ai: number }

/** 成长周报: this Monday to Sunday — debts explained well and newly booked, focus sessions, deadlines met, and who made the calls. */
export function growthWeek(g: Growth, es: Entry[], decisions: Week, today: string): GrowthWeek {
  const from = monday(today), to = addDays(from, 6);
  const inWeek = (d: string) => d >= from && d <= to;
  const study = es.filter(e => e.board !== '生活');
  const f = g.focus.filter(x => inWeek(x.on));
  const ds = g.deadlines.filter(d => inWeek(d.on));
  return {
    from, to,
    repaid: study.filter(e => (e.tries ?? []).some(t => t.ok && inWeek(t.on))).length,
    booked: study.filter(e => inWeek(e.createdOn)).length,
    focus: f.length, focusRepaid: f.filter(x => x.repaid).length,
    due: ds.length, done: ds.filter(d => d.done).length,
    own: decisions.own, ai: decisions.ai,
  };
}
