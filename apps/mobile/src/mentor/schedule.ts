// The self-developed algorithm: timetable-aware adaptive scheduling for undergraduates.
// 1. Free time = the day window minus the weekly timetable, without slivers too short to start anything.
// 2. Forward plan: each remaining step goes into the earliest free time, at most `dailyCap` minutes a day,
//    so the student gets a concrete "do it then" and a reminder at the start of that free slot (never in class).
// 3. Backward plan: the same steps packed against the deadline give each step its latest start; the gap between
//    the two is the slack. No room even backwards means the plan is short of time, said before the deadline.
// 4. Pace: steps the student ticks off with real minutes give a personal speed factor (EWMA) for what is left.
// Every rule is plain arithmetic, so it can be worked through by hand.
import type { Busy, Step } from './types';

export interface Interval { start: number; end: number }
export interface Window { dayStart: string; dayEnd: string; minMinutes: number }
export const DEFAULT_WINDOW: Window = { dayStart: '08:00', dayEnd: '23:00', minMinutes: 25 };
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`时间格式应为 HH:MM: ${s}`);
  return (Number(m[1]) * 60 + Number(m[2])) * MIN;
}
function midnight(t: number): number { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

/** Removes [cut.start, cut.end) from every interval in `xs`. */
function subtract(xs: Interval[], cut: Interval): Interval[] {
  return xs.flatMap(x => {
    if (cut.end <= x.start || cut.start >= x.end) return [x];
    const out: Interval[] = [];
    if (cut.start > x.start) out.push({ start: x.start, end: cut.start });
    if (cut.end < x.end) out.push({ start: cut.end, end: x.end });
    return out;
  });
}

/** Free intervals between `from` and `to`, given the weekly timetable and one-off busy intervals. */
export function freeTime(timetable: Busy[], from: number, to: number, w: Window = DEFAULT_WINDOW, extra: Interval[] = []): Interval[] {
  const out: Interval[] = [];
  for (let day = midnight(from); day < to; day += DAY) {
    const base = midnight(day + DAY / 2); // safe across a clock change
    let pieces: Interval[] = [{ start: Math.max(base + hm(w.dayStart), from), end: Math.min(base + hm(w.dayEnd), to) }];
    const wd = new Date(base).getDay();
    for (const b of timetable) if (b.day === wd) pieces = subtract(pieces, { start: base + hm(b.start), end: base + hm(b.end) });
    for (const e of extra) pieces = subtract(pieces, e);
    out.push(...pieces.filter(p => p.end - p.start >= w.minMinutes * MIN));
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Personal speed: actual / planned minutes over finished steps, newest weighted most (EWMA), kept within [0.5, 3]. */
export function paceFactor(steps: Step[], alpha = 0.5): number {
  const done = steps.filter(s => s.done && s.actualMinutes && s.minutes > 0).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  let p = 1;
  for (const s of done) p = alpha * (s.actualMinutes! / s.minutes) + (1 - alpha) * p;
  return Math.min(3, Math.max(0.5, p));
}

export interface Placed { stepId: string; pieces: Interval[]; remind: number }
export interface Plan {
  placed: Placed[];
  /** Latest start per step so the whole task still ends by the deadline; missing when even that is impossible. */
  latestStart: Record<string, number>;
  /** Minutes the forward plan runs past the deadline (0 = it fits). */
  shortMinutes: number;
  /** Hours between the planned start of the next step and its latest start. */
  slackHours: number | null;
  pace: number;
}

/** Fills `need` minutes from the earliest free time, honouring a per-day cap. Mutates `used` (minutes per day). */
function takeForward(free: Interval[], need: number, used: Map<number, number>, cap: number): { pieces: Interval[]; left: number } {
  const pieces: Interval[] = [];
  let left = need;
  for (const f of free) {
    if (left <= 0) break;
    const day = midnight(f.start);
    const room = Math.min(cap - (used.get(day) ?? 0), (f.end - f.start) / MIN);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    pieces.push({ start: f.start, end: f.start + take * MIN });
    used.set(day, (used.get(day) ?? 0) + take);
    left -= take;
    f.start += take * MIN; // the rest of this free slot stays free for the next step
  }
  return { pieces, left };
}

/** Packs steps backwards against the deadline; returns each step's latest start, or null when it cannot fit. */
function latestStarts(free: Interval[], steps: { id: string; need: number }[], deadline: number): Record<string, number> | null {
  const slots = free.filter(f => f.start < deadline).map(f => ({ start: f.start, end: Math.min(f.end, deadline) })).reverse();
  const out: Record<string, number> = {};
  let i = 0;
  for (const s of [...steps].reverse()) {
    let left = s.need;
    while (left > 0) {
      const f = slots[i];
      if (!f) return null;
      const take = Math.min(left, (f.end - f.start) / MIN);
      f.end -= take * MIN; left -= take;
      if (f.end - f.start <= 0) i++;
      out[s.id] = f.end;
    }
  }
  return out;
}

export interface PlanInput { steps: Step[]; due: number; now: number; timetable: Busy[]; window?: Window; dailyCap?: number; remindBeforeMin?: number }

export function planTask({ steps, due, now, timetable, window = DEFAULT_WINDOW, dailyCap = 120, remindBeforeMin = 10 }: PlanInput): Plan {
  const pace = paceFactor(steps);
  const todo = steps.filter(s => !s.done).map(s => ({ id: s.id, need: Math.ceil(s.minutes * pace) }));
  const horizon = Math.max(due, now) + 14 * DAY; // look past the deadline so a late plan still says when it ends
  const free = freeTime(timetable, now, horizon, window);
  const used = new Map<number, number>();
  const placed: Placed[] = [];
  let end = now;
  for (const s of todo) {
    const { pieces } = takeForward(free, s.need, used, dailyCap);
    if (pieces.length) end = pieces[pieces.length - 1].end;
    placed.push({ stepId: s.id, pieces, remind: pieces.length ? Math.max(now, pieces[0].start - remindBeforeMin * MIN) : now });
  }
  const latest = latestStarts(freeTime(timetable, now, due, window), todo, due) ?? {};
  const first = placed[0]?.pieces[0];
  const slackHours = first && latest[todo[0].id] !== undefined ? Math.round((latest[todo[0].id] - first.start) / 3_600_000) : null;
  return { placed, latestStart: latest, shortMinutes: end > due ? Math.round((end - due) / MIN) : 0, slackHours, pace };
}

/** Common free time for an advisor and several students: the first three slots of at least `minMinutes` within `days` days. */
export function commonSlots(people: Busy[][], from: number, days = 7, minMinutes = 60, w: Window = DEFAULT_WINDOW): Interval[] {
  const to = from + days * DAY;
  let shared = freeTime(people[0] ?? [], from, to, w);
  for (const p of people.slice(1)) {
    const theirs = freeTime(p, from, to, w);
    shared = shared.flatMap(a => theirs.map(b => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) }))).filter(x => x.end > x.start);
  }
  return shared.filter(x => x.end - x.start >= minMinutes * MIN)
    .sort((a, b) => a.start - b.start).slice(0, 3);
}
