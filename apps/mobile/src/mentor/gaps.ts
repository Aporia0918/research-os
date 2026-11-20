// 没说清的地方: what an advisor's one-line ask leaves out, and the one or two questions worth asking on the spot.
// A gap the advisor already settled in an earlier meeting is filled from the requirement memory, not asked again.
import { parseDue } from './meeting';
import { relevant, type Standing } from './memory';

export type Slot = '交什么' | '做多少' | '按什么标准' | '什么时候要' | '材料在哪';
export interface SlotDef {
  slot: Slot;
  /** How much a wrong guess costs the student (rework), 0–1. */
  weight: number;
  /** Words that show the ask already says it. */
  present: RegExp;
  /** Only asked when the work needs it. */
  needs?: RegExp;
  question: string;
  /** Words that let an earlier requirement answer it. */
  memory: RegExp;
}

export const SLOTS: SlotDef[] = [
  { slot: '按什么标准', weight: 1, present: /准确率|速度|指标|标准|维度|角度|按.+比|从.+比|要求|对比.+(和|与)|几个方面/, needs: /对比|比较|评估|分析|改进|优化|复现|实验|结果/,
    question: '这个对比/结果主要看哪几项指标？', memory: /准确率|速度|指标|看|标准|维度|误差|显著/ },
  { slot: '交什么', weight: 0.8, present: /表|PPT|幻灯|文档|报告|代码|图|笔记|提纲|清单|截图|一页|word/i,
    question: '最后交什么形式：一张表、几页 PPT，还是一份文档？', memory: /表|PPT|幻灯|页|文档|报告|格式/i },
  { slot: '做多少', weight: 0.7, present: /[一二两三四五六七八九十\d]+\s*(篇|个|种|页|组|次|张|份)|这几|那几|全部|所有|这篇|那篇/, needs: /论文|文献|方法|实验|数据|模型|代码|调研/,
    question: '大概做到多大范围：几篇、几个方法或哪些数据？', memory: /篇|个|种|范围|只看|至少|不超过/ },
  { slot: '材料在哪', weight: 0.6, present: /链接|网盘|群里|我发你|发给你|仓库|github|地址|在.+里/i, needs: /复现|代码|数据|跑|训练|实验/,
    question: '代码或数据从哪里拿？有没有现成的链接？', memory: /链接|数据集|代码|仓库|网盘/ },
  { slot: '什么时候要', weight: 0.5, present: /今天|明天|后天|周[一二三四五六日天]|星期|月.+日|号|组会前|之前|以前|前把|截止|月底|下次/,
    question: '这个什么时候要？下次组会前就要吗？', memory: /(?!)/ },
];

export interface Gap { slot: Slot; missing: number; filledBy?: Standing; score: number; question: string }

/** Probability-like "this slot is missing", from the rules; the trained gap model replaces this, same shape. */
export function ruleMissing(ask: string): Record<Slot, number> {
  const out = {} as Record<Slot, number>;
  for (const d of SLOTS) {
    const needed = !d.needs || d.needs.test(ask);
    out[d.slot] = !needed ? 0 : d.present.test(ask) ? 0.1 : 0.9;
  }
  if (out['什么时候要'] > 0.5 && parseDue(ask, Date.now()) !== undefined) out['什么时候要'] = 0.1;
  return out;
}

/**
 * 选问: score = P(missing) × cost of guessing wrong × (1 − already answered by memory). Asks at most `max`
 * questions, each scoring at least `min`; gaps the memory fills are returned separately, with the advisor's words.
 */
export function chooseQuestions(ask: string, memory: Standing[], missing = ruleMissing(ask), max = 2, min = 0.3): { ask: Gap[]; filled: Gap[] } {
  const related = relevant(memory, ask, 0.15);
  const gaps: Gap[] = SLOTS.map(d => {
    const filledBy = missing[d.slot] > 0.5 ? related.find(s => s.state === '有效' && d.memory.test(s.now.text)) : undefined;
    const score = missing[d.slot] * d.weight * (filledBy ? 0 : 1);
    return { slot: d.slot, missing: missing[d.slot], filledBy, score, question: d.question };
  });
  return {
    ask: gaps.filter(g => g.score >= min).sort((a, b) => b.score - a.score).slice(0, max),
    filled: gaps.filter(g => g.filledBy),
  };
}

/** The questions as one message the student can say or send right away. */
export function askLine(gaps: Gap[]): string {
  if (!gaps.length) return '';
  const items = gaps.map((g, i) => (gaps.length > 1 ? `${i + 1}. ` : '') + g.question);
  return `老师，我想确认一下：${items.join(' ')}`;
}
