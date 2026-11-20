// Simulation for plan §7.2 (synthetic students, not real users): does timetable-aware scheduling finish more tasks on
// time than a fixed "three days before, 9 a.m." reminder? Both policies get the same students, the same chance of
// ignoring a reminder and the same rule that a reminder during class is missed. Deterministic for a given seed.
import { freeTime, type Interval } from './schedule';
import type { Busy } from './types';

const MIN = 60_000, DAY = 86_400_000;
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pad = (n: number) => String(n).padStart(2, '0');

interface Student { timetable: Busy[]; trueMinutes: number; due: number }
function student(r: () => number, now: number): Student {
  const timetable: Busy[] = [];
  for (let d = 1; d <= 5; d++) for (const h of [8, 10, 14, 16, 19]) if (r() < 0.55) timetable.push({ day: d, start: `${pad(h)}:00`, end: `${pad(h + 1)}:40` });
  const steps = 3 + Math.floor(r() * 3);
  let est = 0; for (let i = 0; i < steps; i++) est += 20 + Math.floor(r() * 100);
  const pace = 0.7 + r() * 1.3; // true speed vs the estimate
  return { timetable, trueMinutes: Math.round(est * pace), due: now + (4 + Math.floor(r() * 7)) * DAY };
}

type Policy = (s: Student, t: number, free: Interval[]) => number;
/** Ours: the start of the next free slot. */
const ours: Policy = (_s, t, free) => free.find(f => f.end > t + 25 * MIN)?.start ?? t + DAY;
/** Baseline: 9 a.m. from three days before the deadline, then every day at 9 a.m. */
const fixed: Policy = (s, t) => { const d = new Date(Math.max(t, s.due - 3 * DAY)); d.setHours(9, 0, 0, 0); return d.getTime() < t ? d.getTime() + DAY : d.getTime(); };

function run(s: Student, now: number, policy: Policy, r: () => number, ignore: number, cap: number) {
  const free = freeTime(s.timetable, now, now + 60 * DAY);
  let t = now, left = s.trueMinutes, sent = 0, inClass = 0, finish = Infinity;
  while (left > 0 && t < now + 60 * DAY) {
    const at = Math.max(policy(s, t, free), t); sent++;
    const slot = free.find(f => f.start <= at && at < f.end);
    if (!slot) { inClass++; t = at + MIN; continue; }
    if (r() < ignore) { t = slot.end; continue; }
    const dayEnd = new Date(at); dayEnd.setHours(23, 59, 0, 0);
    let budget = cap;
    for (const f of free) {
      if (f.end <= at || f.start > dayEnd.getTime() || budget <= 0 || left <= 0) continue;
      const from = Math.max(f.start, at), take = Math.min(budget, left, (f.end - from) / MIN);
      left -= take; budget -= take; finish = from + take * MIN;
    }
    t = dayEnd.getTime() + MIN;
  }
  return { onTime: left <= 0 && finish <= s.due, sent, inClass };
}

export interface SimResult { policy: string; onTimeRate: number; inClassRate: number }
export function simulate(n = 300, seed = 20261120, ignore = 0.3, cap = 120): SimResult[] {
  const now = new Date(2026, 10, 23, 7, 0).getTime(); // a Monday morning
  return ([['按课表倒排', ours], ['截止前三天 9 点提醒', fixed]] as const).map(([name, p]) => {
    const r = rng(seed), act = rng(seed + 1);
    let on = 0, sent = 0, inClass = 0;
    for (let i = 0; i < n; i++) { const o = run(student(r, now), now, p, act, ignore, cap); on += +o.onTime; sent += o.sent; inClass += o.inClass; }
    return { policy: name, onTimeRate: on / n, inClassRate: sent ? inClass / sent : 0 };
  });
}
