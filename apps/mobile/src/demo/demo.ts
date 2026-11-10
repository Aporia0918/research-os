/** Demo mode: works with no network. Uses only results pre-computed from real local-rule runs on a public open-access
 *  paper (EEGNet) and a sample log; nothing here comes from the user's own papers or lab. Every demo screen shows
 *  the label DEMO_LABEL. */
import bundle from './bundle.json';
import type { Answer, CompareResult, Plan } from '../logic/types';
import type { KV } from '../storage/kv';

export const DEMO_LABEL = '演示数据';
export const DEMO_KEY = 'settings.demoMode.v1';
export const demoPaper = bundle.paper;
export const demoAnswer = bundle.answer as unknown as Answer;
export const demoLog = bundle.log;
export const demoCompare = bundle.compare as unknown as CompareResult;
export const demoSource = bundle.source;
/** A fresh copy each time so local edits in demo mode never change the bundled sample. */
export function demoPlan(): Plan { return JSON.parse(JSON.stringify(bundle.plan)) as Plan; }

export async function loadDemo(kv: KV): Promise<boolean> { return (await kv.get(DEMO_KEY)) === '1'; }
export async function saveDemo(kv: KV, on: boolean): Promise<void> { await kv.set(DEMO_KEY, on ? '1' : '0'); }
