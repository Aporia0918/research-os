// Port of researchos/services/mobile/plan_actions.py: key-action approval gate only, nothing is run or sent.
import { RuleError, requireNumbersClosed, tagItem as NumberTag, type RuleItem } from './numberGate';
import type { KeyAction } from '../logic/types';

export const KEY_ACTIONS = ['run_model_call', 'send_data_out', 'share'] as const;
export type { KeyAction };
export const DECISIONS = ['approve', 'reject'] as const;
export interface Approval { state: 'needs_approval' | 'approved' | 'rejected'; decided_at: string | null; device_id: string | null }

const RULES: [KeyAction, RegExp][] = [
  ['run_model_call', /\b(?:model call|call(?:ing)? (?:a|the) model|LLM|GPT|language model|inference API|cloud model)\b|调用模型/i],
  ['send_data_out', /\b(?:upload\w*|send\w* (?:the )?data|transmit\w*|sent to (?:a|the) server|cloud storage|off[- ]device)\b|上传|外发|发送数据/i],
  ['share', /\b(?:shar(?:e|ed|ing) (?:with|the|data|results?)|publish\w* (?:the )?data)\b|分享|共享/i],
];

export function detect(text: string): KeyAction | null {
  for (const [kind, rx] of RULES) if (rx.test(text)) return kind;
  return null;
}

export function tagAction<T extends RuleItem>(item: T, userKind?: string | null, prev?: T | null): T {
  if (userKind != null && !(KEY_ACTIONS as readonly string[]).includes(userKind)) {
    throw new RuleError(422, 'bad_key_action', 'key_action must be run_model_call, send_data_out or share');
  }
  const kind = userKind ?? detect(String(item.text ?? ''));
  if (kind === null) { const out = { ...item }; delete out.key_action; delete out.approval; return out; }
  if (prev && prev.key_action === kind && prev.text === item.text) {
    return { ...item, key_action: kind, approval: prev.approval };
  }
  return { ...item, key_action: kind, approval: { state: 'needs_approval', decided_at: null, device_id: null } as Approval };
}

export function unapproved(items: RuleItem[]): string[] {
  return items.filter(i => i.key_action && (i.approval as Approval | undefined)?.state === 'needs_approval').map(i => String(i.id));
}
export function requireActionsDecided(items: RuleItem[]): void {
  if (unapproved(items).length) {
    throw new RuleError(409, 'plan_action_unapproved',
      'every key action (model call, data out, share) needs your approve or reject first');
  }
}
export function decideAction<T extends RuleItem>(item: T, decision: string, at: string, deviceId: string): T {
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    throw new RuleError(422, 'bad_decision', 'decision must be approve or reject');
  }
  if (!item.key_action) throw new RuleError(422, 'not_key_action', 'only a key action needs approval');
  const approval: Approval = { state: decision === 'approve' ? 'approved' : 'rejected', decided_at: at, device_id: deviceId };
  return { ...item, approval };
}

/** Both gates (numbers + key actions) must be closed before the plan is confirmed. */
export function tagAll<T extends RuleItem>(items: T[], prev: T[] = []): T[] {
  const byId = new Map(prev.map(p => [p.id, p]));
  return items.map(i => tagAction(NumberTag(i, byId.get(i.id) ?? null), null, byId.get(i.id) ?? null));
}
export function requireConfirmable(items: RuleItem[]): void {
  requireActionsDecided(items);
  requireNumbersClosed(items);
}
