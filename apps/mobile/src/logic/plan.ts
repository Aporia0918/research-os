import { tr, trObj } from '../i18n';
/** Pure helpers for the plan review screen (draft -> confirmed). */
import type { KeyAction, Plan, PlanCategory, PlanItem, PlanItemEdit } from './types';

export const CATEGORY_LABEL: Record<PlanCategory, string> = trObj({
  variables: '变量', controls: '对照', materials: '材料/设备',
});
export const CATEGORIES: PlanCategory[] = ['variables', 'controls', 'materials'];

export const NO_METHOD_LABEL = '未找到方法章节';
/** The local found no Methods-like heading in the paper, so it drafted nothing (it never guesses). */
export function methodSectionMissing(p: Plan | null): boolean { return !!p && p.status === 'method_section_not_found'; }

export function canEdit(p: Plan | null): boolean { return !!p && p.state === 'draft'; }

export function grouped(items: PlanItem[]): Record<PlanCategory, PlanItem[]> {
  const g: Record<PlanCategory, PlanItem[]> = { variables: [], controls: [], materials: [] };
  for (const i of items) g[i.category]?.push(i);
  return g;
}

/** Local edit of a draft; throws on a confirmed plan so the UI can never change it. */
export function editItem(p: Plan, id: string, change: Partial<Pick<PlanItem, 'text' | 'category'>>): Plan {
  if (!canEdit(p)) throw new Error(tr('计划已确认,不能再改'));
  return { ...p, items: p.items.map(i => i.id === id ? { ...i, ...change, edited: true } : i) };
}
export function removeItem(p: Plan, id: string): Plan {
  if (!canEdit(p)) throw new Error(tr('计划已确认,不能再改'));
  return { ...p, items: p.items.filter(i => i.id !== id) };
}
export function addItem(p: Plan, category: PlanCategory, text: string, newId: string): Plan {
  if (!canEdit(p)) throw new Error(tr('计划已确认,不能再改'));
  return { ...p, items: [...p.items, { id: newId, category, text, citation: null, source: 'user', edited: true }] };
}
/** Body for PUT /plans/{id}/items: local ids are kept, local-only items (id starting "local-") are sent without id. */
export function toEdits(p: Plan): PlanItemEdit[] {
  return p.items.map(i => i.id.startsWith('local-') ? { category: i.category, text: i.text }
    : { id: i.id, category: i.category, text: i.text });
}
/** Demo mode confirm: same rule as the local (explicit action, timestamp kept on a second confirm). */
export function confirmLocal(p: Plan, now = new Date()): Plan {
  return p.state === 'confirmed' ? p : { ...p, state: 'confirmed', confirmed_at: now.toISOString() };
}

/** W6 2.3 key actions: shown apart from normal steps; each needs the user's approve or reject before Confirm. */
export const KEY_ACTION_LABEL: Record<KeyAction, string> = trObj({
  run_model_call: '关键动作:调用模型', send_data_out: '关键动作:数据送出设备', share: '关键动作:分享',
});
export const APPROVAL_LABEL = trObj({ needs_approval: '待你批准或拒绝', approved: '你已批准', rejected: '你已拒绝(不执行)' } as const);
export function openKeyActions(p: Plan | null): PlanItem[] {
  return p ? p.items.filter(i => !!i.key_action && i.approval?.state === 'needs_approval') : [];
}
export function canConfirm(p: Plan | null): boolean { return canEdit(p) && openKeyActions(p).length === 0; }
/** Demo mode decision: same rule as the local (draft only, time recorded). */
export function decideLocal(p: Plan, id: string, decision: 'approve' | 'reject', now = new Date()): Plan {
  if (!canEdit(p)) throw new Error(tr('计划已确认,不能再改'));
  return { ...p, items: p.items.map(i => i.id === id && i.key_action
    ? { ...i, approval: { state: decision === 'approve' ? 'approved' : 'rejected', decided_at: now.toISOString(), device_id: 'demo' } } : i) };
}
/** W6 1.11 numbers-and-citation gate: the local marks numbers it cannot find on the cited page as 需确认. */
export const NUMBER_GATE_LABEL = trObj({ needs_confirmation: '需确认', confirm_match: '你已确认此数值', reject_match: '你已否认此数值' } as const);
export function openNumberGates(p: Plan | null): PlanItem[] {
  return p ? p.items.filter(i => i.number_gate?.state === 'needs_confirmation') : [];
}
export function decideNumberLocal(p: Plan, id: string, d: 'confirm_match' | 'reject_match', now = new Date()): Plan {
  if (!canEdit(p)) throw new Error(tr('计划已确认,不能再改'));
  return { ...p, items: p.items.map(i => i.id === id && i.number_gate && i.number_gate.state !== 'ok'
    ? { ...i, number_gate: { ...i.number_gate, state: d, decided_at: now.toISOString(), device_id: 'demo' } } : i) };
}
