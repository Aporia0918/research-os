import type { KV } from '../storage/kv';
import { extractParams, sentences, compareLog } from '../rules/compare';
import { questions } from '../rules/questions';
import { citationCheck, paperSentences } from '../rules/citation';
import { tagAll, unapproved } from '../rules/planActions';
import { openNumberItems } from '../rules/numberGate';
import { newHypothesis, rowFor } from '../rules/hypothesis';
import { newId, saveJson, readJson, appError } from './store';
import type { Plan, PlanCategory, Guidance, GuidanceItem, GuidanceKind, LocalLog, Hypothesis, HypothesisStatus } from '../logic/types';
import type { LocalPaper } from './paperStore';

export const LAST_PLAN_KEY = 'plan.lastConfirmed.v1';
export function planKey(paperId: string): string { return `plan.${paperId}.v1`; }
export function guidanceKey(paperId: string): string { return `guidance.${paperId}.v1`; }
export function hypothesesKey(planId: string): string { return `hypotheses.${planId}.v1`; }

export function draftPlan(paper: LocalPaper, now = new Date(), id = newId()): Plan {
  const out: Plan = { id, version_id: paper.ref.versionId, state: 'draft', method: 'deterministic',
    items: [], created_at: now.toISOString(), updated_at: now.toISOString(), confirmed_at: null, status: 'ok' };
  const segments = paper.chunks.filter(c => c.section_role === 'methods');
  if (!segments.length) { out.status = 'method_section_not_found'; return out; }
  const used = new Set<string>();
  for (const c of segments) for (const raw of sentences(c.text)) {
    const text = raw.split(/\s+/).join(' ').trim(); if (used.has(text) || text.length < 25 || text.length > 600) continue;
    const params = extractParams(text);
    const material = /\b(?:recorded|acquired|using|electrode|amplifier|dataset|software|toolbox|Python|MATLAB|EEGLAB|MNE|PyTorch|GPU|subjects|participants|patients|channels)\b/i.test(text);
    const control = /\b(?:control|baseline|compared\b|training set|test set|validation|cross-validat|fold|split|accuracy|outcome|measure)\b/i.test(text);
    if (!params.length && !material && !control) continue;
    const category: PlanCategory = params.length ? 'variables' : control ? 'controls' : 'materials';
    out.items.push({ id: newId(), category, text, citation: { page_index: c.page_index, page_number: c.page_index + 1, quote: text }, source: 'paper', edited: false, section_role: 'methods' });
    used.add(text); if (out.items.length >= 40) break;
  }
  out.items = tagAll(out.items); return out;
}
export async function loadPlan(kv: KV, paperId: string): Promise<Plan | null> { return readJson<Plan>(kv, planKey(paperId)); }
export async function savePlan(kv: KV, p: Plan): Promise<Plan> { await saveJson(kv, planKey(p.version_id), p); return p; }
export async function updatePlan(kv: KV, p: Plan, now = new Date()): Promise<Plan> { return savePlan(kv, { ...p, items: tagAll(p.items, p.items), updated_at: now.toISOString() }); }
export async function confirmPlan(kv: KV, p: Plan): Promise<Plan> {
  if (p.state !== 'draft' || unapproved(p.items).length) appError('关键动作需要你先批准或拒绝。');
  if (openNumberItems(p.items).length) appError('数字需要你先确认或否认。');
  return savePlan(kv, { ...p, state: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}
export async function planAction(kv: KV, p: Plan, id: string, decision: 'approve' | 'reject'): Promise<Plan> {
  return savePlan(kv, { ...p, items: p.items.map(i => i.id === id ? decideLocalAction(i, decision) : i) });
}
export async function planNumber(kv: KV, p: Plan, id: string, decision: 'confirm_match' | 'reject_match'): Promise<Plan> {
  return savePlan(kv, { ...p, items: p.items.map(i => i.id === id ? decideLocalNumber(i, decision) : i) });
}
function guidanceInput(kind: GuidanceKind, paper: LocalPaper, plan: Plan | null, text: string): GuidanceItem[] {
  if (kind === 'citation_check') return citationCheck(text, paperSentences(paper.chunks), paper.doc.pages.map(p => p.text)).map(i => ({ ...i, id: newId() }));
  if (kind === 'methods_check' && plan) {
    const t = text.toLowerCase();
    return plan.items.map(i => {
      const tokens = [...i.text.toLowerCase().matchAll(/[a-z][a-z0-9.-]{3,}/g)].map(m => m[0]);
      const overlap = tokens.filter(w => t.includes(w)).length;
      const present = (tokens.length >= 3 && overlap / tokens.length >= 0.5) || (extractParams(i.text).some(n => text.includes(n.raw)) && overlap >= 3);
      return { id: newId(), decision: null, user_text: null, citation: i.citation, plan_item_id: i.id, category: i.category, plan_text: i.text, verdict: present ? 'present' as const : 'missing' as const };
    }).sort((a, b) => Number(a.verdict === 'present') - Number(b.verdict === 'present'));
  }
  return [];
}
function decideLocalAction(item: Plan['items'][number], decision: 'approve' | 'reject'): Plan['items'][number] {
  return { ...item, approval: { state: decision === 'approve' ? 'approved' : 'rejected', decided_at: new Date().toISOString(), device_id: 'this-phone' } };
}
function decideLocalNumber(item: Plan['items'][number], decision: 'confirm_match' | 'reject_match'): Plan['items'][number] {
  if (!item.number_gate) return item;
  return { ...item, number_gate: { ...item.number_gate, state: decision, decided_at: new Date().toISOString(), device_id: 'this-phone' } };
}
export function runGuidance(paper: LocalPaper, plan: Plan | null, kind: GuidanceKind, text: string, logs: LocalLog[]): Guidance {
  const base: Guidance = { id: newId(), kind, version_id: paper.ref.versionId, plan_id: plan?.id ?? null, state: 'draft', method: 'deterministic', status: 'ok', input_text: text, items: [], confirmed_at: null };
  if ((kind === 'methods_check' || kind === 'predict') && (!plan || plan.state !== 'confirmed')) appError('请先在「计划」页确认一个计划。');
  if (kind === 'questions') { const r = questions(paper.chunks, text, paper.doc.pages.map(p => p.text)); base.status = r.status; base.items = r.items.map(i => ({ ...i, id: newId() })); }
  else if (kind === 'predict') for (const log of logs) for (const c of compareLog(log.text, paper.chunks, paper.doc.pages.map(p => p.text))) {
    const item: GuidanceItem = { id: newId(), decision: null, citation: c.citation, kind: c.status === 'match' ? 'consistent' : c.status === 'mismatch' ? 'adjust' : 'not_recorded', log_text: log.text,
      suggestion: c.status === 'match' ? `记录中的 ${c.parameter} 与论文一致。` : c.status === 'mismatch' ? `记录为 ${c.log_value?.join('–')},论文为 ${c.paper_value?.join('–')};是否调整由你决定。` : `论文里没有可与 ${c.parameter} 直接对照的数值。`,
      prediction: '辅助定位原文、由你判断。相近匹配要你自己判断,系统分不出真假。' };
    base.items.push(item);
  } else base.items = guidanceInput(kind, paper, plan, text);
  return base;
}
export async function loadGuidance(kv: KV, paperId: string): Promise<Guidance | null> { return readJson<Guidance>(kv, guidanceKey(paperId)); }
export async function saveGuidance(kv: KV, g: Guidance): Promise<Guidance> { await saveJson(kv, guidanceKey(g.version_id), g); return g; }
export async function confirmGuidance(kv: KV, g: Guidance): Promise<Guidance> {
  if (g.items.some(i => i.needs_confirmation && !['confirm_match', 'reject_match'].includes(i.decision ?? ''))) appError('每条“相近原文”都需要你确认或否定后,才能确认。');
  return saveGuidance(kv, { ...g, state: 'confirmed', confirmed_at: new Date().toISOString() });
}
export async function loadHypotheses(kv: KV, planId: string): Promise<Hypothesis[]> { return (await readJson<Hypothesis[]>(kv, hypothesesKey(planId))) ?? []; }
async function saveHypotheses(kv: KV, planId: string, list: Hypothesis[]): Promise<void> { await saveJson(kv, hypothesesKey(planId), list); }
export async function createHypothesis(kv: KV, plan: Plan, text: string, ids: string[]): Promise<Hypothesis> {
  const rule = newHypothesis(text, plan.items.filter(i => ids.includes(i.id))); const now = new Date().toISOString();
  const h: Hypothesis = { ...rule, id: newId(), plan_id: plan.id, status_set_at: null, comparison: null, created_at: now, updated_at: now };
  const list = await loadHypotheses(kv, plan.id); await saveHypotheses(kv, plan.id, [...list, h]); return h;
}
export function hypothesisRows(h: Hypothesis, items: readonly { id: string; text: string; citation: { page_index?: number; page_number: number; quote: string } | null }[], entries: LocalLog[]) {
  return { log_ids: entries.map(e => e.id), rows: items.filter(i => h.plan_item_ids.includes(i.id)).map(i => rowFor(i, entries)), compared_at: new Date().toISOString() };
}
export async function compareHypothesis(kv: KV, plan: Plan, h: Hypothesis, entries: LocalLog[]): Promise<Hypothesis> {
  const out = { ...h, comparison: hypothesisRows(h, plan.items, entries), updated_at: new Date().toISOString() }; await putHypothesis(kv, out); return out;
}
async function putHypothesis(kv: KV, h: Hypothesis): Promise<void> { const list = await loadHypotheses(kv, h.plan_id); await saveHypotheses(kv, h.plan_id, list.map(x => x.id === h.id ? h : x)); }
function setLocalHypothesisStatus(h: Hypothesis, status: HypothesisStatus): Hypothesis {
  if (!['pending', 'supported', 'refuted', 'insufficient'].includes(status)) throw new Error('invalid_status');
  const at = new Date().toISOString();
  return { ...h, status, status_label: { pending: '待验证', supported: '支持', refuted: '不支持', insufficient: '证据不足' }[status], status_set_at: at,
    history: [...h.history, { from: h.status, to: status, at, device_id: 'this-phone' }] };
}
export async function setHypothesisStatus(kv: KV, h: Hypothesis, status: HypothesisStatus): Promise<Hypothesis> {
  const out = { ...setLocalHypothesisStatus(h, status), updated_at: new Date().toISOString() }; await putHypothesis(kv, out); return out;
}
