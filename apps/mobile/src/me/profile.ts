// Who the user said they are on first open (plan 1.2, 2.2 第一次打开). Different people get different presets of the
// same app, never a different app; everything can be changed later in 设置. Age is self-reported only.
import type { KV } from '../storage/kv';
import type { Entry } from '../ledger/ledger';

export type Who = 'middle' | 'college' | 'exam' | 'work' | 'research' | 'other';
export interface Profile {
  who: Who;
  age?: number; // self-reported; under 18 turns on 未成年人模式
  guardian?: boolean; // 监护人已同意 (self-reported), needed for 生活 under 14
  slots: string[]; // free times "HH:MM" after class (课表的空档) or chosen by the user; reminders come only then
  remind: boolean;
}
export const WHO: { id: Who; label: string }[] = [
  { id: 'middle', label: '中学生' }, { id: 'college', label: '大学生' }, { id: 'exam', label: '备考' },
  { id: 'work', label: '上班' }, { id: 'research', label: '做科研' }, { id: 'other', label: '跳过' },
];
const KEY = 'profile.v1';

/** Presets by who (plan 1.2): the board to open on, and whether reminders start on (职场人 opens the app when they like). */
export function preset(who: Who): { board: Entry['board']; remind: boolean; slots: string[] } {
  return {
    board: who === 'research' ? '科研' : '学习',
    remind: who !== 'work' && who !== 'other',
    slots: who === 'research' ? ['12:10', '17:30'] : ['12:10', '17:40'], // after the morning and the afternoon classes
  };
}
export const isMinor = (p: Profile | null): boolean => p?.age !== undefined && p.age < 18;
/** 生活 under 14 needs a guardian's consent first (《人工智能拟人化互动服务管理暂行办法》第十四条). */
export const lifeLocked = (p: Profile | null): boolean => p?.age !== undefined && p.age < 14 && !p.guardian;

export async function loadProfile(kv: KV): Promise<Profile | null> {
  try { const p = JSON.parse((await kv.get(KEY)) ?? 'null') as Profile | null; return p && p.who ? p : null; } catch { return null; }
}
export async function saveProfile(kv: KV, p: Profile): Promise<void> {
  await kv.set(KEY, JSON.stringify({ ...p, slots: [...new Set(p.slots.filter(isTime))].sort() }));
}
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 连续使用提醒 (第十八条: every 2 hours; 未成年人模式 sooner): minutes since the sitting started, once past the limit. */
export function restDue(startMs: number, nowMs: number, minor: boolean): number | null {
  const min = Math.floor((nowMs - startMs) / 60000);
  return min >= (minor ? 40 : 120) ? min : null;
}
