// 组会预演: what this advisor is likely to ask about a piece of work, from what they asked and required before.
import { overlap, splitLines } from './meeting';
import { relevant, type Standing } from './memory';
import type { Meeting } from './types';

export interface Probe { question: string; why: string; keys: string[] }

/** Kinds of question advisors ask in group meetings, with the words that mark them. */
export const KINDS: { kind: string; mark: RegExp; ask: string }[] = [
  { kind: '为什么', mark: /为什么|为啥|怎么想到|理由/, ask: '你为什么选这个方法（或这几篇）？' },
  { kind: '和别人比', mark: /对比|比.+好|基线|baseline|别人|之前的/i, ask: '和别的方法比，好在哪里、差在哪里？' },
  { kind: '数据', mark: /数据|样本|多少个|数据集/, ask: '用的什么数据、有多少？' },
  { kind: '可靠吗', mark: /靠谱|可信|误差|显著|重复|几次/, ask: '这个结果跑了几次，稳定吗？' },
  { kind: '下一步', mark: /下一步|接下来|然后呢|打算/, ask: '下一步打算做什么？' },
];

/** The advisor's own questions in past meetings, counted by kind. */
export function habits(meetings: Meeting[]): { kind: string; count: number; example: string }[] {
  const counts = new Map<string, { count: number; example: string }>();
  for (const m of meetings) for (const l of splitLines(m.text)) {
    if (l.speaker !== '导师' || !/[？?吗呢]$/.test(l.text)) continue;
    const k = KINDS.find(x => x.mark.test(l.text));
    if (!k) continue;
    const c = counts.get(k.kind) ?? { count: 0, example: l.text };
    counts.set(k.kind, { count: c.count + 1, example: c.example });
  }
  return [...counts].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.count - a.count);
}

const keysOf = (s: string) => (s.match(/[㐀-鿿A-Za-z0-9]{2,}/g) ?? []).flatMap(w => w.length > 4 ? [w.slice(0, 2), w.slice(-2)] : [w]).slice(0, 4);

/** Offline probes: standing requirements on this work first, then the advisor's habitual questions, then common ones. */
export function ruleProbes(work: string, memory: Standing[], meetings: Meeting[], n = 4): Probe[] {
  const out: Probe[] = relevant(memory, work).slice(0, 2).map(s => ({
    question: `我之前说过「${s.now.text}」，这次做到了吗？`, why: '导师以前组会上的要求', keys: keysOf(s.now.text.replace(/^.*?(要|只看|不要|别)/, '')) }));
  for (const h of habits(meetings)) {
    if (out.length >= n) break;
    out.push({ question: h.example, why: `导师以前问过 ${h.count} 次这类问题`, keys: [] });
  }
  for (const k of KINDS) {
    if (out.length >= n) break;
    if (!out.some(p => overlap(p.question, k.ask) > 0.5)) out.push({ question: k.ask, why: '组会上常被问到', keys: [] });
  }
  return out.slice(0, n);
}

/** Rule feedback on a rehearsal answer: which of the requirement's key words it never mentions. */
export function ruleFeedback(p: Probe, answer: string): string {
  if (answer.trim().length < 8) return '答得太短了，组会上至少说清做了什么、结果怎样。';
  const miss = p.keys.filter(k => !answer.includes(k));
  return miss.length ? `没提到：${miss.join('、')}。导师之前专门要求过，最好正面说一句。` : '覆盖到了导师之前的要求。';
}
