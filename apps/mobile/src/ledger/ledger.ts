// 思维账本 on the phone alone: no computer, no key. Port of services/api/researchos/services/mindledger
// (rules.py + the free grader in judge.py + store.py); tests/ledger.test.ts pins parity with the Python grader.
// A model, when the user has set one, is asked only where it can change the result (judge.needs_model).
import type { KV } from '../storage/kv';

export type HelpLevel = 'own' | 'hint' | 'approach' | 'answer'; // 先自己说 / 提示 / 思路 / 完整答案
export type Weight = 'light' | 'medium' | 'heavy';
export type Status = 'own' | 'settled' | 'shaky' | 'untested';

const WEIGHTS: Weight[] = ['light', 'medium', 'heavy'];
const STEPS: Record<Weight, number[]> = { light: [3], medium: [1, 2], heavy: [1, 7] };
const EXAM_WINDOW_DAYS = 7;
const PASS_RATIO = 0.6;
const MAX_POINTS = 6;
const BIGRAM_HIT = 0.4;
const CLEAR_PASS = 0.8;
const MIN_ATTEMPT = 6;
const FILLER = /[的了是在它上要先再就这那和与及也都]/g;

// ---- rules ------------------------------------------------------------------------------------------------
export function weightOf(level: HelpLevel, thoughtFirst: boolean): Weight | null {
  if (level === 'own') return null;
  const w = WEIGHTS.indexOf(({ hint: 'light', approach: 'medium', answer: 'heavy' } as const)[level]);
  return WEIGHTS[thoughtFirst ? Math.max(w - 1, 0) : w];
}

export const addDays = (d: string, n: number): string =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function frontLoad(due: string, today: string, exam?: string): string {
  if (!exam || !(today < exam && exam <= addDays(today, EXAM_WINDOW_DAYS)) || due < exam) return due;
  const dayBefore = addDays(exam, -1);
  return dayBefore > today ? dayBefore : today;
}

export function nextDue(w: Weight, passes: number, last: string, exam?: string): string | null {
  return passes >= STEPS[w].length ? null : frontLoad(addDays(last, STEPS[w][passes]), last, exam);
}

export const verdict = (hits: number, points: number): boolean => points > 0 && hits / points >= PASS_RATIO;

export function statusOf(passes: number, attempts: number, w: Weight | null): Status {
  if (w === null) return 'own';
  if (passes >= STEPS[w].length) return 'settled';
  return attempts ? 'shaky' : 'untested';
}

// ---- free grader ------------------------------------------------------------------------------------------
export interface Grade { points: string[]; hits: number[]; passed: boolean; method: 'model' | 'deterministic' }

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '').replace(FILLER, '');

function bigrams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (!out.size && t) out.add(t);
  return out;
}

export function keyPoints(reference: string): string[] {
  const parts = reference.split(/[。！？!?；;\n]+|(?<=[.])\s+/).map((p) => p.trim()).filter((p) => norm(p).length >= 4);
  return parts.length ? parts.slice(0, MAX_POINTS) : reference.trim() ? [reference.trim()] : [];
}

export function gradeFree(reference: string, attempt: string): Grade {
  const points = keyPoints(reference);
  const said = bigrams(attempt);
  const hits = points.flatMap((p, i) => {
    const b = bigrams(p);
    const shared = [...b].filter((x) => said.has(x)).length;
    return b.size && shared / b.size >= BIGRAM_HIT ? [i] : [];
  });
  return { points, hits, passed: verdict(hits.length, points.length), method: 'deterministic' };
}

/** Compute follows the debt: heavy debts always get the model, lighter ones only when the free grade is unsure. */
export function needsModel(w: Weight | null, free: Grade, attempt: string): boolean {
  if (w === 'heavy') return true;
  const clearPass = free.points.length > 0 && free.hits.length / free.points.length >= CLEAR_PASS;
  return !(clearPass || norm(attempt).length < MIN_ATTEMPT);
}

/** `ask` returns the model's JSON {"points": [...], "hits": [...]}; any failure keeps the free grade. */
export type Ask = (question: string, reference: string, attempt: string) => Promise<string>;

export async function grade(e: Entry, attempt: string, ask?: Ask): Promise<Grade> {
  const free = gradeFree(e.answer || e.question, attempt);
  if (!ask || !needsModel(e.weight, free, attempt)) return free;
  try {
    const j = JSON.parse(await ask(e.question, e.answer || e.question, attempt));
    const points = (j.points as unknown[]).map((p) => String(p).trim());
    const hits = [...new Set((j.hits as unknown[]).map(Number))].sort((a, b) => a - b);
    if (points.length < 1 || points.length > MAX_POINTS || points.some((p) => !p) ||
        hits.some((h) => !Number.isInteger(h) || h < 0 || h >= points.length)) return free;
    return { points, hits, passed: verdict(hits.length, points.length), method: 'model' };
  } catch {
    return free;
  }
}

// ---- local book -------------------------------------------------------------------------------------------
export interface Entry {
  id: string; clientId: string; board: '学习' | '科研' | '生活'; topic: string; question: string; answer: string;
  ownIdea: string; helpLevel: HelpLevel; weight: Weight | null; passes: number; attempts: number;
  dueOn: string | null; createdOn: string;
  held?: boolean; quiz?: boolean; // trial only: held back from repayment / passed the end-of-trial quiz
}
export type NewEntry = Pick<Entry, 'clientId' | 'board' | 'question' | 'helpLevel'> &
  Partial<Pick<Entry, 'topic' | 'answer' | 'ownIdea'>>;

