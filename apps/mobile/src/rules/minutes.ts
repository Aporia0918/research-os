// 组会纪要 → 待核对的问题 (板块修改总结: the one part of 会议管理 kept, merged into 科研). Rules only: the sentences of a
// typed or pasted text record that carry a conclusion, a decision or a task become questions the user can choose to book
// as 科研 debts, so what was said at the meeting gets explained, not just written down. Nothing is booked unchosen.

export type MinuteKind = 'claim' | 'decision' | 'todo';
export interface MinuteItem { kind: MinuteKind; quote: string; question: string }

export const MINUTES_MAX = 8;
const DECISION = /决定|定了|定为|确定|采用|改成|改用|换成|统一|不再|放弃|结论是/;
const TODO = /下周|下次|需要|负责|跟进|截止|之前|补充|补做|重跑|复现|验证|确认|检查|整理|准备/;
const CLAIM = /\d|说明|表明|显示|导致|因为|所以|显著|提升|提高|下降|降低|增加|减少|优于|差于|有效|无效|相关/;

function question(kind: MinuteKind, q: string): string {
  if (kind === 'decision') return `组会定了「${q}」：为什么这么定？换别的做法会怎样？`;
  if (kind === 'todo') return `组会布置了「${q}」：具体要做什么，怎样算做完？`;
  return `组会上说「${q}」：依据是什么？你能自己讲清吗？`;
}

/** Up to MINUTES_MAX items, in the order they were said; a sentence counts once, decisions before tasks before claims. */
export function minuteItems(text: string): MinuteItem[] {
  const out: MinuteItem[] = [];
  for (const raw of text.split(/[\n。！？；!?;]+/)) {
    const q = raw.replace(/^\s*(?:[-*•·]|\d+[.、)）])\s*/, '').trim();
    if (q.length < 6 || q.length > 120) continue;
    const kind: MinuteKind | null = DECISION.test(q) ? 'decision' : TODO.test(q) ? 'todo' : CLAIM.test(q) ? 'claim' : null;
    if (kind && !out.some(x => x.quote === q)) out.push({ kind, quote: q, question: question(kind, q) });
    if (out.length === MINUTES_MAX) break;
  }
  return out;
}
