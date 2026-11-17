// 按课表推送 (plan 2.4 ⑦): due debts come up gently at the user's free times, never in class or at night. At most one
// debt per time slot and two a day; 生活 never pushes. Worked out on the phone from the book; nothing leaves it.
import { addDays, type Entry } from '../ledger/ledger';
import { tr } from '../i18n';

export const MAX_A_DAY = 2;
const NIGHT_FROM = '22:00', MORNING = '07:00';

export interface Reminder { id: number; entryId: string; at: string; title: string; body: string } // at = local "YYYY-MM-DDTHH:MM"

/** Red first, then the earlier due day, so the debt that matters most comes up first. */
const order = (a: Entry, b: Entry) => Number(Boolean(b.red)) - Number(Boolean(a.red)) || (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : 0);
const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * The next `days` of reminders from `now` (local "YYYY-MM-DDTHH:MM"): each slot of each day takes the first debt due by
 * then that no earlier slot took, up to MAX_A_DAY a day. Debts repaid by an exam (结论债) are left out: no phone talk repays them.
 */
export function planReminders(entries: Entry[], slots: string[], now: string, days = 7): Reminder[] {
  const day0 = now.slice(0, 10);
  const times = [...new Set(slots)].filter((t) => t >= MORNING && t < NIGHT_FROM).sort();
  const pool = entries.filter((e) => e.dueOn && e.board !== '生活' && e.kind !== 'conclusion' && !e.dropped).sort(order);
  const taken = new Set<string>();
  const out: Reminder[] = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(day0, d);
    let today = 0;
    for (const t of times) {
      const at = `${day}T${t}`;
      if (at <= now || today >= MAX_A_DAY) continue;
      const e = pool.find((x) => !taken.has(x.id) && x.dueOn! <= day);
      if (!e) break;
      taken.add(e.id); today += 1;
      out.push({ id: out.length + 1, entryId: e.id, at, title: e.kind === 'citation' ? '找一找原文？' : '这个你给我讲讲？', body: clip(e.question) });
    }
  }
  return out;
}

/** Deadline reminders get ids from here up, so they never collide with debt reminders or the focus alarm. */
export const DEADLINE_ID = 910000;
type Due = { id: string; title: string; on: string; done?: string; steps?: { done?: boolean }[] };

/**
 * 温和提醒 (成长空间): one note the day before each open deadline within `days`, at the last free time of that day, never
 * at night. It says what is left of the steps, so the evening before is a small to-do, not an alarm.
 */
export function deadlineReminders(ds: Due[], slots: string[], now: string, days = 14): Reminder[] {
  const t = [...new Set(slots)].filter((x) => x >= MORNING && x < NIGHT_FROM).sort().pop() ?? '19:00';
  const last = addDays(now.slice(0, 10), days);
  return ds.filter((d) => !d.done && d.on <= last).flatMap((d, i) => {
    const at = `${addDays(d.on, -1)}T${t}`;
    if (at <= now) return [];
    const left = (d.steps ?? []).filter((s) => !s.done).length;
    return [{ id: DEADLINE_ID + i, entryId: '', at, title: tr('明天截止：{0}', clip(d.title || tr('未命名'), 16)),
      body: left ? tr('还剩 {0} 个小步骤，今晚做一个就好。', left) : tr('今晚花几分钟看一眼就好。') }];
  });
}
