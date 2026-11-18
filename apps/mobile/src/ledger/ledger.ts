// 思维账本 on the phone alone: no computer, no key. Port of services/api/researchos/services/mindledger
// (rules.py + the free grader in judge.py + store.py); tests/ledger.test.ts pins parity with the Python grader on points and hits.
// The phone grader adds one guard the Python one lacks: a point said back turned round (正比 → 反比) is never a pass.
// A model, when the user has set one, is asked only where it can change the result (judge.needs_model).
import type { KV } from '../storage/kv';
import { ratingOf, review, type Memory } from './memory';
import { backs, opposing, type Source } from '../rules/recall';
import { findSpan } from '../rules/text';

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
const UNSURE_FROM = 0.3; // a third of the points or more, but short of a pass
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
export interface Grade {
  points: string[]; hits: number[]; passed: boolean; method: 'model' | 'deterministic';
  /** Points the attempt matched word for word but turned round (正比 → 反比, 是 → 不是): never a pass on their own. */
  turned?: number[];
}

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

// Word pairs that turn a statement round when the attempt keeps the words and swaps one side. A fluent explanation that
// copies the reference's words but says 反比 for 正比 shares nearly all its bigrams, so the overlap alone would pass it.
const TURNS: [RegExp, RegExp][] = [
  [/正比/, /反比/],
  [/递增|增函数|上升|增大|增加|提高|升高|增强|加快|越大|更快|更强|更高|更久|更大/, /递减|减函数|下降|减小|减少|降低|减弱|减慢|越小|更慢|更弱|更低|更短|更小/],
  [/高于|大于|多于|超过|以上/, /低于|小于|少于|不到|以下/],
  [/内流|流入|进入|吸收/, /外流|流出|释放|放出/],
  [/为正|正的|上方|正方向/, /为负|负的|下方|反方向/],
  [/相同|一致|一样/, /相反/],
  [/打开|开放/, /关闭/],
  [/之前|以前/, /之后|以后/],
  [/时域到频域|时域转换?到频域|时域转到频域/, /频域转换?到时域|频域到时域/],
  [/去极化/, /复极化/],
  [/相乘|乘以|乘上|之积/, /相加|加上|之和/],
  [/分散|离散/, /集中/],
];
// Negation as a spoken explanation says it: 无 and 没 count, conditionals (否则, 不然) and fixed words (不同, 无论) do not.
const NOT_NEG = /不同|不仅|不断|不久|不少|不过|不管|不论|不但|不如|不错|不然|否则|非常|无论|无数|未来/g;
const NEG = /[不没未无]|并非|\b(?:not|no|never|cannot)\b|n't\b/i;
const negated = (s: string): boolean => NEG.test(s.replace(NOT_NEG, ' '));
const turnOf = (s: string): number[] => TURNS.map(([a, b]) => Number(a.test(s)) - Number(b.test(s)));
const CLAUSE = /[，,、。；;！？!?\n]+/;

/** The attempt clause that shares the most bigrams with this clause of a point; null below three shared. */
function closest(clause: string, said: string[]): string | null {
  const b = bigrams(clause);
  let best: string | null = null, most = 2;
  for (const c of said) { const n = [...bigrams(c)].filter((x) => b.has(x)).length; if (n > most) { most = n; best = c; } }
  return best;
}

/**
 * True when the point is said back turned round: a clause with a word swapped for its pair, or the whole point negated
 * where the closest part of the attempt is not (or the other way). Negation is judged on the whole point, because a
 * spoken explanation moves 不失真 from one clause to the next.
 */
function turned(point: string, said: string[]): boolean {
  const parts = point.split(CLAUSE).filter((c) => norm(c).length >= 4);
  const near = parts.map((c) => closest(c, said));
  if (near.some((a, i) => a && turnOf(parts[i]).some((d, k) => d !== 0 && turnOf(a)[k] === -d))) return true;
  const region = [...new Set(near.filter((a): a is string => a !== null))].join('，');
  return Boolean(region) && negated(point) !== negated(region);
}

export function gradeFree(reference: string, attempt: string): Grade {
  const points = keyPoints(reference);
  const said = bigrams(attempt);
  const clauses = attempt.split(CLAUSE).filter((c) => norm(c).length >= 2);
  const hits = points.flatMap((p, i) => {
    const b = bigrams(p);
    const shared = [...b].filter((x) => said.has(x)).length;
    return b.size && shared / b.size >= BIGRAM_HIT ? [i] : [];
  });
  const flipped = hits.filter((i) => turned(points[i], clauses));
  return { points, hits, passed: !flipped.length && verdict(hits.length, points.length), method: 'deterministic',
    ...(flipped.length ? { turned: flipped } : {}) };
}

