// UI language. Chinese (zh) is the default; the phone/browser language is never consulted.
// Keys are the Chinese strings themselves; EN maps them to English. Placeholders: {0}, {1}, ...
import type { KV } from '../storage/kv';
import { EN } from './en';

export type Lang = 'zh' | 'en';
export const LANG_KEY = 'settings.lang.v1';
let current: Lang = 'zh';
const listeners = new Set<(l: Lang) => void>();

export function getLang(): Lang { return current; }
export function setLang(l: Lang): void {
  current = l === 'en' ? 'en' : 'zh';
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
  if (typeof document !== 'undefined') document.title = tr('论文实验助手');
  listeners.forEach(f => f(current));
}
export function onLang(f: (l: Lang) => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export async function loadLang(kv: KV): Promise<Lang> { const v = await kv.get(LANG_KEY); return v === 'en' ? 'en' : 'zh'; }
export async function saveLang(kv: KV, l: Lang): Promise<void> { await kv.set(LANG_KEY, l); }
export function dateLocale(): string { return current === 'en' ? 'en-US' : 'zh-CN'; }
export function fmtDate(d: string | number | Date): string { return new Date(d).toLocaleString(dateLocale()); }

/** Translate a Chinese UI string into the current language and fill {0}, {1}, ... */
export function tr(zh: string, ...args: unknown[]): string {
  const s = current === 'en' ? (EN[zh] ?? zh) : zh;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m)) : s;
}

/** Wrap a module-level constant (object/array of Chinese strings) so every string is translated when it is read. */
export function trObj<T>(o: T): T {
  if (o === null || typeof o !== 'object') return o;
  return new Proxy(o as object, {
    get(target, p, r) {
      const v = Reflect.get(target, p, r);
      if (typeof v === 'string') return tr(v);
      if (v && typeof v === 'object') return trObj(v);
      return v;
    },
  }) as T;
}
