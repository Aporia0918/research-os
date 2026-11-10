// Port of researchos/services/mobile/hypothesis.py (pure part).
// Status is chosen by the USER only; comparison never concludes anything. 辅助参考.
import { extractParams } from './compare';
import { NUM_RX, dedupe } from './numberGate';

export const STATUSES = ['pending', 'supported', 'refuted', 'insufficient'] as const;
export type HypStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<HypStatus, string> = { pending: '待验证', supported: '支持', refuted: '不支持', insufficient: '证据不足' };
export const MAX_TEXT = 500; export const MAX_ITEMS = 20; export const MAX_LOGS = 10;
export const NOT_RECORDED = '日志未记录';
export const NO_PAPER = '无论文依据';

export interface NumberCheck { state: 'ok' | 'needs_confirmation'; missing: string[]; label?: string; reason?: string }
export interface HypItemInput { id: string; text: string; citation?: { quote: string; page_number?: number } | null }

export function nums(text: string): string[] { return [...String(text ?? '').matchAll(NUM_RX)].map(m => m[0]); }

export function numberCheck(text: string, cited: HypItemInput[]): NumberCheck {
  const quotes = cited.filter(i => i.citation).map(i => i.citation!.quote).join(' ');
  const found = new Set(nums(quotes));
  const missing = dedupe(nums(text)).filter(n => !found.has(n));
  if (!missing.length) return { state: 'ok', missing: [] };
  return { state: 'needs_confirmation', label: '需确认', missing,
    reason: 'number not found verbatim on the cited page of a linked plan item' };
}

export interface StatusEntry { from: HypStatus; to: HypStatus; at: string; device_id: string }
export function setStatus<T extends { status: HypStatus; history: StatusEntry[] }>(h: T, status: string, at: string, deviceId: string): T & { status_label: string; status_set_at: string } {
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new Error('bad_status: status must be pending, supported, refuted or insufficient');
  }
  return { ...h, status: status as HypStatus, status_label: STATUS_LABEL[status as HypStatus], status_set_at: at,
    history: [...h.history, { from: h.status, to: status as HypStatus, at, device_id: deviceId }] };
}
export function newHypothesis(textImage: string, items: HypItemInput[]) {
  const text = textImage.split(/\s+/).join(' ').trim();
  if (!text || text.length > MAX_TEXT || !items.length || items.length > MAX_ITEMS) {
    throw new Error('bad_hypothesis: a hypothesis needs 1-500 characters of text and 1-20 plan items');
  }
  return { text, plan_item_ids: items.map(i => i.id), status: 'pending' as HypStatus,
    status_label: STATUS_LABEL.pending, history: [] as StatusEntry[], number_check: numberCheck(text, items) };
}

export interface LogEntry { id: string; text: string }
export interface CompareRow {
  plan_item_id: string; item_text: string; paper_value: string | null; page_number: number | null;
  label: string | null; log_values: { log_id: string; value: string }[];
}
export function rowFor(item: HypItemInput, entries: LogEntry[]): CompareRow {
  const cite = item.citation;
  if (!cite) {
    return { plan_item_id: item.id, item_text: item.text, paper_value: null, page_number: null,
      label: NO_PAPER, log_values: [] };
  }
  const paper = extractParams(cite.quote);
  const units = new Set(paper.map(p => p.unit));
  const found = entries.flatMap(e => extractParams(e.text).filter(p => units.has(p.unit)).map(p => ({ log_id: e.id, value: p.raw })));
  return { plan_item_id: item.id, item_text: item.text,
    paper_value: paper.map(p => p.raw).join(', ') || null, page_number: cite.page_number ?? null,
    label: found.length ? null : NOT_RECORDED, log_values: found };
}
export function compareHypothesis(items: HypItemInput[], entries: LogEntry[], at: string) {
  return { log_ids: entries.map(e => e.id), rows: items.map(i => rowFor(i, entries)), compared_at: at };
}