/**
 * 拿不准: the free grader found some of the points but not enough, so it cannot tell a muddled explanation from one said
 * in other words; or it matched a point but turned it round (turned), which only a second try or a model can settle. The
 * screen asks for the explanation again in other words instead of counting it (plan 2.2).
 */
export function unsureGrade(g: Grade): boolean {
  if (g.method === 'deterministic' && g.turned?.length) return true;
  return g.method === 'deterministic' && !g.passed && g.hits.length > 0 && g.hits.length / g.points.length >= UNSURE_FROM;
}

/** Compute follows the debt: heavy debts always get the model, lighter ones only when the free grade is unsure. */
export function needsModel(w: Weight | null, free: Grade, attempt: string): boolean {
  if (w === 'heavy') return true;
  const clearPass = !free.turned?.length && free.points.length > 0 && free.hits.length / free.points.length >= CLEAR_PASS;
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
  kind?: 'conclusion' | 'citation'; // 结论债: repaid by the null-world exam; 引用债: repaid by finding the original page
  tries?: Try[]; // every repayment try, in order: the 今天 card, 思考结余 and its curve read these
  dropped?: string; // 这个不用了: the day the user let this one go; it leaves the schedule, the report and the balance
  usedIn?: string; // 用在哪里: where the user used this answer (a chapter, a slide), so a recall says where to go back to
  origin?: { page: number; paper: string; quote: string }; // 引用债 repaid: the original sentence the user found
  ai?: string; // which AI gave the answer, as the user named it
  recalls?: Recall[]; // 知识召回: imported texts that said the opposite of the answer, newest last
  sentMark?: string; // the red / used-in / dropped state the computer last received
  mem?: Memory; // FSRS memory state after the last repayment; sets the next repayment day
}

/**
 * 召回单: an imported text says the opposite of a sentence of the AI's answer. Open until the user looks; accepting puts
 * the source sentence in place of the claim and reopens the debt, dismissing needs a sentence of an imported text that
 * backs the claim. Either way the same source sentence never recalls this entry again.
 */
export interface Recall {
  claim: string; quote: string; page: number; paper: string; on: string; state: 'open' | 'accepted' | 'dismissed'; evidence?: string;
  sent?: boolean; // the computer has it
}

export interface Try { on: string; ok: boolean }
const tried = (e: Entry, on: string, ok: boolean) => { e.tries = [...(e.tries ?? []), { on, ok }]; };

export type ExamOutcome = 'pass' | 'fail' | 'unsure';
/** One exam of one analysis: `key` names the analysis (script, data, label), so a retake lands on the same debt. */
export interface Checkup { key: string; question: string; outcome: ExamOutcome }

