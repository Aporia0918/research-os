import type { KV } from '../storage/kv';
import type { PdfText } from '../pdf/extract';
import type { Chunk } from '../rules/compare';
import { methodSegments } from '../rules/questions';
import type { PaperRef } from '../logic/papers';
import { LAST_PAPER_KEY } from '../logic/papers';
import { shelve } from './shelf';

export const LOCAL_DOC_KEY = 'paper.localDocument.v2';
export interface LocalPaper { ref: PaperRef; doc: PdfText; chunks: Chunk[] }
export interface ImportTimings { file_read_ms: number; parser_load_ms: number; pdf_parse_ms: number; chunking_ms: number; rule_index_ms: number; save_ms: number; total_after_pick_ms: number }

export function documentChunks(doc: PdfText): Chunk[] {
  const out: Chunk[] = [];
  for (const p of doc.pages) {
    const lines = p.text.split('\n'); let buf = ''; let seq = 0;
    const put = () => { if (buf.trim()) out.push({ page_index: p.page - 1, seq: seq++, text: buf.trim(), section_role: 'body' }); buf = ''; };
    for (const line of lines) {
      if (line.length > 500) { put(); for (let i = 0; i < line.length; i += 500) out.push({ page_index: p.page - 1, seq: seq++, text: line.slice(i, i + 500), section_role: 'body' }); }
      else { if (buf.length + line.length > 500) put(); buf += (buf ? '\n' : '') + line; }
    }
    put();
  }
  return out;
}
/** Preserve newlines for section detection; every page uses the cached text below. */
export function preparePaper(name: string, versionId: string, doc: PdfText): LocalPaper {
  const indexed = documentChunks(doc);
  const method = methodSegments(indexed);
  const ids = new Set(method.segments.map(c => `${c.page_index}:${c.seq}`));
  const chunks = indexed.map(c => ({ ...c, section_role: ids.has(`${c.page_index}:${c.seq}`) ? 'methods' : 'body' }));
  if (!method.segments.length) repairContinuationSections(doc, chunks);
  return { ref: { versionId, name, parseState: 'parsed' }, doc, chunks };
}
function repairContinuationSections(doc: PdfText, chunks: Chunk[]): void {
  const start = /(?:^|\n)\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:materials? and methods?|methods? and materials?|methods?|methodology|experimental (?:setup|design|procedures?|protocol)|study design)$/im;
  const end = /(?:^|\n)\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:results?|evaluation|discussion|conclusions?|summary|references|bibliography|appendix)$/im;
  if (!doc.pages.some(p => start.test(p.text))) return;
  let on = false;
  for (const p of doc.pages) for (const c of chunks.filter(c => c.page_index === p.page - 1)) {
    if (start.test(c.text)) on = true; if (end.test(c.text)) on = false; if (on) c.section_role = 'methods';
  }
}
export async function savePaper(kv: KV, paper: LocalPaper): Promise<void> {
  await kv.set(LOCAL_DOC_KEY, JSON.stringify(paper));
  await kv.set(LAST_PAPER_KEY, JSON.stringify(paper.ref));
  await shelve(kv, { versionId: paper.ref.versionId, name: paper.ref.name, pages: paperPages(paper) });
}
export async function loadPaper(kv: KV): Promise<LocalPaper | null> {
  const raw = await kv.get(LOCAL_DOC_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as LocalPaper;
    return p.ref?.versionId && p.doc?.pages && Array.isArray(p.chunks) ? p : null;
  } catch { return null; }
}
export function paperPages(p: LocalPaper): string[] { return p.doc.pages.map(page => page.text); }
