// 生活这本账 (plan 2.2): its own table on this phone, never synced, never read by the 学习 or 科研 ledger. It keeps one
// line per decision, in two kinds only: 自己拿的主意 (own) and 交给 AI 拿的主意 (ai). No checking, no repaying, no
// reminders; once a week a fixed template says how the week went. What was said in the chat is never stored here.
import type { KV } from '../storage/kv';
import { addDays } from './ledger';

export interface Decision { id: string; kind: 'own' | 'ai'; title: string; on: string }
export interface Week { from: string; to: string; own: number; ai: number; balance: number; named: string | null }

const KEY = 'lifebook.v1';
const REVIEW_OFF = 'lifebook.reviewOff.v1';
export const TITLE_MAX = 30;

/** Monday of the week that holds `day` (weeks run Monday to Sunday). */
export function monday(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export class LifeBook {
  constructor(private kv: KV) {}

  async all(): Promise<Decision[]> { return JSON.parse((await this.kv.get(KEY)) ?? '[]') as Decision[]; }

  /** One line, cut to TITLE_MAX characters; an empty title records nothing. */
  async add(kind: Decision['kind'], title: string, today: string, id: string): Promise<Decision | null> {
    const t = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    if (!t) return null;
    const es = await this.all();
    const d = { id, kind, title: t, on: today };
    await this.kv.set(KEY, JSON.stringify([...es.filter((e) => e.id !== id), d]));
    return d;
  }

  /** 一键清空: the whole life ledger goes; the 学习 and 科研 ledger is a different table and is untouched. */
  async clear(): Promise<void> { await this.kv.set(KEY, '[]'); }

  async reviewOn(): Promise<boolean> { return (await this.kv.get(REVIEW_OFF)) !== '1'; }
  async setReview(on: boolean): Promise<void> { await this.kv.set(REVIEW_OFF, on ? '' : '1'); }

  /** This week's counts for the fixed review line: no rank, no score; the latest decision of the user's own is named. */
  async week(today: string): Promise<Week> {
    const from = monday(today), to = addDays(from, 6);
    const es = (await this.all()).filter((e) => e.on >= from && e.on <= to);
    const own = es.filter((e) => e.kind === 'own');
    return { from, to, own: own.length, ai: es.length - own.length, balance: 2 * own.length - es.length,
      named: own.length ? own[own.length - 1].title : null };
  }
}
