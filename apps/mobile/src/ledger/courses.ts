// 学习 by course (and 科研 by paper or project): the debts grouped by the topic they were booked under, so the home can
// say "高数 3 笔还没讲" instead of one number for everything.
import { statusOf, type Entry } from './ledger';

export interface Course { topic: string; total: number; open: number; red: number; clear: number }
export const NO_TOPIC = '没写课程';

/** One row per topic on this board, the most owed first; `clear` counts debts explained or never borrowed. */
export function courses(es: Entry[], board: Entry['board']): Course[] {
  const by = new Map<string, Course>();
  for (const e of es) {
    if (e.board !== board) continue;
    const topic = e.topic.trim() || NO_TOPIC;
    const c = by.get(topic) ?? { topic, total: 0, open: 0, red: 0, clear: 0 };
    const s = statusOf(e.passes, e.attempts, e.weight);
    c.total += 1;
    if (s === 'own' || s === 'settled') c.clear += 1; else c.open += 1;
    if (e.red && s !== 'settled') c.red += 1;
    by.set(topic, c);
  }
  return [...by.values()].sort((a, b) => b.open - a.open || b.red - a.red || a.topic.localeCompare(b.topic, 'zh'));
}

/** Topics already used on this board, most recent first, for the quick chips when booking. */
export function recentTopics(es: Entry[], board: Entry['board'], max = 6): string[] {
  const seen: string[] = [];
  for (const e of [...es].reverse()) {
    const t = e.topic.trim();
    if (e.board === board && t && !seen.includes(t)) seen.push(t);
    if (seen.length >= max) break;
  }
  return seen;
}
