// 知识召回 (plan 2.4 ⑫), deterministic and with no model. A sentence an AI gave you is recalled only when an imported
// text holds a sentence, found word for word on its page, that says the opposite of it:
//   same topic   at least RECALL_MIN of the claim's grams are in the sentence, once polarity, direction and hedge
//                words are taken out (English content-word stems and their pairs, Chinese character pairs);
//   stated       the sentence is not hedged (may, 可能, 提示 ...): a weaker statement is never a recall;
//   opposite     exactly one flip: one side negated (不, 未, not ...), or a direction turned round (增加/降低,
//                之前/之后, increase/decrease ...). Two flips cancel ("不会增加" against "降低" agree);
//   one clause   with but / 但 / 然而 in the sentence, each clause is judged alone, and any clause that agrees wins.
// A different wording, or a different model's answer, is never a recall.
import { findSpan } from './text';

export const RECALL_MIN = 0.75;
const MIN_GRAMS = 3;
const MAX_SENTENCE = 600;

// Words that start with 不/非/无 but say nothing negative; taken out before the negation test.
const NOT_NEGATION = /不同|不仅|不断|不久|不少|不过|不管|不论|不但|不如|不错|非常|无论|未来/g;
const NEGATION = /[不没未]|并非|无法|无需|无须|无关|\b(?:not|no|never|without|cannot|neither|nor|unrelated)\b|n't\b|\bfail(?:s|ed)? to\b/gi;
const HEDGE = /\b(?:may|might|could|suggests?|suggested|possibl[ey]|potentially|likely|appears? to)\b|提示|可能|或许|也许|似乎/gi;
const STATED = /\b(?:shows?|showed|shown|found|finds|reveal\w*|indicat\w*|demonstrat\w*|prov(?:e|es|ed|en)|confirm\w*|establish\w*)\b|表明|显示|发现|证明|证实|确认/gi;
/** Each pair: words that point one way, words that point the other. */
const DIRECTIONS: [RegExp, RegExp][] = [
  [/增加|提高|升高|上升|增强|增大|改善|加快|促进|\b(?:increas\w*|rais\w*|improv\w*|higher|enhanc\w*|boost\w*)\b/gi,
    /降低|减少|下降|减弱|减小|恶化|减慢|抑制|\b(?:decreas\w*|reduc\w*|lower\w*|declin\w*|impair\w*|worsen\w*)\b/gi],
  [/之前|以前|\b(?:before|prior to|preced\w*)\b/gi, /之后|以后|\b(?:after|follow(?:s|ed|ing)?)\b/gi],
  [/正相关|\bpositively\b/gi, /负相关|\bnegatively\b/gi],
];
/** A contrast splits a sentence into clauses that are judged one by one ("X helps on A, but not on B"). */
const CONTRAST = /但是|但|然而|\b(?:but|whereas|however)\b/i;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'than', 'then', 'also', 'should', 'would', 'will',
  'can', 'which', 'we', 'our', 'they', 'their']);
const TOKEN = /[a-z0-9][a-z0-9-]*|[㐀-鿿]+/g;
const HAN = /^[㐀-鿿]+$/;

const hit = (rx: RegExp, s: string): boolean => { rx.lastIndex = 0; return rx.test(s); };
const negated = (s: string): boolean => hit(NEGATION, s.replace(NOT_NEGATION, ' '));
export const hedged = (s: string): boolean => hit(HEDGE, s);
/** +1 / -1 / 0 for each direction pair (0: neither side, or both). */
const directions = (s: string): number[] => DIRECTIONS.map(([up, down]) => Number(hit(up, s)) - Number(hit(down, s)));

/** Topic grams with every polarity, direction, hedge and reporting word taken out (each replaced by a break). */
export function grams(s: string): Set<string> {
  let t = s.toLowerCase().replace(NOT_NEGATION, ' ');
  for (const rx of [NEGATION, HEDGE, STATED, ...DIRECTIONS.flat()]) t = t.replace(rx, ' ');
  const out = new Set<string>();
  const words: string[] = [];
  for (const w of t.match(TOKEN) ?? []) {
    if (HAN.test(w)) { if (w.length === 1) out.add(w); for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); }
    else if (!STOP.has(w) && w.length > 1) words.push(w.slice(0, 5));
  }
  words.forEach((w, i) => { out.add(w); if (i) out.add(`${words[i - 1]} ${w}`); });
  return out;
}

export const coverage = (claim: Set<string>, sentence: Set<string>): number =>
  claim.size ? [...claim].filter((g) => sentence.has(g)).length / claim.size : 0;

/** How many ways the sentence turns the claim round: negation, then each direction pair. */
export function flips(claim: string, sentence: string): number {
  const a = directions(claim), b = directions(sentence);
  return Number(negated(claim) !== negated(sentence)) + a.filter((d, i) => d !== 0 && b[i] === -d).length;
}

function clauseStance(claim: string, c: Set<string>, clause: string): 'opposes' | 'agrees' | null {
  if (coverage(c, grams(clause)) < RECALL_MIN || hedged(clause)) return null;
  const f = flips(claim, clause);
  return f === 1 ? 'opposes' : f === 0 ? 'agrees' : null;
}

/**
 * Same topic and stated: the sentence says the opposite of the claim, agrees with it, or neither (null). With a contrast
 * in the sentence, it opposes only when one clause opposes and none agrees.
 */
export function stance(claim: string, sentence: string): 'opposes' | 'agrees' | null {
  const c = grams(claim);
  if (c.size < MIN_GRAMS || hedged(sentence)) return null;
  const s = sentence.split(CONTRAST).map((x) => clauseStance(claim, c, x));
  return s.includes('agrees') ? 'agrees' : s.includes('opposes') ? 'opposes' : null;
}

/** Sentences in Chinese or English; a page break always ends one. */
export function split(text: string): string[] {
  return text.split(/(?<=[。！？；!?;])|(?<=\.)\s+|\n{2,}/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export interface Source { name: string; pages: string[] }
export interface Opposing { claim: string; quote: string; page: number; coverage: number }

/** The strongest opposing sentence across the claims of one AI answer, anchored on its page; null when there is none. */
export function opposing(answer: string, source: Source): Opposing | null {
  const claims = split(answer).map((c) => ({ c, g: grams(c) })).filter((x) => x.g.size >= MIN_GRAMS);
  let best: Opposing | null = null;
  for (const [i, page] of source.pages.entries()) {
    for (const quote of split(page)) {
      if (quote.length > MAX_SENTENCE) continue;
      const q = grams(quote);
      for (const { c, g } of claims) {
        const cov = coverage(g, q);
        if ((!best || cov > best.coverage) && stance(c, quote) === 'opposes' && findSpan(page, quote))
          best = { claim: c, quote, page: i + 1, coverage: Math.round(cov * 100) / 100 };
      }
    }
  }
  return best;
}

/** A user's counter-evidence to a recall: it must be on a page of an imported text, word for word, and agree with the claim. */
export function backs(claim: string, quote: string, sources: Source[]): boolean {
  return Boolean(quote.trim()) && stance(claim, quote) === 'agrees' && sources.some((s) => s.pages.some((p) => findSpan(p, quote)));
}
