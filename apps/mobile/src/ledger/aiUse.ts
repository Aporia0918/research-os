// AI 使用说明 (plan 1.3, the third report): one page to attach to a thesis, a 大创 report or a course project. It is the
// same ledger as the pre-exam report, laid out in three parts: what the user thought of first (进账), what the AI helped
// with and at which level (借款), and which of those the user later explained without the AI, and on which day (销账).
// It lists only what the user booked; it is not an AIGC detector and does not say no other AI was used.
import { KIND_HELP, statusOf, type Entry, type HelpLevel } from './ledger';

const LEVEL: Record<HelpLevel, string> = { own: '自己想的', hint: '提示', approach: '思路', answer: '完整答案' };
const MAX_Q = 60;

const short = (s: string): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > MAX_Q ? `${t.slice(0, MAX_Q)}…` : t; };
const help = (e: Entry): string => e.kind ? KIND_HELP[e.kind] : LEVEL[e.helpLevel];

/** The day the user explained it without the AI: the citation's original page found, or the last passing try. */
export function settledOn(e: Entry): string | null {
  if (e.kind === 'citation') return e.origin ? (e.tries?.filter(t => t.ok).at(-1)?.on ?? e.createdOn) : null;
  if (statusOf(e.passes, e.attempts, e.weight) !== 'settled') return null;
  return e.tries?.filter(t => t.ok).at(-1)?.on ?? null;
}

export interface AiUse { own: Entry[]; borrowed: Entry[]; settled: { e: Entry; on: string | null }[] }

/** The three parts, oldest first. Dropped entries and 成长空间 stay out. */
export function aiUseOf(es: Entry[], board?: Entry['board']): AiUse {
  const kept = es.filter(e => !e.dropped && e.board !== '生活' && (!board || e.board === board) && e.question.trim())
    .sort((a, b) => (a.createdOn < b.createdOn ? -1 : a.createdOn > b.createdOn ? 1 : 0));
  const borrowed = kept.filter(e => e.helpLevel !== 'own' || e.kind);
  return {
    own: kept.filter(e => e.helpLevel === 'own' || e.ownIdea.trim()),
    borrowed,
    settled: borrowed.map(e => ({ e, on: settledOn(e) })).filter(x => x.on !== null || (x.e.kind === 'citation' && x.e.origin)),
  };
}

/** Plain text, so it pastes into Word or WPS as is. */
export function aiUseText(es: Entry[], today: string, board?: Entry['board']): string {
  const r = aiUseOf(es, board);
  const all = [...r.own, ...r.borrowed];
  const days = all.map(e => e.createdOn).sort();
  const span = days.length ? `${days[0]} 至 ${days.at(-1)}` : '无';
  const ai = (e: Entry) => (e.ai?.trim() ? `，${e.ai.trim()}` : '');
  const lines = [
    `AI 使用说明（思维账本导出，${today}${board ? `，${board}` : ''}）`,
    `记录时间：${span}。自己先想的 ${r.own.length} 处，AI 帮的 ${r.borrowed.length} 处，其中后来不靠 AI 讲清楚的 ${r.settled.length} 处。`,
    '',
    '一、我自己的想法',
    ...(r.own.length ? r.own.map(e => `· ${e.createdOn} ${short(e.question)}${e.ownIdea.trim() ? `：${short(e.ownIdea)}` : ''}`) : ['（无）']),
    '',
    '二、AI 帮的部分（帮助程度）',
    ...(r.borrowed.length ? r.borrowed.map(e => `· ${e.createdOn} ${short(e.question)}（${help(e)}${ai(e)}）`) : ['（无）']),
    '',
    '三、后来不靠 AI 讲清楚的',
    ...(r.settled.length ? r.settled.map(({ e, on }) => e.kind === 'citation' && e.origin
      ? `· ${short(e.question)}：找到原文，《${e.origin.paper}》第 ${e.origin.page} 页`
      : `· ${on} ${short(e.question)}：讲清楚了`) : ['（无）']),
    '',
    '说明：本页由作者在思维账本里自己记下的求助生成，只列出记下的部分；它不是 AIGC 检测结果，也不说明没有其他 AI 使用。',
  ];
  return lines.join('\n') + '\n';
}
