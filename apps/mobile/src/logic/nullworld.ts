// 零世界考试 on the phone: the computer runs the person's own script on its data and on null worlds where the labels
// carry no signal; the phone confirms the columns, approves the run and shows the verdict. Pure helpers, no I/O.
import { tr, trObj } from '../i18n';

export interface Candidate { column: string; score: number; reason: string }
export interface Detected { data: string; rows: number; columns: string[]; groups: Candidate[]; labels: Candidate[]; features: string[] }
export interface Verdict { outcome: 'pass' | 'fail' | 'unsure'; reason: string; chance: number; p: number | null; null_mean: number | null; null_low: number | null }
export interface ExamReport {
  verdict: Verdict; real: number | null; nulls: (number | null)[]; naive: (number | null)[];
  layout: { mode: 'between' | 'within'; groups: number; fixed_groups: number };
  seed: number; data_sha256: string; script_sha256: string; errors: string[];
}
export interface PowerRow { groups: number; effect: number; detected: number; runs: number; rate: number | null; low: number | null; high: number | null }
export interface PowerReport { rows: PowerRow[]; features: string[]; seed: number; errors: string[] }
export interface Task {
  id: string; kind: string; state: string; stage: string | null; progress: Record<string, unknown>;
  payload: Record<string, unknown>; result: ExamReport | PowerReport | null; error_code: string | null;
}
export interface ExamInput { script: string; data: string; group: string; label: string; runs: number; seed: number }

export const EXAM_KIND = 'nullworld.exam';
export const POWER_KIND = 'nullworld.power';
export const RUN_CHOICES = [19, 49, 99] as const;
/** Planted effects in standard deviations, and the share of subjects kept, for the check before the exam. */
export const POWER_EFFECTS = [0.2, 0.5, 0.8] as const;
export const POWER_FRACTIONS = [0.5, 1] as const;
const POWER_RUNS = 20;

export function examPayload(i: ExamInput): Record<string, unknown> {
  return { script: i.script.trim(), data: i.data.trim(), group: i.group, label: i.label, runs: i.runs, seed: i.seed };
}
export function powerPayload(i: ExamInput): Record<string, unknown> {
  return { ...examPayload(i), runs: POWER_RUNS, effects: [...POWER_EFFECTS], fractions: [...POWER_FRACTIONS] };
}
/** How many times the computer will run the script for this task, read from what the server holds. */
export function plannedRuns(t: Task): number {
  const n = (k: string) => (Array.isArray(t.payload[k]) ? (t.payload[k] as unknown[]).length : 0);
  const runs = Number(t.payload.runs) || 0;
  return t.kind === POWER_KIND ? n('fractions') * runs * (n('effects') + 1) : runs + 1;
}

/** A retake is the same exam on fresh null worlds: only the seed changes, so the two reports can be compared. */
export function retake(i: ExamInput): ExamInput { return { ...i, seed: i.seed + 1 }; }

export type Phase = 'approve' | 'running' | 'done' | 'failed' | 'cancelled';
export function phase(t: Task): Phase {
  if (t.state === 'awaiting_approval') return 'approve';
  if (t.state === 'succeeded') return t.result ? 'done' : 'failed';
  if (t.state === 'cancelled') return 'cancelled';
  if (t.state === 'failed' || t.state === 'interrupted' || t.state === 'blocked') return 'failed';
  return 'running';
}
export function runsDone(t: Task): number { const n = t.progress?.runs_done; return typeof n === 'number' ? n : 0; }

const WORDS: Record<string, { title: string; body: string }> = trObj({
  real_beats_null: { title: '通过：真分数明显高于零世界', body: '标签被打乱、但分组结构不变时，分数掉回了机会水平；真数据上的分数比这些零世界都高。' },
  null_above_chance: { title: '没通过：零世界也拿了高分', body: '标签里已经没有任何信号，脚本照样考出高分。高分来自数据结构（比如同一个人的数据同时出现在训练和测试里），不是来自要找的规律。' },
  null_near_threshold: { title: '说不准：零世界分数贴着机会线', body: '零世界的平均分略高于机会水平，可能有轻微泄漏。建议检查划分方式后复考。' },
  real_not_above_null: { title: '说不准：真分数没有明显高于零世界', body: '真数据上的分数落在零世界的范围里，还不能说找到了规律。可以多考几次，或检查特征。' },
  too_few_runs: { title: '说不准：零世界跑得太少', body: '至少要 19 个零世界，结论才站得住。' },
  null_run_failed: { title: '说不准：有零世界没跑完', body: '有零世界运行失败，下面列出了错误。修好脚本后复考。' },
  no_real_score: { title: '说不准：真数据上没拿到分数', body: '脚本在真数据上没有打印分数，或者运行出错。脚本最后要打印一行，例如 accuracy: 0.81。' },
});
export function describeVerdict(v: Verdict): { tone: 'ok' | 'bad' | 'warn'; title: string; body: string } {
  const w = WORDS[v.reason] ?? { title: tr('说不准'), body: v.reason };
  return { tone: v.outcome === 'pass' ? 'ok' : v.outcome === 'fail' ? 'bad' : 'warn', ...w };
}

/** Positions (0-100) on one shared axis for the result strip: every null score, the real score and chance. */
export function strip(r: ExamReport): { nulls: number[]; real: number | null; chance: number; min: number; max: number } {
  const nulls = r.nulls.filter((x): x is number => x !== null);
  const all = [...nulls, r.verdict.chance, ...(r.real === null ? [] : [r.real])];
  const lo = Math.min(...all), hi = Math.max(...all), pad = Math.max((hi - lo) * 0.08, 0.01);
  const min = lo - pad, max = hi + pad, at = (x: number) => ((x - min) / (max - min)) * 100;
  return { nulls: nulls.map(at), real: r.real === null ? null : at(r.real), chance: at(r.verdict.chance), min, max };
}

/** One plain sentence on the planted-world check, read off the full-sample rows: the smallest effect found in at
 * least 80% of worlds, or how often the largest one was found when none reaches that. */
export function describePower(r: PowerReport): { tone: 'ok' | 'warn'; title: string } {
  const most = Math.max(...r.rows.map(x => x.groups));
  const full = r.rows.filter(x => x.groups === most).sort((a, b) => a.effect - b.effect);
  if (!full.length || full.some(x => x.rate === null)) return { tone: 'warn', title: tr('有零世界没跑完，检出率算不出来。') };
  const found = full.find(x => (x.rate ?? 0) >= 0.8);
  if (found) return { tone: 'ok', title: tr('{0} 组数据够用：效应有 {1} 个标准差时，{2} 次里检出 {3} 次。', most, found.effect, found.runs, found.detected) };
  const top = full[full.length - 1];
  return { tone: 'warn', title: tr('数据可能不够：效应有 {0} 个标准差时，{1} 次里只检出 {2} 次。', top.effect, top.runs, top.detected) };
}

export function fmtScore(x: number | null): string { return x === null ? '—' : x.toFixed(3); }
