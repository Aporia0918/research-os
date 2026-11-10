// Port of researchos/services/mobile/compare.py: numeric parameters with units, closest same-shape
// candidate, body sentence before table row, citation only when the quote is on that page.
import { findSpan } from './text';

export const MAX_PASSAGE = 600;
export const UNITS: Record<string, string> = {
  khz: 'kHz', hz: 'Hz', ms: 'ms', s: 's', sec: 's', seconds: 's', min: 'min', minutes: 'min',
  h: 'h', hours: 'h', '°c': '°C', '℃': '°C', degc: '°C', '%': '%', rpm: 'rpm', mg: 'mg', 'µg': 'µg',
  ug: 'µg', g: 'g', ml: 'mL', 'µl': 'µL', ul: 'µL', l: 'L', mm: 'mm', cm: 'cm', nm: 'nm',
  'µm': 'µm', um: 'µm', 'µv': 'µV', uv: 'µV', mv: 'mV', v: 'V', 'mm/s': 'mm/s', db: 'dB', mmol: 'mmol',
  'mm hg': 'mmHg', mmhg: 'mmHg', bpm: 'bpm', samples: 'samples', channels: 'channels', epochs: 'epochs',
  subjects: 'subjects', participants: 'participants', trials: 'trials',
};
const NUM = String.raw`\d+(?:\.\d+)?`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNIT_ALT = Object.keys(UNITS).sort((a, b) => b.length - a.length).map(esc).join('|');
const PARAM = new RegExp(String.raw`(?<![\w.])(${NUM})(?:\s*(?:-|–|—|~|to)\s*(${NUM}))?\s*(${UNIT_ALT})(?![A-Za-z])`, 'gi');
export const WORD = /[a-z]{4,}/g;

export interface Param { low: number; high: number; unit: string; raw: string }
export interface Chunk { page_index: number; seq?: number; text: string; section_role?: string }
export interface Citation { page_index: number; page_number: number; quote: string; [key: string]: unknown }
export interface Finding {
  parameter: string; unit: string; log_value: [number, number];
  status: 'match' | 'mismatch' | 'not_found'; paper_value: [number, number] | null;
  paper_text?: string; citation: Citation | null; section_role?: string | null;
}

export function sameValue(a: Param, b: Param): boolean {
  return Math.abs(a.low - b.low) < 1e-9 && Math.abs(a.high - b.high) < 1e-9;
}
export function extractParams(text: string): Param[] {
  PARAM.lastIndex = 0;
  return [...text.matchAll(PARAM)].map(m => {
    const low = Number(m[1]); const high = m[2] ? Number(m[2]) : low;
    return { low, high, unit: UNITS[m[3].toLowerCase()], raw: m[0].trim() };
  });
}
export function sentences(text: string): string[] {
  return text.split(/(?<=[.;!?])\s+/).map(s => s.trim()).filter(Boolean);
}
export function distance(a: Param, b: Param): [number, number] {
  const shape = (a.low === a.high) === (b.low === b.high) ? 0 : 1;
  return [shape, Math.abs(a.low - b.low) + Math.abs(a.high - b.high)];
}
export function isTableRow(s: string): boolean { return extractParams(s).length >= 3; }
export function clauseWords(logText: string, raw: string): Set<string> {
  for (const clause of logText.split(/[,;.\n]\s+|[,;\n]/)) {
    if (clause.includes(raw)) return new Set([...clause.toLowerCase().matchAll(WORD)].map(m => m[0]));
  }
  return new Set();
}
export function rank(lp: Param, logWords: Set<string>, cand: [Param, Chunk, string]): [number, number, number, number] {
  const [p, , s] = cand;
  const [shape, dist] = distance(lp, p);
  const words = new Set([...s.toLowerCase().matchAll(WORD)].map(m => m[0]));
  const overlap = [...logWords].filter(w => words.has(w)).length;
  return [shape, isTableRow(s) ? 1 : 0, -overlap, dist];
}
/** methods first, then everything that is not references (same as _method_passages). */
export function methodPassages(chunks: Chunk[]): Chunk[] {
  return [...chunks.filter(c => c.section_role === 'methods'),
    ...chunks.filter(c => c.section_role !== 'methods' && c.section_role !== 'references')];
}
export function cite(pages: string[], c: Chunk, sentence: string): Citation | null {
  const span = findSpan(pages[c.page_index] ?? '', sentence.slice(0, MAX_PASSAGE));
  if (!span) return null; // never show an uncited claim about the paper
  return { page_index: c.page_index, page_number: c.page_index + 1, quote: sentence.slice(0, MAX_PASSAGE) };
}
function cmpTuple(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d;
  }
  return 0;
}
export { cmpTuple };

export function compareLog(logText: string, chunks: Chunk[], pages: string[]): Finding[] {
  const params = extractParams(logText);
  if (!params.length) return [];
  const candidates: [Param, Chunk, string][] = [];
  for (const c of methodPassages(chunks)) {
    for (const s of sentences(c.text)) for (const p of extractParams(s)) candidates.push([p, c, s]);
  }
  return params.map(lp => {
    const sameUnit = candidates.filter(x => x[0].unit === lp.unit);
    const hits = sameUnit.filter(x => sameValue(x[0], lp));
    const pool = hits.length ? hits : sameUnit;
    const item: Finding = { parameter: lp.raw, unit: lp.unit, log_value: [lp.low, lp.high],
      status: hits.length ? 'match' : sameUnit.length ? 'mismatch' : 'not_found',
      paper_value: null, citation: null, section_role: null };
    if (pool.length) {
      const logWords = clauseWords(logText, lp.raw);
      const choice = pool.reduce((best, x) => cmpTuple(rank(lp, logWords, x), rank(lp, logWords, best)) < 0 ? x : best);
      const [pp, chunk, sentence] = choice;
      const citation = cite(pages, chunk, sentence);
      if (!citation) item.status = 'not_found';
      else {
        item.paper_value = [pp.low, pp.high]; item.paper_text = pp.raw;
        item.citation = citation; item.section_role = chunk.section_role ?? null;
      }
    }
    return item;
  });
}
export function mismatchCount(items: Finding[]): number { return items.filter(i => i.status === 'mismatch').length; }
