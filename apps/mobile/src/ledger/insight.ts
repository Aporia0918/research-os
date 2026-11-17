// What the ledger shows besides what is owed (plan 2.2 账本): the 今天 card, 思考结余 with its curve and streak, the
// 想法本 and the 每周账单. All of it is worked out from the entries on this phone; nothing new is stored.
import { addDays, statusOf, type Entry } from './ledger';
import { monday } from './life';

/** 进账: the user said their own idea first, or worked it out alone. */
export const isIdea = (e: Entry): boolean => !e.kind && (Boolean(e.ownIdea.trim()) || e.helpLevel === 'own');
/** 借款: help taken from an AI that is still a debt. Dropped ones (这个不用了) do not count. */
const isDebt = (e: Entry): boolean => Boolean(e.weight) && !e.dropped;

/** The day a debt was fully repaid, or null while it is still owed. */
export function settledOn(e: Entry): string | null {
  if (statusOf(e.passes, e.attempts, e.weight) !== 'settled') return null;
  const ok = (e.tries ?? []).filter((t) => t.ok);
  return ok.length ? ok[ok.length - 1].on : e.createdOn;
}

export interface Today { ideas: Entry[]; asked: Entry[]; explained: number; again: number }
/** 今天: what I thought of myself, what I asked the AI for, how many I explained, how many want another go. */
export function todayCard(es: Entry[], day: string): Today {
  const tries = es.flatMap((e) => (e.tries ?? []).filter((t) => t.on === day).map((t) => ({ e, ok: t.ok })));
  const okIds = new Set(tries.filter((t) => t.ok).map((t) => t.e.id));
  return {
    ideas: es.filter((e) => e.createdOn === day && isIdea(e)),
    asked: es.filter((e) => e.createdOn === day && isDebt(e)),
    explained: okIds.size,
    again: new Set(tries.filter((t) => !t.ok && !okIds.has(t.e.id)).map((t) => t.e.id)).size,
  };
}

/** 思考结余 on a day: ideas so far minus debts borrowed by then and not yet repaid (or let go) by then. */
export function balanceOn(es: Entry[], day: string): number {
  const ideas = es.filter((e) => e.createdOn <= day && isIdea(e)).length;
  const owed = es.filter((e) => e.weight && e.createdOn <= day && !(e.dropped && e.dropped <= day))
    .filter((e) => { const s = settledOn(e); return !s || s > day; }).length;
  return ideas - owed;
}

/** The curve under 思考结余: one point a day, oldest first. */
export const balanceCurve = (es: Entry[], until: string, days = 14): number[] =>
  Array.from({ length: days }, (_, i) => balanceOn(es, addDays(until, i - days + 1)));

/** A day counts only when the user said an idea or repaid a debt: never for time spent in the app. */
const counted = (es: Entry[], day: string) =>
  es.some((e) => (e.createdOn === day && isIdea(e)) || (e.tries ?? []).some((t) => t.ok && t.on === day));

/** 连续记账天数, ending today (or yesterday, so a streak is not lost before today's first idea). */
export function streak(es: Entry[], today: string): number {
  let day = counted(es, today) ? today : addDays(today, -1), n = 0;
  while (counted(es, day)) { n += 1; day = addDays(day, -1); }
  return n;
}

export interface IdeaGroup { topic: string; ideas: { on: string; text: string; question: string }[] }
/** 想法本: every idea in the user's own words, by course or project, newest first inside each. */
export function ideaBook(es: Entry[], board: Entry['board'], noTopic: string): IdeaGroup[] {
  const groups = new Map<string, IdeaGroup['ideas']>();
  for (const e of es.filter((x) => x.board === board && x.ownIdea.trim())) {
    const t = e.topic.trim() || noTopic;
    groups.set(t, [...(groups.get(t) ?? []), { on: e.createdOn, text: e.ownIdea.trim(), question: e.question }]);
  }
  return [...groups].map(([topic, ideas]) => ({ topic, ideas: ideas.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)) }))
    .sort((a, b) => b.ideas.length - a.ideas.length || a.topic.localeCompare(b.topic));
}

export interface WeekBill { from: string; to: string; withIdea: number | null; lastWithIdea: number | null; explained: number; owed: number }
const weekOf = (es: Entry[], from: string) => {
  const to = addDays(from, 6);
  const asked = es.filter((e) => e.weight && !e.kind && e.createdOn >= from && e.createdOn <= to);
  return { to, withIdea: asked.length ? asked.filter((e) => e.ownIdea.trim()).length / asked.length : null,
    explained: es.filter((e) => (e.tries ?? []).some((t) => t.ok && t.on >= from && t.on <= to)).length };
};
/** 每周账单: numbers only, never a question or an answer, so it can be shared. */
export function weekBill(es: Entry[], today: string): WeekBill {
  const from = monday(today), now = weekOf(es, from), last = weekOf(es, addDays(from, -7));
  return { from, to: now.to, withIdea: now.withIdea, lastWithIdea: last.withIdea, explained: now.explained,
    owed: es.filter((e) => isDebt(e) && !settledOn(e)).length };
}
