// Port of researchos/services/mobile/guidance.py citation_check + _support (three states).
// exact_match = 找到原句 (quote anchored on its page), near_match = 找到相近原文, 需你确认 (candidate only),
// cannot_check = 无法核对 (rules cannot read paraphrases; NOT "no support"). 辅助定位原文、由你判断.
import { ANAPHOR, NEGATION, names, tableLike } from './citationRules';
import { norm, normKeepCase } from './text';
import { missingNumbers } from './numberGate';
import { sentences } from './compare';

export const SUPPORT_MIN = 0.6;
export const NEAR_MIN = 0.4;
export const MAX_CLAIMS = 20;
export const MAX_INPUT = 4000;
export const MAX_PASSAGE = 600;
export const VERDICTS = ['exact_match', 'near_match', 'cannot_check'] as const;
export type Verdict = typeof VERDICTS[number];
export const CANNOT_CHECK = 'rule mode cannot check paraphrases; this does not mean the claim has no support';
export const VERDICT_LABEL: Record<Verdict, string> = {
  exact_match: '找到原句', near_match: '找到相近原文(需你确认)',
  cannot_check: '无法核对(规则模式不支持意译,不等于没有依据)',
};

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'which', 'who', 'whom', 'than', 'then', 'also', 'such', 'into', 'over', 'under', 'between', 'both', 'each', 'other', 'more', 'most', 'less', 'can', 'could', 'may', 'might', 'will', 'would', 'should', 'using', 'used', 'use', 'based', 'paper', 'study', 'work', 'shows', 'show', 'showed', 'shown', 'demonstrate', 'demonstrates', 'demonstrated', 'report', 'reports', 'reported', 'find', 'finds', 'found', 'et', 'al']);
const ABSOLUTE = /\b(?:all|always|never|every|none|best|worst|only|guarantee[sd]?|any|perfect\w*|completely|entirely)\b/gi;
const WORD_RX = /[a-z][a-z0-9-]{2,}/g;

export function content(s: string): Set<string> {
  const words = [...norm(s).toLowerCase().matchAll(WORD_RX)].map(m => m[0]).map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  return new Set(words.filter(w => !STOPWORDS.has(w)));
}
export function claims(text: string): string[] {
  const parts = text.split(/(?<=[.!?;])\s+|(?<=[。!?;])\s*|\n+/).map(p => p.trim()).filter(p => content(p).size >= 2);
  return parts.slice(0, MAX_CLAIMS);
}
export interface PaperSentence { page: number; text: string }
export function paperSentences<S extends { page_index: number; text: string; section_role?: string }>(chunks: S[]): PaperSentence[] {
  const out: PaperSentence[] = [];
  for (const c of chunks) {
    if (c.section_role === 'references') continue;
    for (const s of sentences(c.text)) {
      const one = s.split(/\s+/).join(' ');
      if (one.length >= 25 && one.length <= MAX_PASSAGE && !tableLike(one)) out.push({ page: c.page_index, text: one });
    }
  }
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function support(claim: string, sentence: string): { coverage: number; why: string[] } {
  const cw = content(claim);
  const sw = content(sentence);
  const cov = cw.size ? [...cw].filter(w => sw.has(w)).length / cw.size : 0;
  const why: string[] = [];
  const nums = missingNumbers(claim, sentence);
  if (nums.length) why.push('numbers not in the paper sentence: ' + nums.join(', '));
  const extra = missingNumbers(sentence, claim);
  if (extra.length) why.push('paper sentence has numbers the claim lacks: ' + extra.join(', '));
  const sentLow = normKeepCase(sentence).toLowerCase();
  const unnamed = [...names(claim)].filter(n => !new RegExp('(?<![a-z0-9])' + esc(n) + '(?![a-z0-9])').test(sentLow)).sort();
  if (unnamed.length) {
    const refers = ANAPHOR.test(sentence.trim()) ? ' (the paper sentence starts with a back-reference, so it may be about something else)' : '';
    why.push('paper sentence does not name: ' + unnamed.join(', ') + refers);
  }
  if (NEGATION.test(claim) !== NEGATION.test(sentence)) why.push('negation differs between the claim and the paper sentence');
  const abs = (s: string) => new Set([...s.matchAll(ABSOLUTE)].map(m => m[0].toLowerCase()));
  const sentAbs = abs(sentence);
  const added = [...abs(claim)].filter(w => !sentAbs.has(w)).sort();
  if (added.length) why.push('claim adds: ' + added.join(', '));
  return { coverage: cov, why };
}

export interface CitationItem {
  claim: string; verdict: Verdict; citation: { page_number: number; quote: string } | null;
  candidate: { page_number: number; quote: string; coverage: number } | null;
  needs_confirmation: boolean; reason: string | null;
  decision: 'confirm_match' | 'reject_match' | null;
}
/** pages: full page texts used to anchor a quote; a sentence that cannot be located is never cited. */
export function citationCheck(text: string, sents: PaperSentence[], pages: string[] | null = null, anchor?: (page: number, quote: string) => boolean): CitationItem[] {
  const canAnchor = anchor ?? ((page: number, quote: string) => {
    if (!pages) return true;
    // caller supplies findSpan-based anchoring in tests/UI; default here: literal/normalised containment
    const p = pages[page] ?? '';
    return p.includes(quote) || norm(p).includes(norm(quote));
  });
  return claims(text).map(claim => {
    const ranked = sents.map(s => ({ ...support(claim, s.text), page: s.page, s: s.text }))
      .sort((a, b) => b.coverage - a.coverage);
    const item: CitationItem = { claim, verdict: 'cannot_check', citation: null, candidate: null,
      needs_confirmation: false, reason: CANNOT_CHECK, decision: null };
    if (ranked.length) {
      const best = ranked[0];
      if (best.coverage >= SUPPORT_MIN && !best.why.length && canAnchor(best.page, best.s)) {
        item.verdict = 'exact_match'; item.reason = null;
        item.citation = { page_number: best.page + 1, quote: best.s };
      }
      if (item.verdict !== 'exact_match' && best.coverage >= NEAR_MIN) {
        item.verdict = 'near_match'; item.needs_confirmation = true;
        item.candidate = { page_number: best.page + 1, quote: best.s, coverage: Math.round(best.coverage * 100) / 100 };
        item.reason = best.why.join('; ') || 'similar wording only; please compare with the original text yourself';
      }
    }
    return item;
  });
}
export function openMatches(items: CitationItem[]): CitationItem[] {
  return items.filter(i => i.needs_confirmation && i.decision === null);
}
