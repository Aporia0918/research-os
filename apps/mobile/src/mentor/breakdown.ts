// Turning an advisor's one-line ask into steps a first-year can start on. The model drafts (ai.ts); these offline
// templates stand in when there is no key; selfCheck is the rule gate every draft must pass before the advisor sees it.
import { newId } from '../local/store';
import type { Step } from './types';

type Draft = Pick<Step, 'title' | 'output' | 'minutes'>;
const TEMPLATES: { match: RegExp; steps: Draft[] }[] = [
  { match: /文献|论文|综述|paper/i, steps: [
    { title: '搜出相关论文，只读标题和摘要', output: '5 篇候选论文清单', minutes: 30 },
    { title: '挑 3 篇精读方法部分', output: '每篇 3 句话笔记', minutes: 120 },
    { title: '填一张方法对比表', output: '对比表（方法、数据、结果）', minutes: 60 },
    { title: '写两句结论和一个问题带去组会', output: '两句结论 + 一个问题', minutes: 20 },
  ] },
  { match: /复现|代码|跑通|程序|实现/, steps: [
    { title: '把代码下载下来，读 README', output: '能运行的环境清单', minutes: 30 },
    { title: '配好环境，跑通示例', output: '示例输出截图', minutes: 90 },
    { title: '换成我们的数据跑一遍', output: '结果表', minutes: 120 },
    { title: '记下和论文结果的差别', output: '差别说明', minutes: 30 },
  ] },
  { match: /PPT|汇报|展示|答辩|组会/i, steps: [
    { title: '列出要讲的 3 个要点', output: '要点提纲', minutes: 20 },
    { title: '每个要点配一张图或一张表', output: '图表草稿', minutes: 90 },
    { title: '做成 6 到 8 页幻灯片', output: '幻灯片初稿', minutes: 90 },
    { title: '自己计时讲一遍', output: '修改记录', minutes: 30 },
  ] },
  { match: /实验|测量|数据/, steps: [
    { title: '读实验步骤，列出要准备的器材', output: '器材清单', minutes: 25 },
    { title: '预约或确认实验时间', output: '确定的时间', minutes: 15 },
    { title: '做实验并记录原始数据', output: '原始数据表', minutes: 120 },
    { title: '整理数据并画图', output: '一张结果图', minutes: 60 },
  ] },
];
const GENERIC: Draft[] = [
  { title: '把任务要求抄下来，圈出不懂的词', output: '一段问题清单', minutes: 20 },
  { title: '查资料弄懂不懂的部分', output: '笔记', minutes: 60 },
  { title: '完成主要部分', output: '初稿', minutes: 120 },
  { title: '自己检查一遍再交', output: '修改后的版本', minutes: 30 },
];

export function ruleBreakdown(ask: string): Step[] {
  const t = TEMPLATES.find(x => x.match.test(ask))?.steps ?? GENERIC;
  return t.map(d => ({ ...d, id: newId(), done: false }));
}

export interface CheckResult { ok: boolean; problems: string[] }

/** The rule gate: 3–7 steps, each with an output and a time, the first doable in 30 minutes, the total fitting the free time. */
export function selfCheck(steps: Pick<Step, 'title' | 'output' | 'minutes'>[], freeMinutes?: number): CheckResult {
  const problems: string[] = [];
  if (steps.length < 3 || steps.length > 7) problems.push(`步骤数应在 3 到 7 之间，现在是 ${steps.length}`);
  steps.forEach((s, i) => {
    if (!s.title.trim()) problems.push(`第 ${i + 1} 步没有内容`);
    if (!s.output.trim()) problems.push(`第 ${i + 1} 步没有写交什么`);
    if (!(s.minutes > 0)) problems.push(`第 ${i + 1} 步没有预计时长`);
  });
  if (steps[0] && steps[0].minutes > 30) problems.push('第一步超过 30 分钟，新手不容易开始');
  const total = steps.reduce((a, s) => a + (s.minutes > 0 ? s.minutes : 0), 0);
  if (freeMinutes !== undefined && total > freeMinutes) problems.push(`总共要 ${total} 分钟，截止前只有 ${Math.round(freeMinutes)} 分钟空闲`);
  return { ok: problems.length === 0, problems };
}

/** Reads a model reply that should hold a JSON array of steps; anything malformed gives null. */
export function parseSteps(text: string): Step[] | null {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(raw)) return null;
    const steps = raw.map(r => {
      const o = r as Record<string, unknown>;
      return { id: newId(), title: String(o.title ?? '').trim(), output: String(o.output ?? '').trim(), minutes: Math.round(Number(o.minutes)), done: false };
    });
    return steps.length && steps.every(s => s.title) ? steps : null;
  } catch { return null; }
}

/** A short task title from the ask: the first clause, at most 16 characters. */
export function titleOf(ask: string): string {
  const first = ask.split(/[。！？!?\n，,]/)[0].trim() || ask.trim();
  return first.length > 16 ? `${first.slice(0, 16)}…` : first;
}
