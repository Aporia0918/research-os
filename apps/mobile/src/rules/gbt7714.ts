// 参考文献导出 (板块修改总结: from 文献管理, merged into 科研): one reference in GB/T 7714-2015 form, from what the user
// confirms. The rules only guess the DOI and the year from the paper's pages; everything else the user types or checks.

export type RefType = 'J' | 'C';
export interface Ref { type: RefType; authors: string[]; title: string; source: string; year: string; volume?: string; issue?: string; pages?: string; doi?: string }

const CJK = /[㐀-鿿]/;
const MAX_AUTHORS = 3;

/** A Latin name as SURNAME and initials ("John A. Smith" → "SMITH J A", "Smith, John" → "SMITH J"); Chinese names as written. */
export function author(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n || CJK.test(n)) return n;
  const [last, given] = n.includes(',') ? [n.split(',')[0], n.split(',').slice(1).join(' ')] : [n.split(' ').pop()!, n.split(' ').slice(0, -1).join(' ')];
  const initials = given.split(/[\s.-]+/).filter(Boolean).map(g => g[0].toUpperCase()).join(' ');
  return [last.trim().toUpperCase(), initials].filter(Boolean).join(' ');
}

/** Authors as the standard lists them: the first three, then 等 (Chinese) or et al. */
export function authorList(names: string[], title: string): string {
  const ns = names.map(author).filter(Boolean);
  const head = ns.slice(0, MAX_AUTHORS).join(', ');
  return ns.length > MAX_AUTHORS ? `${head}, ${CJK.test(title) ? '等' : 'et al'}` : head;
}

/** The reference line. Missing optional parts are left out, never filled in. */
export function gbt7714(r: Ref): string {
  const who = authorList(r.authors, r.title);
  const pages = r.pages?.trim().replace(/\s*[–—~～]\s*/g, '-');
  const where = r.type === 'C' ? `[C]//${r.source.trim()}` : `[J]. ${r.source.trim()}`;
  const vol = r.volume?.trim() ? `, ${r.volume.trim()}` : '';
  const iss = r.issue?.trim() ? `(${r.issue.trim()})` : '';
  const pp = pages ? `: ${pages}` : '';
  const doi = r.doi?.trim() ? ` DOI: ${r.doi.trim()}.` : '';
  return `${who ? `${who}. ` : ''}${r.title.trim()}${where}, ${r.year.trim()}${vol}${iss}${pp}.${doi}`;
}

/** Enough to export: a title, where it appeared, and a year. */
export const complete = (r: Ref): boolean => Boolean(r.title.trim() && r.source.trim() && /^\d{4}$/.test(r.year.trim()));

/** A first guess from the paper itself: the file name as title, the first DOI on its pages, a year from page one. */
export function guessRef(name: string, pages: string[]): Ref {
  const doi = pages.join(' ').match(/\b10\.\d{4,9}\/[^\s"<>）)\]，。；]+/)?.[0].replace(/[.,;]+$/, '');
  const year = (pages[0] ?? '').match(/\b(19[5-9]\d|20[0-4]\d)\b/)?.[1] ?? '';
  return { type: 'J', authors: [], title: name.replace(/\.pdf$/i, ''), source: '', year, doi };
}
