/** Shared, on-device document, experiment and guidance records. No transport is involved. */
export interface Citation {
 evidence_id?: string; page_index?: number; page_number: number; quote: string; [key: string]: unknown }
export interface Passage { label: string; version_id: string; title?: string; page_index: number; text: string }
export interface Answer { id?: string; status: string; question?: string; reason?: string; passages?: Passage[]; answer?: { text?: string; sentences?: { text: string; citations?: { page_index?: number; label?: string }[] }[] } | null; [k: string]: unknown }
export interface LocalLog { id: string; text: string; created_at: string }
import type { Finding } from '../rules/compare';
export type { Finding as CompareItem } from '../rules/compare';
export interface CompareResult { log_id: string; version_id: string; method: string; note?: string | null; items: Finding[]; mismatches: number }
export type PlanCategory = 'variables' | 'controls' | 'materials';
export interface PlanItem { id: string; category: PlanCategory; text: string; citation: Citation | null; source: 'paper' | 'model' | 'user'; edited: boolean; section_role?: string | null; key_action?: KeyAction | null; approval?: KeyActionApproval | null; number_gate?: NumberGate | null; [key: string]: unknown }
export type KeyAction = 'run_model_call' | 'send_data_out' | 'share';
export interface KeyActionApproval { state: 'needs_approval' | 'approved' | 'rejected'; decided_at: string | null; device_id: string | null }
export interface NumberGate { state: 'ok' | 'needs_confirmation' | 'confirm_match' | 'reject_match'; missing: string[]; label?: string; reason?: string; decided_at?: string; device_id?: string }
export interface Plan { id: string; version_id: string; state: 'draft' | 'confirmed'; method: string; items: PlanItem[]; created_at: string; updated_at: string; confirmed_at: string | null; status?: 'ok' | 'method_section_not_found' }
export interface PlanItemEdit { id?: string; category: PlanCategory; text: string; key_action?: KeyAction }
export type GuidanceKind = 'questions' | 'citation_check' | 'methods_check' | 'predict';
export type GuidanceDecision = 'adopt' | 'ignore' | 'edit' | 'handled' | 'not_applicable' | 'confirm_match' | 'reject_match';
export interface MatchCandidate { page_number: number; quote: string; coverage: number }
export interface GuidanceItem { id: string; decision: GuidanceDecision | null; user_text?: string | null; citation: Citation | null; topic?: string; question?: string; why?: string; source?: string; claim?: string; verdict?: 'exact_match' | 'near_match' | 'cannot_check' | 'supported' | 'not_found' | 'missing' | 'present'; reason?: string | null; candidate?: MatchCandidate | null; needs_confirmation?: boolean; plan_item_id?: string; category?: string; plan_text?: string; kind?: 'adjust' | 'not_recorded' | 'consistent' | 'weak_match'; suggestion?: string; prediction?: string; log_text?: string | null }
export interface Guidance { id: string; kind: GuidanceKind; version_id: string; plan_id: string | null; state: 'draft' | 'confirmed'; method: string; status: string; input_text: string; items: GuidanceItem[]; confirmed_at: string | null }
export interface GuidanceDecisionIn { id: string; decision: GuidanceDecision | null; text?: string | null }
export type HypothesisStatus = 'pending' | 'supported' | 'refuted' | 'insufficient';
export interface HypothesisRow { plan_item_id: string; item_text: string; paper_value: string | null; page_number: number | null; label: string | null; log_values: { log_id: string; value: string }[] }
export interface Hypothesis { id: string; plan_id: string; text: string; plan_item_ids: string[]; status: HypothesisStatus; status_label: string; status_set_at: string | null; history: { from: string; to: string; at: string; device_id: string }[]; number_check: { state: 'ok' | 'needs_confirmation'; label?: string; missing: string[] }; comparison: { log_ids: string[]; rows: HypothesisRow[]; compared_at: string } | null; created_at: string; updated_at: string }
export function pageLabel(pageIndex: number): string { return `p.${pageIndex + 1}`; }
