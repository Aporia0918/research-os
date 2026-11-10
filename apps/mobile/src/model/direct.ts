// Direct model client: phone -> model API (OpenAI-compatible /chat/completions). No computer involved.
// Errors are plain Chinese (via tr); the key is never part of any message, log or thrown error.
import { tr } from '../i18n';
import type { ModelSettings } from './settings';

export type ModelErrorCode = 'no_key' | 'no_base_url' | 'bad_base_url' | 'timeout' | 'offline' | 'unauthorized' | 'rate_limited' | 'http' | 'bad_response';
export class ModelError extends Error {
  constructor(public code: ModelErrorCode, public status = 0) { super(code); this.name = 'ModelError'; }
}
export function describeModelError(e: unknown): string {
  const code = e instanceof ModelError ? e.code : 'offline';
  const status = e instanceof ModelError ? e.status : 0;
  switch (code) {
    case 'no_key': return tr('还没有填模型密钥,先用规则模式。');
    case 'no_base_url': return tr('还没有填模型地址(Base URL),先用规则模式。');
    case 'bad_base_url': return tr('模型地址必须以 http:// 或 https:// 开头。');
    case 'timeout': return tr('模型服务超时没有回应,已改用规则模式。');
    case 'unauthorized': return tr('模型服务拒绝了这个密钥(错误代码 {0}),请检查密钥。已改用规则模式。', status);
    case 'rate_limited': return tr('模型服务太忙或额度用完(错误代码 {0}),已改用规则模式。', status);
    case 'http': return tr('模型服务出错(错误代码 {0}),已改用规则模式。', status);
    case 'bad_response': return tr('模型服务的回复看不懂,已改用规则模式。');
    default: return tr('连不上模型服务(请检查网络和地址),已改用规则模式。');
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function chat(s: ModelSettings, key: string, messages: ChatMessage[], f: FetchLike = fetch): Promise<string> {
  if (!key) throw new ModelError('no_key');
  if (!s.baseUrl) throw new ModelError('no_base_url');
  if (!/^https?:\/\//i.test(s.baseUrl)) throw new ModelError('bad_base_url');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.header === 'x-api-key') headers['x-api-key'] = key; else headers.Authorization = `Bearer ${key}`;
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new ModelError('timeout')); }, Math.min(8000, Math.max(1000, s.timeoutMs)) ); });
  try {
    const res = await Promise.race([
      f(`${s.baseUrl.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers, signal: ctl.signal,
        body: JSON.stringify({ model: s.model || undefined, messages }) }),
      timeout]);
    if (res.status === 401 || res.status === 403) throw new ModelError('unauthorized', res.status);
    if (res.status === 429 || res.status === 402) throw new ModelError('rate_limited', res.status);
    if (!res.ok) throw new ModelError('http', res.status);
    let body: unknown;
    try { body = await Promise.race([res.json(), timeout]); } catch (e) { if (e instanceof ModelError) throw e; throw new ModelError('bad_response'); }
    const text = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ModelError('bad_response');
    return text;
  } catch (e) {
    if (e instanceof ModelError) throw e;
    throw new ModelError('offline');           // network error; original error is dropped so nothing sensitive leaks
  } finally { clearTimeout(timer); }
}

export type Outcome<T> = { mode: 'model'; text: string } | { mode: 'rules'; result: T; reason: string };
/** Try the model; on any failure (or no key) run the rule-only path and say why, in plain Chinese. */
export async function withFallback<T>(s: ModelSettings, key: string, messages: ChatMessage[], rules: () => T, f?: FetchLike): Promise<Outcome<T>> {
  try { return { mode: 'model', text: await chat(s, key, messages, f) }; }
  catch (e) { return { mode: 'rules', result: rules(), reason: describeModelError(e) }; }
}
