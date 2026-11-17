// 大学学习生活 (replaces the old 生活 board, owner 2026-11-17): the campus side of studying, all feeding the same 认知债
// ledger. Courses and their weekly classes, deadlines (assignments, lab reports, exams, group meetings), focus sessions
// that end in a repayment, and how the day feels. Kept on this phone in its own key; nothing here is chat.
import type { KV } from '../storage/kv';
import { addDays, type Entry } from './ledger';
import { monday } from './life';

export interface Slot { dow: number; start: string; end: string; place?: string } // dow 1 = Monday … 7 = Sunday
export interface Course { id: string; name: string; slots: Slot[] }
export const DEADLINE_KINDS = ['作业', '实验报告', '考试', '组会', '其他'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export interface Deadline { id: string; title: string; course: string; kind: DeadlineKind; on: string; done?: string }
export interface Focus { on: string; minutes: number; repaid: boolean }
export type Energy = 'high' | 'mid' | 'low';
export interface Campus { courses: Course[]; deadlines: Deadline[]; focus: Focus[]; energy?: { on: string; level: Energy } }

const KEY = 'campus.v1';
const EMPTY: Campus = { courses: [], deadlines: [], focus: [] };
export const FOCUS_MINUTES = 25;
/** An exam or group meeting this close pulls its course's debts in front of it. */
export const PULL_WINDOW_DAYS = 7;

export class CampusBook {
  constructor(private kv: KV) {}
  async get(): Promise<Campus> { return { ...EMPTY, ...(JSON.parse((await this.kv.get(KEY)) ?? '{}') as Partial<Campus>) }; }
  private async put(c: Campus): Promise<Campus> { await this.kv.set(KEY, JSON.stringify(c)); return c; }
  async edit(f: (c: Campus) => void): Promise<Campus> { const c = await this.get(); f(c); return this.put(c); }

  async saveCourse(course: Course): Promise<Campus> {
    const name = course.name.trim();
    if (!name) return this.get();
    return this.edit(c => { c.courses = [...c.courses.filter(x => x.id !== course.id), { ...course, name }]; });
  }
  async removeCourse(id: string): Promise<Campus> { return this.edit(c => { c.courses = c.courses.filter(x => x.id !== id); }); }
  async addDeadline(d: Deadline): Promise<Campus> {
    if (!d.title.trim() || !d.on) return this.get();
    return this.edit(c => { c.deadlines = [...c.deadlines.filter(x => x.id !== d.id), { ...d, title: d.title.trim() }]; });
  }
  async finish(id: string, today: string): Promise<Campus> { return this.edit(c => { c.deadlines = c.deadlines.map(d => d.id === id ? { ...d, done: today } : d); }); }
  async removeDeadline(id: string): Promise<Campus> { return this.edit(c => { c.deadlines = c.deadlines.filter(d => d.id !== id); }); }
  async focused(today: string, minutes: number): Promise<Campus> { return this.edit(c => { c.focus = [...c.focus, { on: today, minutes, repaid: false }]; }); }
  async repaidAfterFocus(today: string): Promise<Campus> {
    return this.edit(c => { const f = [...c.focus].reverse().find(x => x.on === today && !x.repaid); if (f) f.repaid = true; });
  }
  async setEnergy(today: string, level: Energy): Promise<Campus> { return this.edit(c => { c.energy = { on: today, level }; }); }
}

// ---- rules ------------------------------------------------------------------------------------------------
export const dowOf = (day: string): number => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Today's classes in time order. */
export function classesOn(courses: Course[], day: string): { course: string; slot: Slot }[] {
  const d = dowOf(day);
  return courses.flatMap(c => c.slots.filter(s => s.dow === d).map(slot => ({ course: c.name, slot })))
    .sort((a, b) => a.slot.start.localeCompare(b.slot.start));
}

/** The class on now, or the one that ended in the last 90 minutes: what 课堂快记 is most likely about. */
export function classNow(courses: Course[], day: string, hhmm: string): { course: string; slot: Slot } | null {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const now = mins(hhmm);
  const hit = classesOn(courses, day).filter(x => mins(x.slot.start) <= now && now <= mins(x.slot.end) + 90);
  return hit.length ? hit[hit.length - 1] : null;
}

/** Open deadlines from today on, nearest first, with days left. */
export function upcoming(ds: Deadline[], today: string): (Deadline & { left: number })[] {
  return ds.filter(d => !d.done && d.on >= today).map(d => ({ ...d, left: daysBetween(today, d.on) }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** The nearest exam or group meeting per course inside the pull window: the day that course's debts must come before. */
export function pullDays(ds: Deadline[], today: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of upcoming(ds, today)) {
    if ((d.kind === '考试' || d.kind === '组会') && d.left <= PULL_WINDOW_DAYS && d.left > 0 && d.course && !out.has(d.course)) out.set(d.course, d.on);
  }
  return out;
}

/** How many debts to suggest today, and one thing that takes a minute, from how the day feels. No diagnosis. */
export function planFor(level: Energy | undefined): { count: number; minute: string } {
  if (level === 'high') return { count: 3, minute: '先讲最难的那一笔，趁现在脑子清楚。' };
  if (level === 'low') return { count: 1, minute: '只看一眼今天要讲的那题，闭上眼想一分钟它的答案，然后去休息。' };
  return { count: 2, minute: '挑最短的一笔，先讲一分钟热热身。' };
}

/** 那年今日: a debt explained well exactly a month ago, to look at again. */
export function monthAgo(es: Entry[], today: string): Entry | null {
  const then = addDays(today, -30);
  return es.find(e => !e.dropped && e.board !== '生活' && (e.tries ?? []).some(t => t.ok && t.on === then)) ?? null;
}

/** This week on campus: focus sessions and how many ended in a repayment, deadlines met. */
export function campusWeek(c: Campus, today: string): { focus: number; focusRepaid: number; done: number; due: number } {
  const from = monday(today), to = addDays(from, 6);
  const f = c.focus.filter(x => x.on >= from && x.on <= to);
  const ds = c.deadlines.filter(d => d.on >= from && d.on <= to);
  return { focus: f.length, focusRepaid: f.filter(x => x.repaid).length, done: ds.filter(d => d.done).length, due: ds.length };
}
