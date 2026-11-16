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

/** Days left to the exam, group meeting or defence when it is close (same window as frontLoad) and debts are still owed. */
export function countdown(today: string, exam: string | undefined, owed: number): number | null {
  if (!exam || owed === 0 || !(today < exam && exam <= addDays(today, EXAM_WINDOW_DAYS))) return null;
  return Math.round((Date.parse(exam) - Date.parse(today)) / 86400000);
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

export function bigrams(s: string): Set<string> {
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

/** Red (讲不出来) first, then the earlier date, then the heavier debt. */
function firstToRepay(a: Entry, b: Entry): number {
  if (Boolean(a.red) !== Boolean(b.red)) return a.red ? -1 : 1;
  if (a.dueOn !== b.dueOn) return a.dueOn! < b.dueOn! ? -1 : 1;
  return (b.weight ? WEIGHTS.indexOf(b.weight) : -1) - (a.weight ? WEIGHTS.indexOf(a.weight) : -1);
}

// ---- local book -------------------------------------------------------------------------------------------
export interface Entry {
  id: string; clientId: string; board: '学习' | '科研' | '生活'; topic: string; question: string; answer: string;
  ownIdea: string; helpLevel: HelpLevel; weight: Weight | null; passes: number; attempts: number;
  dueOn: string | null; createdOn: string;
  held?: boolean; quiz?: boolean; // trial only: held back from repayment / passed the end-of-trial quiz
  serverId?: string; // set once the computer has the entry (multi-device)
  fromComputer?: boolean; // borrowed on the computer (browser extension), repaid here
  red?: boolean; // 讲不出来: the last try fell short or the user said so; no score, it just goes first on the pre-exam list
  kind?: 'conclusion'; // 结论债: a result an AI-written analysis produced; repaid by passing the null-world exam, not by explaining
}

export type ExamOutcome = 'pass' | 'fail' | 'unsure';
/** One exam of one analysis: `key` names the analysis (script, data, label), so a retake lands on the same debt. */
export interface Checkup { key: string; question: string; outcome: ExamOutcome }

/** The computer's 思维账本 API, as the phone needs it. Kept as an interface so the book never touches the network. */
export interface LedgerRemote {
  entry(body: { client_id: string; question: string; help_level: HelpLevel; answer: string; own_idea: string; topic: string; source: 'app' },
    key: string): Promise<{ id: string }>;
  attempt(serverId: string, text: string, key: string): Promise<unknown>;
  due(): Promise<{ id: string; client_id: string; topic: string; question: string; answer: string; own_idea: string;
    help_level: HelpLevel; due_on: string | null; created_on: string }[]>;
}
export interface SyncResult { sent: number; pulled: number; stopped: boolean }
interface Pending { clientId: string; text: string; key: string }
export type NewEntry = Pick<Entry, 'clientId' | 'board' | 'question' | 'helpLevel'> &
  Partial<Pick<Entry, 'topic' | 'answer' | 'ownIdea'>>;

const KEY = 'mindledger.v1';
const DAYS = 'mindledger.days.v1';
const OUTBOX = 'mindledger.outbox.v1'; // repayments the computer has not seen yet, oldest first
const DRAFT = 'mindledger.draft.v1.'; // + entry id: what the user had said when they were interrupted
const TRIAL = 'mindledger.trial.v1'; // the day the two-week trial started; absent = no trial
export const TRIAL_DAYS = 14;

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
    if (w && heldBack(n.clientId) && (this.trial || (await this.trialStart()))) Object.assign(e, { held: true, dueOn: null });
    await this.save([...es, e]);
    return e;
  }

  async due(today: string): Promise<Entry[]> {
    return (await this.all()).filter((e) => e.dueOn && e.dueOn <= today).sort(firstToRepay);
  }

  async repay(id: string, attempt: string, today: string, exam?: string, ask?: Ask): Promise<Grade & { nextDue: string | null }> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || !e.weight || !e.dueOn) throw new Error('nothing_to_repay');
    if (e.kind) throw new Error('repay_by_exam');
    const g = await grade(e, attempt, ask);
    e.attempts += 1;
    e.passes += g.passed ? 1 : 0;
    e.red = !g.passed;
    e.dueOn = g.passed ? nextDue(e.weight, e.passes, today, exam) : frontLoad(addDays(today, 1), today, exam);
    await this.save(es);
    await this.queue({ clientId: e.clientId, text: attempt, key: `attempt-${e.clientId}-${e.attempts}` });
    await this.kv.set(DRAFT + id, '');
    return { ...g, nextDue: e.dueOn };
  }

  /**
   * 「这一步你讲给我听？」right after booking. Explaining what you have just read proves little, so a good try leaves the
   * schedule alone; a try that falls short, or 讲不出来 (no attempt at all), marks the debt red and brings it to tomorrow.
   */
  async checkNow(id: string, attempt: string, today: string, exam?: string, ask?: Ask): Promise<Grade | null> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || !e.weight || !e.dueOn) throw new Error('nothing_to_repay');
    if (e.kind) throw new Error('repay_by_exam');
    const g = attempt.trim() ? await grade(e, attempt, ask) : null;
    if (g?.passed) return g;
    Object.assign(e, { red: true, attempts: e.attempts + 1, dueOn: frontLoad(addDays(today, 1), today, exam) });
    await this.save(es);
    return g;
  }

  /**
   * 结论体检 → 结论债. The first exam of an AI-written analysis books the debt on the 科研 board; a null-world pass settles
   * it, a fail (崩分: the high score holds even where the labels mean nothing) marks it red and keeps it owed today, and
   * an unsure verdict keeps it owed. A retake of the same analysis lands on the same debt.
   */
  async checkup(c: Checkup, today: string): Promise<Entry> {
    const es = await this.all();
    const clientId = `concl-${c.key}`;
    let e = es.find((x) => x.clientId === clientId);
    if (!e) {
      e = { id: `mind_${clientId}`, clientId, board: '科研', topic: '结论债', question: c.question.trim(), answer: '', ownIdea: '',
        helpLevel: 'answer', weight: 'heavy', passes: 0, attempts: 0, dueOn: today, createdOn: today, kind: 'conclusion' };
      es.push(e);
    }
    const passed = c.outcome === 'pass';
    Object.assign(e, { attempts: e.attempts + 1, passes: passed ? STEPS.heavy.length : 0, red: c.outcome === 'fail',
      dueOn: passed ? null : today });
    await this.save(es);
    return e;
  }

  /** 考前真实掌握度报告: independence from no-AI attempts only, and what to repay before the exam, in order. */
  async report(today: string, exam: string, board?: Entry['board']) {
    const es = (await this.all()).filter((e) => !board || e.board === board);
    const items = es.map((e) => ({ ...e, status: statusOf(e.passes, e.attempts, e.weight),
      dueOn: e.dueOn ? frontLoad(e.dueOn, today, exam) : null }));
    const counts = { own: 0, settled: 0, shaky: 0, untested: 0 };
    items.forEach((i) => { counts[i.status] += 1; });
    const independence = items.length ? Math.round(((counts.own + counts.settled) / items.length) * 1000) / 1000 : null;
    const before = items.filter((i) => i.dueOn && i.dueOn < exam).sort(firstToRepay);
    return { exam, asOf: today, total: items.length, counts, independence, repayBeforeExam: before,
      notReachableBeforeExam: items.filter((i) => i.dueOn && i.dueOn >= exam) };
  }

  /** 过程记录: the user's own copy of when each debt was borrowed, how much help it took and whether they explained it later. */
  async processRecord(today: string, exam?: string, board?: Entry['board']): Promise<string> {
    const LEVEL: Record<HelpLevel, string> = { own: '自己想的', hint: '提示', approach: '思路', answer: '完整答案' };
    const STATUS: Record<Status, string> = { own: '自己想的', settled: '已讲清', shaky: '讲到一半', untested: '还没讲' };
    const state = (e: Entry): string => e.kind
      ? (e.red ? '崩分，改好再考' : statusOf(e.passes, e.attempts, e.weight) === 'settled' ? '零世界考过' : '还没考过')
      : e.red ? '讲不出来' : STATUS[statusOf(e.passes, e.attempts, e.weight)];
    const es = (await this.all()).filter((e) => !board || e.board === board)
      .sort((a, b) => (a.createdOn < b.createdOn ? -1 : a.createdOn > b.createdOn ? 1 : 0));
    const head = exam ? await this.report(today, exam, board) : null;
    const pct = head?.independence == null ? '—' : `${Math.round(head.independence * 100)}%`;
    return [`思维账本过程记录 · ${today}${board ? ` · ${board}` : ''}`,
      ...(head ? [`独立掌握度 ${pct}，共 ${head.total} 笔`] : []),
      ...es.map((e) => [e.createdOn, e.board, e.question.slice(0, 40), e.kind ? 'AI 写的分析' : LEVEL[e.helpLevel],
        ...(e.kind ? [] : [e.ownIdea.trim() ? '先想过' : '没先想']), state(e)].join(' · '))].join('\n');
  }

  // ---- several devices: borrow on the computer, repay on the phone, pick up where you stopped ----
  async saveDraft(id: string, text: string): Promise<void> { await this.kv.set(DRAFT + id, text); }
  async draftOf(id: string): Promise<string> { return (await this.kv.get(DRAFT + id)) ?? ''; }
  private async outbox(): Promise<Pending[]> { return JSON.parse((await this.kv.get(OUTBOX)) ?? '[]') as Pending[]; }
  private async queue(p: Pending): Promise<void> { await this.kv.set(OUTBOX, JSON.stringify([...(await this.outbox()), p])); }

  /**
   * Offline first: everything is booked and graded on the phone. When the computer answers, send what it has not seen
   * (entries by client id, repayments by a fixed key, so a retry never counts twice) and take in debts borrowed there.
   * Stops at the first failure and keeps the rest for next time.
   */
  async sync(remote: LedgerRemote, today: string): Promise<SyncResult> {
    const es = await this.all();
    let sent = 0, pulled = 0;
    try {
      for (const e of es.filter((x) => !x.serverId && !x.kind)) { // 结论债 stays on the phone until the computer keeps them
        e.serverId = (await remote.entry({ client_id: e.clientId, question: e.question, help_level: e.helpLevel, answer: e.answer,
          own_idea: e.ownIdea, topic: e.topic, source: 'app' }, `entry-${e.clientId}`)).id;
        sent += 1;
        await this.save(es);
      }
      const box = await this.outbox();
      while (box.length) {
        const p = box[0];
        const e = es.find((x) => x.clientId === p.clientId);
        if (e?.serverId) { await remote.attempt(e.serverId, p.text, p.key); sent += 1; }
        box.shift();
        await this.kv.set(OUTBOX, JSON.stringify(box));
      }
      for (const d of await remote.due()) {
        if (es.some((x) => x.clientId === d.client_id)) continue;
        es.push({ id: `mind_${d.client_id}`, clientId: d.client_id, board: '学习', topic: d.topic, question: d.question, answer: d.answer,
          ownIdea: d.own_idea, helpLevel: d.help_level, weight: weightOf(d.help_level, Boolean(d.own_idea.trim())), passes: 0, attempts: 0,
          dueOn: d.due_on ?? today, createdOn: d.created_on, serverId: d.id, fromComputer: true });
        pulled += 1;
      }
      await this.save(es);
      return { sent, pulled, stopped: false };
    } catch {
      return { sent, pulled, stopped: true };
    }
  }

  // ---- small trial (1-2 weeks, classmates): numbers only, no question or answer text ever leaves the phone ----
  async trialStart(): Promise<string | null> { return this.kv.get(TRIAL); }
  async startTrial(today: string): Promise<void> { if (!(await this.trialStart())) await this.kv.set(TRIAL, today); }
  /** The end-of-trial quiz is open once the two weeks are up (or the user ends early); it lists every debt not yet quizzed. */
  async quizDue(today: string, endNow = false): Promise<Entry[]> {
    const start = await this.trialStart();
    if (!start || !(endNow || today >= addDays(start, TRIAL_DAYS))) return [];
    return (await this.all()).filter((e) => e.weight && !e.kind && e.createdOn >= start && e.quiz === undefined);
  }

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
    const debts = (await this.all()).filter((e) => e.weight && !e.kind);
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
