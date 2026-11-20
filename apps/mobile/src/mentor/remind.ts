// Puts each task's next step on the phone as a local notification, at the start of the free slot the plan chose.
import { schedule } from '../remind/native';
import type { Reminder } from '../remind/plan';
import { planTask } from './schedule';
import type { MentorData } from './store';

const local = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function reminders(d: MentorData, now: number): Reminder[] {
  return d.tasks.filter(t => t.confirmed && t.student === d.me).flatMap((t, i) => {
    const p = planTask({ steps: t.steps, due: t.due, now, timetable: d.timetable });
    const next = p.placed[0], step = t.steps.find(s => s.id === next?.stepId);
    if (!next || !step || next.remind <= now) return [];
    return [{ id: 700000 + i, entryId: t.id, at: local(next.remind), title: '该做下一步了', body: `${t.title}：${step.title}（约 ${step.minutes} 分钟）` }];
  });
}
export async function syncReminders(d: MentorData): Promise<void> { await schedule(reminders(d, Date.now())); }
