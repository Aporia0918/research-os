// Port of researchos/services/mobile/citation_rules.py: names, negation, anaphora, table dumps.
import { normKeepCase } from './text';

export const TOKEN = /(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g;
export const NEGATION = /\b(?:not|no|never|without|cannot|neither|nor)\b|n't\b/i;
export const ANAPHOR = /^(?:it|its|this|these|they|their|that|those|here|there)\b/i;

export function names(text: string): Set<string> {
  const out = new Set<string>();
  const toks = [...normKeepCase(text).matchAll(TOKEN)].map(m => m[0]);
  toks.forEach((w, k) => {
    const innerCap = [...w.slice(1)].some(c => /[A-Z]/.test(c));
    const mixed = /\d/.test(w) && /[A-Za-z]/.test(w);
    if (innerCap || mixed || (k > 0 && /[A-Z]/.test(w[0]) && w.length > 1)) out.add(w.toLowerCase());
  });
  return out;
}

export function tableLike(s: string): boolean {
  const toks = s.split(/\s+/).filter(Boolean);
  const prose = toks.filter(t => {
    const w = t.replace(/[()[\],.;:]/g, '');
    return w.length > 2 && /^[A-Za-z]+$/.test(w);
  }).length;
  return toks.length >= 8 && prose / toks.length < 0.5;
}
