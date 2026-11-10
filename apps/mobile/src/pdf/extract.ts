import { tr } from '../i18n';

/** On-phone PDF text-layer extraction (pdf.js). Keeps page numbers. No OCR: scanned PDFs fail honestly. */
export interface PdfPage { page: number; text: string }
export interface PdfText { pages: PdfPage[]; numPages: number; chars: number }
export type PdfCode = 'bad_pdf' | 'encrypted' | 'no_text' | 'too_large';
export class PdfError extends Error { constructor(public code: PdfCode) { super(code); this.name = 'PdfError'; } }

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Fewer real characters per page than this (on average) = treat as scanned / no text layer. */
export const MIN_CHARS_PER_PAGE = 20;

export function describePdfError(e: unknown): string {
  switch (e instanceof PdfError ? e.code : 'bad_pdf') {
    case 'no_text': return tr('这个 PDF 没有可复制的文字(多半是扫描件或图片),手机上暂时读不了。请换带文字的版本,或在电脑上先做文字识别。');
    case 'encrypted': return tr('这个 PDF 有密码保护,手机上读不了。');
    case 'too_large': return tr('这个 PDF 太大了(超过 50 MB),手机上先不读。');
    default: return tr('这个文件打不开,可能不是 PDF 或已经损坏。');
  }
}

// Minimal structural types so the same code runs with the browser build and the node legacy build.
interface TextItem { str?: string; hasEOL?: boolean }
interface PageProxy { getTextContent(): Promise<{ items: TextItem[] }>; cleanup?(): void }
interface DocProxy { numPages: number; getPage(n: number): Promise<PageProxy>; destroy(): Promise<void> }
export type GetDocument = (src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean }) => { promise: Promise<DocProxy> };

export async function extractPdfText(data: Uint8Array, getDocument: GetDocument): Promise<PdfText> {
  if (data.byteLength > MAX_PDF_BYTES) throw new PdfError('too_large');
  let doc: DocProxy;
  try { doc = await getDocument({ data, isEvalSupported: false }).promise; }
  catch (e) { throw new PdfError((e as { name?: string })?.name === 'PasswordException' ? 'encrypted' : 'bad_pdf'); }
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const tc = await p.getTextContent();
      const text = tc.items.map(i => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      pages.push({ page: n, text });
      p.cleanup?.();
    }
    const chars = pages.reduce((s, p) => s + p.text.replace(/\s/g, '').length, 0);
    if (chars < MIN_CHARS_PER_PAGE * Math.max(1, doc.numPages) / 2 || chars === 0) throw new PdfError('no_text');
    return { pages, numPages: doc.numPages, chars };
  } finally { await doc.destroy(); }
}

/** Find which page a quote is on (page numbers kept for citations). */
export function findPage(t: PdfText, needle: string): number | null {
  const q = needle.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!q) return null;
  const hit = t.pages.find(p => p.text.replace(/\s+/g, ' ').toLowerCase().includes(q));
  return hit ? hit.page : null;
}
