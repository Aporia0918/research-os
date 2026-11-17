import { tr, trObj } from '../i18n';
import type { CompareResult, LocalLog } from '../logic/types';
import type { Detected, Task } from '../logic/nullworld';
import type { AuditReport } from '../logic/audit';
export type { Answer, CompareResult, Guidance, GuidanceDecision, GuidanceDecisionIn, Hypothesis, HypothesisStatus, KeyAction, Plan, PlanCategory, PlanItemEdit, Passage, LocalLog as ServerLogEntry } from '../logic/types';
export interface Health { status: string; version: string; db_ok: boolean }
export interface ServerLog { id: string; client_id: string; created: boolean; kind: string }
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
  constructor(baseUrl: string, private fetchImpl: FetchLike = (i, init) => fetch(i, init), private timeoutMs = 5000) { this.base = normalizeBaseUrl(baseUrl); }
  health(): Promise<Health> { return this.request('GET', '/api/v1/health'); }
  /** Pairing: the 8-character code from the computer's 设置 → 设备 → 配对设备; the session lives in the native cookie store. */
  pair(code: string, deviceName = 'Android'): Promise<{ authenticated: boolean; device_name?: string | null }> {
    return this.request('POST', '/api/v1/auth/pair', { code: code.trim().toUpperCase(), device_name: deviceName });
  }
  createLog(form: FormData, idempotencyKey: string): Promise<ServerLog> { return this.request('POST', '/api/v1/mobile/logs', form, { 'Idempotency-Key': idempotencyKey }); }
  compare(logId: string, versionId: string, idempotencyKey: string, useModel = false): Promise<CompareResult> {
    return this.request('POST', '/api/v1/mobile/compare', { log_id: logId, version_id: versionId, use_model: useModel }, { 'Idempotency-Key': idempotencyKey });
  }
  // 思维账本: entries by client id and repayments by a fixed key, so a replay after a dropped connection never counts twice.
  ledgerEntry(body: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
    return this.request('POST', '/api/v1/mind-ledger/entries', body, { 'Idempotency-Key': idempotencyKey });
  }
  ledgerAttempt(entryId: string, text: string, idempotencyKey: string): Promise<unknown> {
    return this.request('POST', `/api/v1/mind-ledger/entries/${encodeURIComponent(entryId)}/attempts`, { text, use_model: false }, { 'Idempotency-Key': idempotencyKey });
  }
  ledgerDue<T>(): Promise<T> { return this.request('GET', '/api/v1/mind-ledger/due'); }
  listLogs(limit = 20): Promise<LocalLog[]> { return this.request('GET', `/api/v1/mobile/logs?limit=${Math.min(20, Math.max(1, Math.floor(limit)))}`); }
  // 零世界考试: the computer runs the exam as a task that waits for the owner's approval of its exact payload.
  detectColumns(data: string): Promise<Detected> { return this.request('POST', '/api/v1/null-world/detect', { data }); }
  /** 规则体检: the computer parses the script inside a read root; nothing is run. */
  auditScript(path: string, subjectColumns: string[]): Promise<AuditReport> {
    return this.request('POST', '/api/v1/leak-audit/script', { path, subject_columns: subjectColumns });
  }
  createTask(kind: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<Task> {
    return this.request('POST', '/api/v1/tasks', { kind, payload }, { 'Idempotency-Key': idempotencyKey });
  }
  task(id: string): Promise<Task> { return this.request('GET', `/api/v1/tasks/${encodeURIComponent(id)}`); }
  cancelTask(id: string): Promise<Task> { return this.request('POST', `/api/v1/tasks/${encodeURIComponent(id)}/cancel`); }
  /** Approves exactly what was shown: the server refuses if the task changed since its hash was read. */
  async approveTask(id: string): Promise<void> {
    const q = new URLSearchParams({ subject_type: 'task', subject_id: id });
    const { hash } = await this.request<{ hash: string }>('GET', `/api/v1/approvals/subject-hash?${q}`);
    await this.request('POST', '/api/v1/approvals', { subject_type: 'task', subject_id: id, expected_hash: hash });
  }
  private async request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Hard limit: Promise.race, because the native HTTP bridge on Android may ignore AbortSignal.
    const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(new Error('timeout')); }, Math.min(5000, Math.max(1000, this.timeoutMs))); });
    const headers: Record<string, string> = { Accept: 'application/json', ...extra, 'x-researchos-client': 'android' };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    let text: string;
    try {
      res = await Promise.race([this.fetchImpl(this.base + path, { method, headers, body: body === undefined ? undefined : isForm ? body as FormData : JSON.stringify(body), credentials: 'include', signal: ctrl.signal }), limit]);
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
  plan_confirmed: '计划已经确认,不能再改。', plan_not_confirmed: '请先确认计划。',
  unauthenticated: '还没登录。请先在「设置」页配对。',
  plan_action_unapproved: '有关键动作需要你先批准或拒绝,再确认计划。',
  citation_gate_open: '有数字在引用页找不到原文(需确认),请逐条确认或否认后再确认计划。',
  guidance_confirmed: '这份指导已经确认,不能再改。',
  bad_hypothesis: '假设内容不合法(请写文字并至少勾一条计划条目)。',
  outside_roots: '这个文件不在电脑允许读取的文件夹里，电脑不会碰它。',
  bad_input: '读不了这个表格。请确认是 CSV 或 TSV 文件，第一行是列名，并且不超过 50 MB。',
  invalid_payload: '考试设置不完整或不合法，请重新认结构。',
  network: '电脑未连接，已用手机处理', busy: '电脑正忙,请稍后再试。',
  internal_error: '电脑出错了,请稍后再试。', http_error: '请求没有成功。',
});
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.status === 0 ? tr('电脑未连接，已用手机处理') : ERROR_ZH[e.code] ?? tr('请求没有成功(错误代码 {0})。', e.code);
  return (e as Error)?.message ?? String(e);
}
