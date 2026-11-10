import { tr, trObj } from '../i18n';
import type { Hypothesis, HypothesisRow, HypothesisStatus, Plan } from './types';

/** The only four statuses; the user picks one. The app never concludes anything by itself. */
export const STATUSES: HypothesisStatus[] = ['pending', 'supported', 'refuted', 'insufficient'];
export const STATUS_LABEL: Record<HypothesisStatus, string> = trObj({
  pending: '待验证', supported: '支持', refuted: '不支持', insufficient: '证据不足',
});
export const HYPOTHESIS_NOTE = '对照表只并列论文原文数值(带页码)与日志数值,辅助定位原文、由你判断;状态只由你选择。';
export const NOT_RECORDED = '日志未记录';
export const NO_PAPER = '无论文依据';

export function canHypothesize(plan: Plan | null): boolean { return !!plan && plan.state === 'confirmed'; }

export function toggleItem(sel: string[], id: string, max = 20): string[] {
  if (sel.includes(id)) return sel.filter(x => x !== id);
  return sel.length >= max ? sel : [...sel, id];
}

/** One line per comparison row: paper value with page, then log value or a plain label. */
export function rowLine(r: HypothesisRow): string {
  if (r.page_number === null) return `${r.item_text}: ${tr(NO_PAPER)}`;
  const paper = tr('论文 {0} [p.{1}]', r.paper_value ?? tr('(无数值)'), r.page_number);
  const log = r.log_values.length ? r.log_values.map(v => v.value).join(', ') : tr(NOT_RECORDED);
  return tr('{0}: {1} | 日志 {2}', r.item_text, paper, log);
}

/** Demo mode only: the same rule as the local (status chosen by the user, history kept). */
export function setStatusLocal(h: Hypothesis, status: HypothesisStatus, deviceId = 'demo'): Hypothesis {
  if (!STATUSES.includes(status)) throw new Error(tr('状态不合法'));
  const at = new Date().toISOString();
  return { ...h, status, status_label: STATUS_LABEL[status], status_set_at: at,
    history: [...h.history, { from: h.status, to: status, at, device_id: deviceId }] };
}