const KEY = 'mindledger.v1';
const DAYS = 'mindledger.days.v1';

/** Stable coin flip per entry: the trial holds back half the debts from repayment, so each user is their own control. */
const heldBack = (clientId: string): boolean => [...clientId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2 === 1;

export class Book {
  constructor(private kv: KV, private trial = false) {}

  async all(): Promise<Entry[]> { return JSON.parse((await this.kv.get(KEY)) ?? '[]') as Entry[]; }
  private async save(es: Entry[]): Promise<void> { await this.kv.set(KEY, JSON.stringify(es)); }

  /** Idempotent by clientId, so a retried share or an offline replay never books twice. */
  async add(n: NewEntry, today: string, exam?: string): Promise<Entry> {
    if (!n.question.trim()) throw new Error('empty_question');
    const es = await this.all();
    const prior = es.find((e) => e.clientId === n.clientId);
    if (prior) return prior;
    const ownIdea = n.ownIdea ?? '';
    const w = weightOf(n.helpLevel, Boolean(ownIdea.trim()));
    const e: Entry = { id: `mind_${n.clientId}`, clientId: n.clientId, board: n.board, topic: (n.topic ?? '').trim(),
      question: n.question.trim(), answer: n.answer ?? '', ownIdea, helpLevel: n.helpLevel, weight: w, passes: 0,
      attempts: 0, dueOn: w ? nextDue(w, 0, today, exam) : null, createdOn: today };
    if (this.trial && w && heldBack(n.clientId)) Object.assign(e, { held: true, dueOn: null });
    await this.save([...es, e]);
    return e;
  }

  async due(today: string): Promise<Entry[]> {
    const order = (e: Entry) => (e.weight ? 2 - WEIGHTS.indexOf(e.weight) : 3);
    return (await this.all()).filter((e) => e.dueOn && e.dueOn <= today)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : order(a) - order(b)));
  }

  async repay(id: string, attempt: string, today: string, exam?: string, ask?: Ask): Promise<Grade & { nextDue: string | null }> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || !e.weight || !e.dueOn) throw new Error('nothing_to_repay');
    const g = await grade(e, attempt, ask);
    e.attempts += 1;
    e.passes += g.passed ? 1 : 0;
    e.dueOn = g.passed ? nextDue(e.weight, e.passes, today, exam) : frontLoad(addDays(today, 1), today, exam);
    await this.save(es);
    return { ...g, nextDue: e.dueOn };
  }

  /** 考前真实掌握度报告: independence from no-AI attempts only, and what to repay before the exam, in order. */
  async report(today: string, exam: string, board?: Entry['board']) {
    const es = (await this.all()).filter((e) => !board || e.board === board);
    const items = es.map((e) => ({ ...e, status: statusOf(e.passes, e.attempts, e.weight),
      dueOn: e.dueOn ? frontLoad(e.dueOn, today, exam) : null }));
    const counts = { own: 0, settled: 0, shaky: 0, untested: 0 };
    items.forEach((i) => { counts[i.status] += 1; });
    const independence = items.length ? Math.round(((counts.own + counts.settled) / items.length) * 1000) / 1000 : null;
    const before = items.filter((i) => i.dueOn && i.dueOn < exam)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : WEIGHTS.indexOf(b.weight!) - WEIGHTS.indexOf(a.weight!)));
    return { exam, asOf: today, total: items.length, counts, independence, repayBeforeExam: before,
      notReachableBeforeExam: items.filter((i) => i.dueOn && i.dueOn >= exam) };
  }

  // ---- small trial (1-2 weeks, classmates): numbers only, no question or answer text ever leaves the phone ----
  async opened(today: string): Promise<void> {
    const days = new Set<string>(JSON.parse((await this.kv.get(DAYS)) ?? '[]'));
    await this.kv.set(DAYS, JSON.stringify([...days.add(today)].sort()));
  }

  /** End-of-trial quiz on every debt, repaid or held back; it never changes the schedule. */
  async quiz(id: string, attempt: string): Promise<boolean> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || !e.weight) throw new Error('not_a_debt');
    e.quiz = gradeFree(e.answer || e.question, attempt).passed;
    await this.save(es);
    return e.quiz;
  }

  /** What a participant sends back: counts only. */
  async trialSummary(today: string) {
    const debts = (await this.all()).filter((e) => e.weight);
    const arm = (held: boolean) => {
      const xs = debts.filter((e) => Boolean(e.held) === held);
      const quizzed = xs.filter((e) => e.quiz !== undefined);
      return { debts: xs.length, quizzed: quizzed.length, quizPassed: quizzed.filter((e) => e.quiz).length };
    };
    const repayable = debts.filter((e) => !e.held);
    const days: string[] = JSON.parse((await this.kv.get(DAYS)) ?? '[]');
    const first = days[0];
    return { asOf: today, repaid: arm(false), heldBack: arm(true),
      settledShare: repayable.length ? repayable.filter((e) => statusOf(e.passes, e.attempts, e.weight) === 'settled').length / repayable.length : null,
      daysOpened: days.length, back7: Boolean(first && days.some((d) => d >= addDays(first, 7))) };
  }
}
