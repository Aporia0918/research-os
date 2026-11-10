// Port of researchos/services/mobile/number_gate.py (pure part; DB/API replaced by thrown RuleError).
// A plan item carrying a number is only "ok" when every number sits verbatim in the cited page quote;
// else needs_confirmation (需确认) and the plan cannot be confirmed. 辅助定位原文、由你判断.
export const NUM_RX = /(?<![\w.])\d+(?:\.\d+)?(?!\d)/g;
export const DECISIONS = ['confirm_match', 'reject_match'] as const;
export type NumberDecision = typeof DECISIONS[number];
export type KeyAction = 'run_model_call' | 'send_data_out' | 'share';
export type GateState = 'ok' | 'needs_confirmation' | NumberDecision;

export interface Citation { quote: string; page_number?: number }
export interface NumberGate {
  state: GateState; missing: string[]; label?: string; reason?: string;
  decided_at?: string | null; device_id?: string | null;
}
export interface RuleItem {
  id?: string; text: string; category?: string;
  citation?: Citation | null; number_gate?: NumberGate | null;
  key_action?: KeyAction | null; approval?: unknown; [k: string]: unknown;
}
export class RuleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'RuleError'; }
}

export function numbers(text: string): string[] {
  return [...String(text ?? '').matchAll(NUM_RX)].map(m => m[0]);
}
export function dedupe<T>(xs: T[]): T[] { return [...new Set(xs)]; }

export function missingNumbers(text: string, quote?: string | null): string[] {
  const have = new Set(numbers(String(quote ?? '').split(/\s+/).join(' ')));
  return dedupe(numbers(text)).filter(n => !have.has(n));
}

export function tagItem<T extends RuleItem>(item: T, prev?: T | null): T & { number_gate?: NumberGate } {
  const out = { ...item } as T & { number_gate?: NumberGate }; delete out.number_gate;
  if (!numbers(String(item.text ?? '')).length) return out;
  const quote = item.citation?.quote; const miss = missingNumbers(String(item.text), quote);
  if (!miss.length) { out.number_gate = { state: 'ok', missing: [] }; return out; }
  const keep = prev?.number_gate;
  if (prev && prev.text === item.text && keep && (DECISIONS as readonly string[]).includes(keep.state)) { out.number_gate = keep; return out; }
  const why = !quote ? 'no paper citation' : 'not found verbatim on the cited page';
  out.number_gate = { state: 'needs_confirmation', missing: miss, label: '需确认', reason: `number(s) ${miss.join(', ')}: ${why}; 辅助参考, 由你判断` };
  return out;
}
export function openNumberItems(items: RuleItem[]): string[] {
  return items.filter(i => i.number_gate?.state === 'needs_confirmation').map(i => String(i.id));
}
export function requireNumbersClosed(items: RuleItem[]): void {
  if (openNumberItems(items).length) {
    throw new RuleError(409, 'citation_gate_open',
      'every number without a matching quote on its page needs your confirm or reject first');
  }
}
export function decideNumber<T extends RuleItem>(item: T, decision: string, at: string, deviceId: string): T {
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    throw new RuleError(422, 'bad_decision', 'decision must be confirm_match or reject_match');
  }
  const g = item.number_gate;
  if (!g || g.state === 'ok') throw new RuleError(422, 'not_gated', 'this item has no number that needs your confirmation');
  return { ...item, number_gate: { ...g, state: decision as NumberDecision, decided_at: at, device_id: deviceId } };
}
