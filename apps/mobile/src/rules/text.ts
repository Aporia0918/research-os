// Port of researchos/services/knowledge/text.py normalize()/norm() + find_span (subset).
// NFKC per char, ligatures, dashes/quotes unified, line-break hyphenation joined,
// any whitespace run -> one space, case folded; index map back to original offsets.
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '­': '' };
const DASHES: Record<string, string> = { '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-' };
const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

function charMap(c: string): string {
  if (c in LIGATURES) return LIGATURES[c];
  return (DASHES[c] ?? QUOTES[c] ?? c).normalize('NFKC');
}

export interface Normalized { text: string; index: number[] }

export function normalize(text: string): Normalized {
  const out: string[] = []; const idx: number[] = [];
  let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '-' && i + 1 < n && text[i + 1] === '\n' && out.length && /[a-zA-Z]/.test(out[out.length - 1])) {
      i += 2;
      while (i < n && (text[i] === ' ' || text[i] === '\t')) i += 1;
      continue;
    }
    const raw = charMap(c);
    for (const ch of raw.toLowerCase()) {
      if (/\s/.test(ch)) {
        if (out.length && out[out.length - 1] !== ' ') { out.push(' '); idx.push(i); }
      } else { out.push(ch); idx.push(i); }
    }
    i += 1;
  }
  return { text: out.join(''), index: idx };
}

export function norm(text: string): string { return normalize(text).text.trim(); }

/** ORIGINAL (start,end) offsets of the quote inside the page text, or null. */
export function findSpan(pageText: string, quote: string): [number, number] | null {
  const nq = norm(quote);
  if (!nq) return null;
  const p = normalize(pageText);
  const pos = p.text.indexOf(nq);
  if (pos < 0) return null;
  return [p.index[pos], p.index[pos + nq.length - 1] + 1];
}
