// Phone-only ask loop: local PDF text -> direct model (LOCAL mock server, fake key) -> answer with pages. 非真机.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, type GetDocument, type PdfText } from '../src/pdf/extract';
import { askLocal, citedPages, rankPassages } from '../src/logic/askLocal';
import { DEFAULT_MODEL_SETTINGS } from '../src/model/settings';
import { AUTO_INTERVAL_MS, autoCheckUpdate, saveSource } from '../src/update/manifest';
import { memoryKV } from '../src/storage/kv';
import { setLang } from '../src/i18n';

const FAKE = 'test-fake-key-000';
const bodies: string[] = []; const hits: string[] = [];
let srv: Server; let base = ''; let doc: PdfText;
const manifestJson = () => JSON.stringify({ versionName: '0.2.0', versionCode: 2, minSupportedVersionCode: 1, sha256: 'b'.repeat(64), size: 10,
  apk: [{ url: `${base}/a.apk`, priority: 1 }], releaseNotes: '说明', publishedAt: '2026-11-20T12:00:00+08:00', channel: 'stable' });
beforeAll(async () => {
  doc = await extractPdfText(new Uint8Array(readFileSync('tests/fixtures/pdf/text.pdf')), pdfjs.getDocument as unknown as GetDocument);
  srv = createServer((req, res) => {
    hits.push(req.url ?? ''); let b = ''; req.on('data', c => b += c); req.on('end', () => {
      bodies.push(b);
      if (req.url === '/v/version.json') return void res.end(manifestJson());
      if (req.url === '/v/bad.json') return void res.end('{');
      if (req.headers.authorization !== `Bearer ${FAKE}`) { res.statusCode = 401; return void res.end('{}'); }
      const nopage = req.url?.startsWith('/nopage');
      res.end(JSON.stringify({ choices: [{ message: { content: nopage ? '用了 Adam。' : '用 Adam 训练 EEGNet,学习率 0.001 [p.1]。另见 [p.9]。' } }] }));
    });
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.close(); setLang('zh'); });
const S = (p = 'm') => ({ ...DEFAULT_MODEL_SETTINGS, baseUrl: `${base}/${p}`, model: 'mock', timeoutMs: 500 });

describe('local ask', () => {
  it('ranks passages and keeps page numbers', () => {
    expect(rankPassages(doc, 'What learning rate with Adam?')[0].page).toBe(1);
    expect(rankPassages(doc, 'accuracy results')[0].page).toBe(2);
  });
  it('model answer cites only pages that were sent; prompt carries [p.N] passages', async () => {
    const a = await askLocal(doc, 'What learning rate with Adam?', S(), FAKE);
    expect(a.mode).toBe('model'); expect(a.pages).toEqual([1]); expect(a.text).toContain('[p.1]');
    expect(JSON.parse(bodies.at(-1)!).messages[1].content).toContain('[p.1] Methods');
    expect(citedPages('x [p.2] [ p 1 ] [p.2]', [1, 2])).toEqual([2, 1]);
  });
  it('model answer without pages -> empty pages (UI warns)', async () => {
    expect((await askLocal(doc, 'Adam learning rate', S('nopage'), FAKE)).pages).toEqual([]);
  });
  it('bad key / no key -> rule mode with Chinese reason and passages with pages', async () => {
    const a = await askLocal(doc, 'Adam learning rate', S(), 'wrong-key');
    expect(a.mode).toBe('rules'); expect(a.reason).toMatch(/拒绝了这个密钥.*规则模式/); expect(a.passages[0].page).toBe(1);
    const n = hits.length;
    const b = await askLocal(doc, 'Adam learning rate', S(), '');
    expect(b.mode).toBe('rules'); expect(b.reason).toMatch(/还没有填模型密钥/); expect(hits.length).toBe(n);
    setLang('en'); expect((await askLocal(doc, 'Adam', S(), '')).reason).toMatch(/rule-only/); setLang('zh');
    expect(JSON.stringify([a, b])).not.toContain(FAKE);
  });
  it('no matching passage -> no model call', async () => {
    const n = hits.length;
    const a = await askLocal(doc, 'zebra giraffe', S(), FAKE);
    expect(a.mode).toBe('rules'); expect(a.reason).toMatch(/没找到/); expect(hits.length).toBe(n);
  });
});

describe('cold-start auto update check', () => {
  it('silent and no request when no source configured', async () => {
    const kv = memoryKV(); await saveSource(kv, ''); // explicit empty disables (default would hit GitHub)
    const n = hits.length;
    expect(await autoCheckUpdate(kv, 1e12, 1, 'stable')).toBeNull(); expect(hits.length).toBe(n);
  });
  it('reports a newer version, then throttles for 12h', async () => {
    const kv = memoryKV(); await saveSource(kv, `${base}/v/version.json`); const t = 1.8e12;
    expect((await autoCheckUpdate(kv, t, 1, 'stable'))?.versionName).toBe('0.2.0');
    const n = hits.length;
    expect(await autoCheckUpdate(kv, t + 3600e3, 1, 'stable')).toBeNull(); expect(hits.length).toBe(n);
    expect(await autoCheckUpdate(kv, t + AUTO_INTERVAL_MS, 1, 'stable')).not.toBeNull();
    expect(hits.filter(h => h.endsWith('.apk'))).toEqual([]); // never downloads
  });
  it('failures are silent (null), same version -> null', async () => {
    const kv = memoryKV(); await saveSource(kv, `${base}/v/bad.json`);
    expect(await autoCheckUpdate(kv, 1e12, 1, 'stable')).toBeNull();
    const kv2 = memoryKV(); await saveSource(kv2, `${base}/v/version.json`);
    expect(await autoCheckUpdate(kv2, 1e12, 2, 'stable')).toBeNull();
  });
});

describe('1.4: whole-paper question without a model key', () => {
  it('says the key is needed, makes no request', async () => {
    const doc: PdfText = { pages: [{ page: 1, text: 'We used Adam with learning rate 0.001.' }], numPages: 1, chars: 40 };
    let called = 0; const f = async () => { called++; return new Response('{}'); };
    for (const q of ['这篇论文讲什么', '总结一下', '总结一下这篇论文', '这篇文章的主要内容是什么？', 'Summarize this paper', 'What is this paper about?']) {
      const r = await askLocal(doc, q, DEFAULT_MODEL_SETTINGS, '', f);
      expect(r.reason).toMatch(/^需要先在设置里填模型密钥/);
    }
    expect(called).toBe(0);
    const specific = await askLocal(doc, 'What learning rate with Adam?', DEFAULT_MODEL_SETTINGS, '', f);
    expect(specific.reason ?? '').not.toMatch(/^需要先在设置里填模型密钥/); expect(specific.passages.length).toBe(1);
  });
});
