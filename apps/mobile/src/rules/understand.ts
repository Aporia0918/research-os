// 拍一页问一句 → 理解债 (plan 2.4, 3.2 第二阶段; demo first stop): when the model answers a question about the paper on
// this phone, what it explained is booked at once as 1 to 3 理解债, one per page the answer cites, so each debt carries
// its page. No extra tap: the user only asked. Nothing is booked when the answer is the user's own reading (rule mode,
// the original passages only), when the model found nothing, or when no sentence cites a page that was sent.
// A "knowledge point" here is the set of sentences that rest on one page: a proxy, not an understanding of the topic.
import type { NewEntry } from '../ledger/ledger';
import { split } from './recall';

export const MAX_DEBTS = 3;
const MARK = /\[\s*p\.?\s*(\d+)\s*\]/gi;
const TRAILING = /([。！？.!?])\s*((?:\[\s*p\.?\s*\d+\s*\]\s*)+)/gi; // 「…之前。[p.2]」 → 「…之前[p.2]。」
const NOT_FOUND = /没找到|没有找到|未找到|没有提到|没提到|未提及|\bnot found\b|\bdoes not (?:say|mention)\b/i;

export interface Point { pages: number[]; text: string }

/** Sentences grouped by the first page they cite, in order of first appearance; groups past MAX_DEBTS fold into the last. */
export function points(answer: string, allowed: number[]): Point[] {
  const ok = new Set(allowed);
  const groups: Point[] = [];
  let lead = ''; // uncited sentences before the first cited one go with the first point
  let current: Point | null = null;
  for (const s of split(answer.replace(TRAILING, '$2$1'))) {
    const page = [...s.matchAll(MARK)].map((m) => Number(m[1])).find((n) => ok.has(n));
    const text = s.replace(MARK, '').replace(/\s+([。，；！？.,;!?])/g, '$1').trim();
    if (!text) continue;
    if (page === undefined) {
      if (NOT_FOUND.test(text)) continue;
      if (current) current.text += text; else lead += text;
      continue;
    }
    current = groups.find((g) => g.pages[0] === page) ?? null;
    if (current) current.text += text;
    else { current = { pages: [page], text: lead + text }; lead = ''; groups.push(current); }
  }
  if (groups.length <= MAX_DEBTS) return groups;
  const [a, b, ...rest] = groups;
  return [a, b, { pages: rest.flatMap((g) => g.pages), text: rest.map((g) => g.text).join('') }];
}

/** Same inputs → same clientId, so asking twice never books twice. */
export function stableId(prefix: string, ...parts: string[]): string {
  let h = 5381;
  for (const c of parts.join('|')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `${prefix}-${h.toString(36)}`;
}

export interface Asked { question: string; answer: string; pages: number[]; paper: { name: string; versionId: string }; ai?: string }

/** The 理解债 one model answer about a paper books: 科研, the AI gave the answer, the page in the question. */
export function askDebts(a: Asked): NewEntry[] {
  const q = a.question.trim();
  if (!q) return [];
  return points(a.answer, a.pages).map((p) => ({
    clientId: stableId('ask', a.paper.versionId, q, p.pages.join(',')),
    board: '科研',
    topic: a.paper.name,
    question: `${q}（第 ${p.pages.join('、')} 页）`,
    answer: p.text,
    helpLevel: 'answer',
    ...(a.ai?.trim() ? { ai: a.ai.trim() } : {}),
  }));
}
