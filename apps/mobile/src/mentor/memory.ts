// 导师要求账: every requirement the advisor has stated across group meetings, merged by topic, newest wording on
// top. A topic whose latest change is not yet settled by both sides is 待确认; anything else stands.
import { overlap } from './meeting';
import type { Meeting, Requirement } from './types';

export interface Standing {
  /** The advisor's latest words on this topic. */
  now: Requirement;
  /** Earlier wordings, newest first. */
  before: Requirement[];
  state: '有效' | '待确认';
}

const SAME_TOPIC = 0.34;

/** Merges requirements oldest → newest: a new one joins the topic it overlaps most (if any) and becomes its latest. */
export function buildMemory(meetings: Meeting[]): Standing[] {
  const pending = new Set(meetings.flatMap(m => m.changes.filter(c => !c.settled && (c.kind === '改变' || c.kind === '矛盾')).map(c => c.now.id)));
  const all = meetings.flatMap(m => m.requirements).sort((a, b) => a.at - b.at);
  const topics: Standing[] = [];
  for (const r of all) {
    const best = topics.map(t => ({ t, o: Math.max(overlap(r.text, t.now.text), overlap(t.now.text, r.text)) })).sort((a, b) => b.o - a.o)[0];
    if (best && best.o >= SAME_TOPIC) { best.t.before.unshift(best.t.now); best.t.now = r; }
    else topics.push({ now: r, before: [], state: '有效' });
  }
  for (const t of topics) t.state = pending.has(t.now.id) ? '待确认' : '有效';
  return topics.sort((a, b) => b.now.at - a.now.at);
}

/** Standing requirements that bear on a piece of work, most related first. */
export function relevant(memory: Standing[], text: string, min = 0.2): Standing[] {
  return memory.map(s => ({ s, o: Math.max(overlap(text, s.now.text), overlap(s.now.text, text)) }))
    .filter(x => x.o >= min).sort((a, b) => b.o - a.o).map(x => x.s);
}