/** The computer's 思维账本 API, as the phone needs it. Kept as an interface so the book never touches the network. */
export interface LedgerRemote {
  entry(body: { client_id: string; question: string; help_level: HelpLevel; answer: string; own_idea: string; topic: string; source: 'app';
    board: Entry['board']; kind?: Entry['kind']; used_in: string }, key: string): Promise<{ id: string }>;
  attempt(serverId: string, text: string, key: string): Promise<unknown>;
  due(): Promise<{ id: string; client_id: string; topic: string; question: string; answer: string; own_idea: string;
    help_level: HelpLevel; due_on: string | null; created_on: string; board?: Entry['board']; kind?: Entry['kind'] | null;
    used_in?: string; red?: boolean }[]>;
  /** 讲不出来 / 用在哪里 / 这个不用了 after the entry was sent (a computer from before these fields leaves it out). */
  mark?(serverId: string, m: { red: boolean; used_in: string; dropped_on: string | null }): Promise<unknown>;
  /** A 召回单 found on the phone, so the computer can show it and mark the sentence yellow. */
  recall?(serverId: string, r: { claim: string; paper: string; page: number; quote: string }): Promise<unknown>;
}
export interface SyncResult { sent: number; pulled: number; stopped: boolean }
interface Pending { clientId: string; text: string; key: string }
export type NewEntry = Pick<Entry, 'clientId' | 'board' | 'question' | 'helpLevel'> &
  Partial<Pick<Entry, 'topic' | 'answer' | 'ownIdea' | 'ai' | 'usedIn'>>;

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
    if (n.board === '生活') throw new Error('life_has_its_own_book'); // 生活这本账 is a separate table: ledger/life.ts
    const es = await this.all();
    const prior = es.find((e) => e.clientId === n.clientId);
    if (prior) return prior;
    const ownIdea = n.ownIdea ?? '';
    const w = weightOf(n.helpLevel, Boolean(ownIdea.trim()));
    const e: Entry = { id: `mind_${n.clientId}`, clientId: n.clientId, board: n.board, topic: (n.topic ?? '').trim(),
      question: n.question.trim(), answer: n.answer ?? '', ownIdea, helpLevel: n.helpLevel, weight: w, passes: 0,
      attempts: 0, dueOn: w ? nextDue(w, 0, today, exam) : null, createdOn: today, ...(n.ai?.trim() ? { ai: n.ai.trim() } : {}),
      ...(n.usedIn?.trim() ? { usedIn: n.usedIn.trim() } : {}) };
    if (w && heldBack(n.clientId) && (this.trial || (await this.trialStart()))) Object.assign(e, { held: true, dueOn: null });
    await this.save([...es, e]);
    return e;
  }

  /** 这次不记: undo an automatic booking. Only entries never tried, never synced and not recalled are taken out. */
  async remove(ids: string[]): Promise<number> {
    const es = await this.all();
    const keep = es.filter((e) => !ids.includes(e.id) || e.attempts > 0 || e.serverId || e.recalls?.length);
    await this.save(keep);
    return es.length - keep.length;
  }

  async due(today: string): Promise<Entry[]> {
    return (await this.all()).filter((e) => e.dueOn && e.dueOn <= today).sort(firstToRepay);
  }

  async repay(id: string, attempt: string, today: string, exam?: string, ask?: Ask): Promise<Grade & { nextDue: string | null; mem: Memory }> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || !e.weight || !e.dueOn) throw new Error('nothing_to_repay');
    if (e.kind) throw new Error('repay_by_exam');
    const g = await grade(e, attempt, ask);
    e.attempts += 1;
    e.passes += g.passed ? 1 : 0;
    e.red = !g.passed;
    tried(e, today, g.passed);
    e.mem = review(e.mem, e.createdOn, today, ratingOf(g.passed, g.points.length ? g.hits.length / g.points.length : 0));
    e.dueOn = !g.passed ? frontLoad(addDays(today, 1), today, exam)
      : e.passes >= STEPS[e.weight].length ? null : frontLoad(e.mem.due, today, exam);
    await this.save(es);
    await this.queue({ clientId: e.clientId, text: attempt, key: `attempt-${e.clientId}-${e.attempts}` });
    await this.kv.set(DRAFT + id, '');
    return { ...g, nextDue: e.dueOn, mem: e.mem };
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
    tried(e, today, false);
    Object.assign(e, { red: true, attempts: e.attempts + 1, dueOn: frontLoad(addDays(today, 1), today, exam), mem: review(e.mem, e.createdOn, today, ratingOf(false, 0)) });
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
    tried(e, today, passed);
    Object.assign(e, { attempts: e.attempts + 1, passes: passed ? STEPS.heavy.length : 0, red: c.outcome === 'fail',
      dueOn: passed ? null : today });
    await this.save(es);
    return e;
  }

  /** Grade without booking: lets the screen ask again in other words when the free grade is 拿不准 (see unsureGrade). */
  async preview(id: string, attempt: string, ask?: Ask): Promise<Grade> {
    const e = (await this.all()).find((x) => x.id === id);
    if (!e) throw new Error('nothing_to_repay');
    return grade(e, attempt, ask);
  }

  /**
   * 成长空间: an exam or group meeting close by brings that course's debts in front of it (the day before, or today).
   * Only moves debts earlier, never later; returns how many moved.
   */
  async pullForward(topic: string, day: string, today: string): Promise<number> {
    const es = await this.all();
    let n = 0;
    for (const e of es) {
      if (e.topic.trim() !== topic || !e.dueOn || e.dropped || e.held || e.dueOn < day) continue;
      const to = frontLoad(e.dueOn, today, day);
      if (to < e.dueOn) { e.dueOn = to; n += 1; }
    }
    if (n) await this.save(es);
    return n;
  }

  private async edit(id: string, f: (e: Entry) => void): Promise<Entry> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e) throw new Error('no_entry');
    f(e); await this.save(es);
    return e;
  }

  /** 改天再聊: tomorrow instead of today; nothing is counted, the debt is not marked. */
  snooze(id: string, today: string): Promise<Entry> {
    return this.edit(id, (e) => { if (e.dueOn && e.dueOn <= today) e.dueOn = addDays(today, 1); });
  }

  /** 这个不用了: the user decides this one does not matter; it leaves the schedule, the report and 思考结余, not the record. */
  drop(id: string, today: string): Promise<Entry> {
    return this.edit(id, (e) => { Object.assign(e, { dropped: today, dueOn: null, red: false }); });
  }

  /** 用在哪里: one short line, so a later recall can say where the answer went. Empty clears it. */
  setUsedIn(id: string, where: string): Promise<Entry> {
    return this.edit(id, (e) => { const w = where.replace(/\s+/g, ' ').trim().slice(0, 40); if (w) e.usedIn = w; else delete e.usedIn; });
  }

  /**
   * 引用债: an AI gave a citation, a number or a sentence the user may put in their own writing. It is owed from today and
   * repaid only by finding the original: a sentence copied from an imported text, found there word for word, that shares
   * the claim's numbers (when it has any) or enough of its wording.
   */
  async addCitation(n: { clientId: string; claim: string; topic?: string; ai?: string; usedIn?: string }, today: string): Promise<Entry> {
    const claim = n.claim.trim();
    if (!claim) throw new Error('empty_question');
    const es = await this.all();
    const prior = es.find((e) => e.clientId === n.clientId);
    if (prior) return prior;
    const e: Entry = { id: `mind_${n.clientId}`, clientId: n.clientId, board: '科研', topic: (n.topic ?? '').trim() || '引用债',
      question: claim, answer: claim, ownIdea: '', helpLevel: 'answer', weight: 'heavy', passes: 0, attempts: 0, dueOn: today,
      createdOn: today, kind: 'citation', ...(n.ai?.trim() ? { ai: n.ai.trim() } : {}), ...(n.usedIn?.trim() ? { usedIn: n.usedIn.trim() } : {}) };
    await this.save([...es, e]);
    return e;
  }

  /** 找到原文: true and settled when the quote is in an imported text and backs the claim; otherwise nothing changes. */
  async findOrigin(id: string, quote: string, sources: Source[], today: string): Promise<boolean> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    if (!e || e.kind !== 'citation') throw new Error('not_a_citation');
    const hit = originOf(e.answer, quote, sources);
    if (!hit) return false;
    tried(e, today, true);
    Object.assign(e, { origin: hit, attempts: e.attempts + 1, passes: STEPS.heavy.length, dueOn: null, red: false });
    await this.save(es);
    return true;
  }

  // ---- 知识召回: an imported text that says the opposite reopens what you learned from the AI ----
  /** Check every AI answer in the book against a text just imported; returns the entries that now have an open 召回单. */
  async recallScan(source: Source, today: string): Promise<Entry[]> {
    const es = await this.all();
    const out: Entry[] = [];
    for (const e of es) {
      if (!e.weight || e.kind || !e.answer.trim() || e.recalls?.some((r) => r.state === 'open')) continue;
      const o = opposing(e.answer, source);
      if (!o || e.recalls?.some((r) => r.quote === o.quote)) continue;
      e.recalls = [...(e.recalls ?? []), { claim: o.claim, quote: o.quote, page: o.page, paper: source.name, on: today, state: 'open' }];
      out.push(e);
    }
    if (out.length) await this.save(es);
    return out;
  }

  async recalled(): Promise<Entry[]> { return (await this.all()).filter((e) => e.recalls?.some((r) => r.state === 'open')); }

  /** 接受: the source sentence replaces the claim in the reference answer, and the debt is owed again from today. */
  async acceptRecall(id: string, today: string, exam?: string): Promise<Entry> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    const r = e?.recalls?.find((x) => x.state === 'open');
    if (!e || !r || !e.weight) throw new Error('no_open_recall');
    r.state = 'accepted';
    Object.assign(e, { answer: e.answer.replace(r.claim, r.quote), passes: 0, red: false,
      dueOn: e.held ? null : frontLoad(today, today, exam) });
    await this.save(es);
    return e;
  }

  /** 驳回 needs evidence the rules can check: a sentence found word for word in an imported text that agrees with the claim. */
  async dismissRecall(id: string, evidence: string, sources: Source[]): Promise<Entry> {
    const es = await this.all();
    const e = es.find((x) => x.id === id);
    const r = e?.recalls?.find((x) => x.state === 'open');
    if (!e || !r) throw new Error('no_open_recall');
    if (!backs(r.claim, evidence, sources)) throw new Error('no_evidence');
    Object.assign(r, { state: 'dismissed', evidence: evidence.trim() });
    await this.save(es);
    return e;
  }

  /** 考前真实掌握度报告: independence from no-AI attempts only, and what to repay before the exam, in order. */
  async report(today: string, exam: string, board?: Entry['board']) {
    const es = (await this.all()).filter((e) => !e.dropped && (!board || e.board === board));
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
    const state = (e: Entry): string => e.dropped ? '不用了' : e.kind === 'citation'
      ? (e.origin ? `找到原文（《${e.origin.paper}》第 ${e.origin.page} 页）` : '还没找到原文')
      : e.kind
      ? (e.red ? '崩分，改好再考' : statusOf(e.passes, e.attempts, e.weight) === 'settled' ? '零世界考过' : '还没考过')
      : e.recalls?.some((r) => r.state === 'open') ? '被召回，待你看'
        : `${e.red ? '讲不出来' : STATUS[statusOf(e.passes, e.attempts, e.weight)]}${e.recalls?.some((r) => r.state === 'accepted') ? '（召回后重开）' : ''}`;
    const es = (await this.all()).filter((e) => !board || e.board === board)
      .sort((a, b) => (a.createdOn < b.createdOn ? -1 : a.createdOn > b.createdOn ? 1 : 0));
    const head = exam ? await this.report(today, exam, board) : null;
    const pct = head?.independence == null ? '—' : `${Math.round(head.independence * 100)}%`;
    return [`思维账本过程记录 · ${today}${board ? ` · ${board}` : ''}`,
      ...(head ? [`独立掌握度 ${pct}，共 ${head.total} 笔`] : []),
      ...es.map((e) => [e.createdOn, e.board, e.question.slice(0, 40), e.kind === 'citation' ? 'AI 给的引用' : e.kind ? 'AI 写的分析' : LEVEL[e.helpLevel],
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
      for (const e of es.filter((x) => !x.serverId)) {
        e.serverId = (await remote.entry({ client_id: e.clientId, question: e.question, help_level: e.helpLevel, answer: e.answer,
          own_idea: e.ownIdea, topic: e.topic, source: 'app', board: e.board, ...(e.kind ? { kind: e.kind } : {}), used_in: e.usedIn ?? '' },
        `entry-${e.clientId}`)).id;
        sent += 1;
        await this.save(es);
      }
      for (const e of es.filter((x) => x.serverId)) { // what changed since: sent once per change, harmless if repeated
        const m = { red: Boolean(e.red), used_in: e.usedIn ?? '', dropped_on: e.dropped ?? null };
        const sig = JSON.stringify(m);
        if (remote.mark && e.sentMark !== sig && (e.sentMark || m.red || m.used_in || m.dropped_on)) {
          await remote.mark(e.serverId!, m); e.sentMark = sig; sent += 1; await this.save(es);
        }
        for (const r of e.recalls ?? []) {
          if (!remote.recall || r.sent) continue;
          await remote.recall(e.serverId!, { claim: r.claim, paper: r.paper, page: r.page, quote: r.quote });
          r.sent = true; sent += 1; await this.save(es);
        }
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
        es.push({ id: `mind_${d.client_id}`, clientId: d.client_id, board: d.board ?? '学习', topic: d.topic, question: d.question,
          answer: d.answer, ownIdea: d.own_idea, helpLevel: d.help_level, weight: d.kind ? 'heavy' : weightOf(d.help_level, Boolean(d.own_idea.trim())),
          passes: 0, attempts: 0, dueOn: d.due_on ?? today, createdOn: d.created_on, serverId: d.id, fromComputer: true,
          ...(d.kind ? { kind: d.kind } : {}), ...(d.used_in ? { usedIn: d.used_in } : {}), ...(d.red ? { red: true } : {}) });
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

const DIGITS = /\d+(?:\.\d+)?/g;
/** Where a quote backs a claim: on a page of an imported text word for word, with the claim's numbers or enough of its words. */
export function originOf(claim: string, quote: string, sources: Source[]): { page: number; paper: string; quote: string } | null {
  const q = quote.trim();
  if (norm(q).length < 8) return null;
  const nums = claim.match(DIGITS) ?? [];
  const agrees = nums.length ? nums.every((n) => q.includes(n))
    : (() => { const c = bigrams(claim); return c.size > 0 && [...c].filter((x) => bigrams(q).has(x)).length / c.size >= BIGRAM_HIT; })();
  if (!agrees) return null;
  for (const src of sources) {
    const at = src.pages.findIndex((p) => findSpan(p, q) !== null);
    if (at >= 0) return { page: at + 1, paper: src.name, quote: q };
  }
  return null;
}
