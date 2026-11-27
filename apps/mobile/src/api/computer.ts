import { tr, trObj } from '../i18n';
export interface Health { status: string; version: string; db_ok: boolean }
/** 多设备推送: what changed on the owner's other devices since this phone last asked. */
export interface Push { id: string; kind: 'recall' | 'recall_settled' | 'entry' | 'used'; entity_id: string; text: string; created_at: string }
export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(u)) throw new Error(tr('电脑地址必须以 http:// 或 https:// 开头'));
  return u;
}
/** Optional computer service; no construction is done by core screens. */
export class ResearchOsClient {
  private base: string;
  /** `token`: the session from pairing (api/session.ts keeps it), sent as a bearer header on every request. */
  constructor(baseUrl: string, private fetchImpl: FetchLike = (i, init) => fetch(i, init), private timeoutMs = 5000, private token = '') { this.base = normalizeBaseUrl(baseUrl); }
  health(): Promise<Health> { return this.request('GET', '/api/v1/health'); }
  /** Pairing: the 8-character code from the computer's 设置 → 设备 → 配对设备. The computer answers with the session token
   * itself (want_token), because a cookie in the native HTTP layer is not reliably kept across app restarts. */
  pair(code: string, deviceName = 'Android'): Promise<{ authenticated: boolean; device_name?: string | null; token?: string | null }> {
    return this.request('POST', '/api/v1/auth/pair', { code: code.trim().toUpperCase(), device_name: deviceName, want_token: true });
  }
  /** Whether the kept session still counts on the computer (it ends when it expires or is revoked there). */
  authState(): Promise<{ authenticated: boolean; device_name?: string | null }> { return this.request('GET', '/api/v1/auth/state'); }
  pushes(): Promise<Push[]> { return this.request('GET', '/api/v1/pushes'); }
  seenPushes(ids: string[]): Promise<{ seen: number }> { return this.request('POST', '/api/v1/pushes/seen', { ids }); }
  // 思维账本: entries by client id and repayments by a fixed key, so a replay after a dropped connection never counts twice.
  ledgerEntry(body: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
    return this.request('POST', '/api/v1/mind-ledger/entries', body, { 'Idempotency-Key': idempotencyKey });
  }
  ledgerAttempt(entryId: string, text: string, idempotencyKey: string): Promise<unknown> {
    return this.request('POST', `/api/v1/mind-ledger/entries/${encodeURIComponent(entryId)}/attempts`, { text, use_model: false }, { 'Idempotency-Key': idempotencyKey });
  }
  ledgerDue<T>(): Promise<T> { return this.request('GET', '/api/v1/mind-ledger/due'); }
  ledgerMark(entryId: string, m: Record<string, unknown>): Promise<unknown> { return this.request('PATCH', `/api/v1/mind-ledger/entries/${encodeURIComponent(entryId)}`, m); }
  ledgerRecall(entryId: string, r: Record<string, unknown>): Promise<unknown> { return this.request('POST', `/api/v1/mind-ledger/entries/${encodeURIComponent(entryId)}/recalls`, r); }
  private async request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Hard limit: Promise.race, because the native HTTP bridge on Android may ignore AbortSignal.
    const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(new Error('timeout')); }, Math.min(5000, Math.max(1000, this.timeoutMs))); });
    const headers: Record<string, string> = { Accept: 'application/json', ...extra, 'x-researchos-client': 'android' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    let text: string;
    try {
      res = await Promise.race([this.fetchImpl(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include', signal: ctrl.signal }), limit]);
      text = await Promise.race([res.text(), limit]);
    }
    catch { throw new ApiError(0, 'network', tr('电脑未连接，已用手机处理')); }
    finally { clearTimeout(timer); }
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* no JSON details exposed */ }
    if (!res.ok) {
      const d = (data ?? {}) as { code?: string };
      throw new ApiError(res.status, d.code ?? 'http_error', res.status === 0 ? tr('电脑未连接，已用手机处理') : 'request_failed');
    }
    return data as T;
  }
}
export const ERROR_ZH: Record<string, string> = trObj({
  not_found: '找不到这项内容。', bad_decision: '这个选择不合法,请重新选。',
  unauthenticated: '还没登录。请先在「设置」页配对。',
  network: '电脑未连接，已用手机处理', busy: '电脑正忙,请稍后再试。',
  internal_error: '电脑出错了,请稍后再试。', http_error: '请求没有成功。',
});
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.status === 0 ? tr('电脑未连接，已用手机处理') : ERROR_ZH[e.code] ?? tr('请求没有成功(错误代码 {0})。', e.code);
  return (e as Error)?.message ?? String(e);
}
