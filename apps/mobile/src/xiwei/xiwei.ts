// 析微的手机端入口：调引擎（Web Worker 里的 Pyodide，看门狗超时就重启），以及各知识成分的掌握度（存本机）。
// 引擎的 JSON 形状见 packages/xiwei/xiwei/api.py。
import type { KV } from '../storage/kv';

export interface Problem { kind: string; expr: string; var: string; ask: string; rhs: string[]; slots: { id: string; type: string; value: unknown; name: string }[] }
export interface Answer { kind: string; value: string[]; text: string }
export type Segment = [text: string, ids: string | null];
export interface Premise { id: string; label: string; text: string; kc: string; key?: boolean }
export interface View { problem: Problem; segments: Segment[]; premises: Premise[] }
export interface Read extends View { claim: string | null; methods: string[] }
export interface Variant extends View { answer: Answer; changed: string; key: string; kc: string; bits: number; explain: string; options: Answer[] }
export interface Next { original: View & { answer: Answer }; aiDisagrees?: boolean; stop: boolean; variant: Variant | null; error?: string | null }
export interface Graded {
  verdict: 'correct' | 'missed' | 'review' | 'error' | 'calc' | 'unparsed'; correct: boolean; truth: Answer;
  missed: string[]; errors: string[]; mastery: Mastery; mastered: string[];
}
export type Mastery = Record<string, number>;
type Out<T> = (T & { ok: true }) | { ok: false; error: string };

/** The first call also loads Python and the wheels, so it gets longer (团队设定，按中端机估). */
const BOOT_MS = 90_000, CALL_MS = 20_000;
const MASTERY = 'xiwei.mastery.v1';

let worker: Worker | null = null, booted = false, seq = 0;
const waiting = new Map<number, (out: string) => void>();

/** null where the WebView has no Web Workers (very old Android): the call then says so instead of crashing the page. */
function spawn(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<{ id: number; out: string }>) => { booted = true; waiting.get(ev.data.id)?.(ev.data.out); };
  w.onerror = () => restart('引擎崩了，已经重启，再点一次');
  return w;
}

/** A stuck or crashed engine is thrown away; every waiting call gets the reason, the next call starts a fresh one. */
function restart(error: string): void {
  worker?.terminate(); worker = null; booted = false;
  const out = JSON.stringify({ ok: false, error });
  for (const done of [...waiting.values()]) done(out);
}

/** Start loading the engine before the first question, so the first answer comes sooner. */
export function warm(): void { worker ??= spawn(); }

export function engine(name: 'read', args: { text: string }): Promise<Out<Read>>;
export function engine(name: 'generate', args: { problem: Problem; mastery?: Mastery; methods?: string[]; claim?: string | null; exclude?: string[]; asked?: number }): Promise<Out<Next>>;
export function engine(name: 'grade', args: { original: Problem; variant: Problem; answer: string; mastery?: Mastery; choices?: number }): Promise<Out<Graded>>;
export function engine(name: string, args: object): Promise<Out<unknown>> {
  const w = (worker ??= spawn()), id = ++seq;
  if (!w) return Promise.resolve({ ok: false, error: '这台手机的系统浏览器太旧，跑不了析微引擎' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => restart('这道题引擎算太久了，已经停下'), booted ? CALL_MS : BOOT_MS);
    waiting.set(id, (out) => { clearTimeout(timer); waiting.delete(id); resolve(JSON.parse(out) as Out<unknown>); });
    w.postMessage({ id, name, args: JSON.stringify(args) });
  });
}

export async function loadMastery(kv: KV): Promise<Mastery> { return JSON.parse((await kv.get(MASTERY)) ?? '{}') as Mastery; }
export async function saveMastery(kv: KV, m: Mastery): Promise<void> { await kv.set(MASTERY, JSON.stringify({ ...(await loadMastery(kv)), ...m })); }

/** FNV-1a: a short stable name for a text. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}
/** The same problem always lands on the same debt. */
export const problemKey = (p: Problem): string => hash(JSON.stringify(p));
