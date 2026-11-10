import { tr, trObj } from '../i18n';
/** Pure helpers for the guidance screen: research counter-questions and writing checks (draft -> confirmed). */
import type { Guidance, GuidanceDecision, GuidanceDecisionIn, GuidanceItem } from './types';

export { LAST_PLAN_KEY } from '../local/research';
export const EXACT_LABEL = '找到原句';
export const NEAR_LABEL = '找到相近原文(需你确认)';
/** Never "没找到依据": rules cannot read a paraphrase, so this is no finding about the claim. */
export const CANNOT_CHECK_LABEL = '无法核对(规则模式不支持意译,不等于没有依据)';
export const MISSING_LABEL = '方法段落里没写到';
export const QUESTION_DECISIONS: GuidanceDecision[] = ['adopt', 'ignore', 'edit'];
export const CHECK_DECISIONS: GuidanceDecision[] = ['handled', 'not_applicable'];
export const PREDICT_DECISIONS: GuidanceDecision[] = ['adopt', 'ignore'];
/** Plain wording: a suggestion is a reference only; the user decides. */
export const PREDICT_NOTE = '预测与调整建议仅为辅助参考,是否调整由你决定。';
export const PREDICT_KIND_LABEL = trObj({ adjust: '建议调整', not_recorded: '记录里没写到', consistent: '与论文一致',
  weak_match: '弱匹配,需确认' } as const);
export const MAX_PREDICT_LOGS = 10;
export const MATCH_DECISIONS: GuidanceDecision[] = ['confirm_match', 'reject_match'];
export const DECISION_LABEL: Record<GuidanceDecision, string> = trObj({
  adopt: '采纳', ignore: '忽略', edit: '改写', handled: '已处理', not_applicable: '不适用',
  confirm_match: '是这句', reject_match: '不是这句',
});

export function canDecide(g: Guidance | null): boolean { return !!g && g.state === 'draft'; }
export function decisionsFor(g: Guidance, i?: GuidanceItem): GuidanceDecision[] {
  if (g.kind === 'questions') return QUESTION_DECISIONS;
  if (g.kind === 'predict') return i?.needs_confirmation ? MATCH_DECISIONS : PREDICT_DECISIONS;
  return i?.needs_confirmation ? MATCH_DECISIONS : CHECK_DECISIONS;
}
/** Near matches the user has not yet confirmed or rejected; the guidance cannot be confirmed while any is open. */
export function openNearMatches(g: Guidance): GuidanceItem[] {
  return g.items.filter(i => i.needs_confirmation && i.decision !== 'confirm_match' && i.decision !== 'reject_match');
}

/** Local change of one item; throws on confirmed guidance so the UI can never change it. */
export function setDecision(g: Guidance, id: string, decision: GuidanceDecision | null, text?: string): Guidance {
  if (!canDecide(g)) throw new Error(tr('这份指导已确认,不能再改'));
  return { ...g, items: g.items.map(i => i.id === id
    ? { ...i, decision, user_text: decision === 'edit' ? (text ?? i.user_text ?? i.question ?? '') : null } : i) };
}
/** Body for PUT /guidance/{id}/decisions. An edit with empty text is not sendable (the local would answer 422). */
export function toDecisions(g: Guidance): GuidanceDecisionIn[] {
  return g.items.map(i => i.decision === 'edit' ? { id: i.id, decision: 'edit', text: i.user_text ?? '' }
    : { id: i.id, decision: i.decision });
}
export function invalidEdits(g: Guidance): GuidanceItem[] {
  return g.items.filter(i => i.decision === 'edit' && !(i.user_text ?? '').trim());
}
export function verdictLabel(i: GuidanceItem): string {
  if (i.verdict === 'exact_match' || i.verdict === 'supported') return `${tr(EXACT_LABEL)} p.${i.citation?.page_number ?? '?'}`;
  if (i.verdict === 'near_match') return `${tr(NEAR_LABEL)} p.${i.candidate?.page_number ?? '?'}`;
  if (i.verdict === 'cannot_check' || i.verdict === 'not_found') return tr(CANNOT_CHECK_LABEL);
  if (i.verdict === 'missing') return tr(MISSING_LABEL);
  if (i.verdict === 'present') return tr('已写到');
  return '';
}
/** Chinese names for the tally keys shown next to 方式. */
export const TALLY_LABEL: Record<string, string> = trObj({
  exact_match: '找到原句', supported: '找到原句', near_match: '相近原文', cannot_check: '无法核对', not_found: '无法核对',
  missing: '没写到', present: '已写到', question: '反问', item: '条目', adjust: '建议调整', not_recorded: '记录里没写到',
  consistent: '与论文一致', weak_match: '弱匹配',
});
export function tally(g: Guidance): Record<string, number> {
  const t: Record<string, number> = {};
  for (const i of g.items) { const k = i.verdict ?? (g.kind === 'predict' ? i.kind ?? 'item' : 'question'); t[k] = (t[k] ?? 0) + 1; }
  return t;
}
/** Toggle one log id in the selection, at most MAX_PREDICT_LOGS (the local limit). */
export function toggleLog(sel: string[], id: string): string[] {
  if (sel.includes(id)) return sel.filter(x => x !== id);
  return sel.length >= MAX_PREDICT_LOGS ? sel : [...sel, id];
}

/** W6: the local asks only about topics the idea itself mentions; nothing matched -> no questions, never a template. */
export const NO_IDEA_TOPIC = '你的想法里没有提到论文方法部分能对上的内容(采样、滤波、数据划分、对照、设备、样本量、训练),所以没有生成反问。写得更具体一些再试。';
export function noIdeaQuestions(g: { kind: string; status: string; items: unknown[] }): boolean {
  return g.kind === 'questions' && g.status === 'ok' && g.items.length === 0;
}
