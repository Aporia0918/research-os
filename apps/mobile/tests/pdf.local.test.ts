// On-phone PDF text extraction logic, run in node with pdf.js legacy build and fixed sample PDFs. 非真机.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfError, describePdfError, extractPdfText, findPage, type GetDocument } from '../src/pdf/extract';
import { setLang } from '../src/i18n';

const gd = pdfjs.getDocument as unknown as GetDocument;
const load = (f: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${f}`));

describe('local PDF text layer', () => {
  it('text PDF: text per page with page numbers', async () => {
    const t = await extractPdfText(load('text.pdf'), gd);
    expect(t.numPages).toBe(2);
    expect(t.pages[0]).toMatchObject({ page: 1 }); expect(t.pages[0].text).toContain('EEGNet with Adam');
    expect(t.pages[1].page).toBe(2); expect(t.pages[1].text).toContain('accuracy 0.82');
    expect(findPage(t, 'accuracy  0.82')).toBe(2); expect(findPage(t, 'learning rate')).toBe(1); expect(findPage(t, 'nope')).toBeNull();
  });
  it('scanned / image-only PDF fails honestly in Chinese', async () => {
    const e = await extractPdfText(load('scanned.pdf'), gd).catch(x => x);
    expect(e).toBeInstanceOf(PdfError); expect(e.code).toBe('no_text');
    setLang('zh'); expect(describePdfError(e)).toMatch(/扫描件/);
    setLang('en'); expect(describePdfError(e)).toMatch(/scan/i); setLang('zh');
  });
  it('not a PDF -> bad_pdf; too large -> too_large', async () => {
    const e = await extractPdfText(new TextEncoder().encode('hello, not a pdf'), gd).catch(x => x);
    expect(e.code).toBe('bad_pdf'); expect(describePdfError(e)).toMatch(/打不开/);
    const big = { byteLength: 51 * 1024 * 1024 } as Uint8Array;
    expect((await extractPdfText(big, gd).catch(x => x)).code).toBe('too_large');
  });
});
