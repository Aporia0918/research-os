// 查重提醒 and 综述矛盾点 (plan 2.4), on the phone with no model. Both only point at sentences found on a page; the user
// decides what to do with them.
//   查重提醒   a sentence of the user's own draft that shares at least SAME_MIN of its topic grams with one sentence of an
//              imported paper, and is not inside quotation marks: rewrite it in your own words, or cite it.
//   综述矛盾点 two imported papers state the same thing in opposite ways (the recall rules: same topic, stated, one flip).
import { coverage, grams, hedged, split, stance, type Source } from './recall';
import { findSpan } from './text';

export const SAME_MIN = 0.7;
const MIN_GRAMS = 6; // shorter sentences ("结果如表 1 所示") match everywhere and say nothing
const MAX_SENTENCE = 400;
/** Text inside quotation marks is already cited, so it is taken out before the check. */
const QUOTED = /[「“"『][^」”"』]*[」”"』]/g;

interface Indexed { text: string; g: Set<string>; page: number; paper: string; pageText: string }
function index(s: Source): Indexed[] {
  return s.pages.flatMap((pageText, i) => split(pageText).filter(t => t.length <= MAX_SENTENCE)
    .map(text => ({ text, g: grams(text), page: i + 1, paper: s.name, pageText })).filter(x => x.g.size >= MIN_GRAMS));
}

export interface Same { mine: string; quote: string; paper: string; page: number; same: number }
/** Each sentence of `draft` that is nearly a sentence of an imported paper, with that sentence and its page. */
export function sameAs(draft: string, papers: Source[]): Same[] {
  const pool = papers.flatMap(index);
  const out: Same[] = [];
  for (const mine of split(draft.replace(QUOTED, '\n\n'))) {
    const g = grams(mine);
    if (g.size < MIN_GRAMS) continue;
    let best: Same | null = null;
    for (const s of pool) {
      const c = coverage(g, s.g);
      if (c >= SAME_MIN && (!best || c > best.same) && findSpan(s.pageText, s.text)) best = { mine, quote: s.text, paper: s.paper, page: s.page, same: Math.round(c * 100) };
    }
    if (best) out.push(best);
  }
  return out;
}

export interface Conflict { a: { paper: string; page: number; quote: string }; b: { paper: string; page: number; quote: string } }
/** Sentences of two imported papers that say opposite things about the same topic, strongest first, at most `max`. */
export function conflicts(papers: Source[], max = 5): Conflict[] {
  const idx = papers.map(index);
  const found: (Conflict & { c: number })[] = [];
  for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
    for (const a of idx[i]) {
      if (hedged(a.text)) continue;
      for (const b of idx[j]) {
        const c = coverage(a.g, b.g);
        if (c < 0.75 || stance(a.text, b.text) !== 'opposes') continue;
        found.push({ a: { paper: a.paper, page: a.page, quote: a.text }, b: { paper: b.paper, page: b.page, quote: b.text }, c });
      }
    }
  }
  return found.sort((x, y) => y.c - x.c).slice(0, max).map(({ a, b }) => ({ a, b }));
}
