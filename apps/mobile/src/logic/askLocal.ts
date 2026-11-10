import { tr } from '../i18n';
import type { PdfText } from '../pdf/extract';
import { withFallback, type ChatMessage, type FetchLike } from '../model/direct';
import type { ModelSettings } from '../model/settings';

/** Phone-only ask: local PDF text -> pick passages (with page numbers) -> direct model, else rule mode. */
export interface LocalPassage { page: number; text: string; score: number }
export interface LocalAnswer {
  mode: 'model' | 'rules';
  text: string;            // model answer, or '' in rule mode
  pages: number[];         // pages cited by the model (only pages we actually sent)
  passages: LocalPassage[];
  reason?: string;         // why rule mode was used (Chinese/English via tr)
}

const CHUNK = 1000;
function terms(s: string): string[] {
  const t = s.toLowerCase();
  const words = t.match(/[a-z0-9][a-z0-9.-]{1,}/g) ?? [];
  const cjk = (t.match(/[\u4e00-\u9fff]+/g) ?? []).flatMap(r => r.length < 2 ? [r] : Array.from({ length: r.length - 1 }, (_, i) => r.slice(i, i + 2)));
  return [...new Set([...words.filter(w => w.length >= 3), ...cjk])];
}
export function chunks(doc: PdfText): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  for (const p of doc.pages) {
    const t = p.text.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < t.length; i += CHUNK) out.push({ page: p.page, text: t.slice(i, i + CHUNK) });
  }
  return out;
}
export function rankPassages(doc: PdfText, question: string, k = 3): LocalPassage[] {
  const q = terms(question);
  return chunks(doc)
    .map(c => { const low = c.text.toLowerCase(); return { ...c, score: q.reduce((s, w) => s + (low.includes(w) ? 1 : 0), 0) }; })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, k);
}
export function citedPages(text: string, allowed: number[]): number[] {
  const set = new Set(allowed); const out: number[] = [];
  for (const m of text.matchAll(/\[\s*p\.?\s*(\d+)\s*\]/gi)) { const n = Number(m[1]); if (set.has(n) && !out.includes(n)) out.push(n); }
  return out;
}
export function buildMessages(question: string, ps: LocalPassage[]): ChatMessage[] {
  const ctx = ps.map(p => `[p.${p.page}] ${p.text}`).join('\n\n');
  return [
    { role: 'system', content: '只根据下面给出的论文原文段落回答。每句话后面用 [p.页码] 标出依据的页码。原文里没有的就说没找到,不要编。' },
    { role: 'user', content: `原文段落:\n${ctx}\n\n问题:${question}` },
  ];
}

const WHOLE = /^(?:请)?(?:帮我)?(?:这篇|这篇文章|这篇论文|本文|本论文|全文|文章|论文)?(?:的)?\s*(?:讲(?:了)?什么|说了什么|主要内容(?:是什么)?|是什么|做(?:了)?什么|主旨|总结(?:一下)?|概括(?:一下)?|介绍(?:一下)?|摘要)[?？。.!！]?$|^(?:请)?(?:帮我)?(?:总结|概括|介绍)(?:一下)?(?:这篇|本文|全文)?(?:论文|文章)?(?:的主要内容)?[?？。.!！]?$|^(?:what (?:is|does) (?:this|the) (?:paper|article) (?:about|say)|summar(?:ize|y)|tl;?dr|abstract)\b/i;
export async function askLocal(doc: PdfText, question: string, s: ModelSettings, key: string, f?: FetchLike): Promise<LocalAnswer> {
  if (!key && WHOLE.test(question.trim())) return { mode: 'rules', text: '', pages: [], passages: [], reason: tr('需要先在设置里填模型密钥:整篇论文概括需要模型处理,没有密钥不能用规则代替。') };
  const passages = rankPassages(doc, question);
  if (passages.length === 0) {
    return { mode: 'rules', text: '', pages: [], passages, reason: tr('在这篇 PDF 里没找到和问题相关的段落,没有调用模型。') };
  }
  const r = await withFallback(s, key, buildMessages(question, passages), () => passages, f);
  if (r.mode === 'model') {
    const pages = citedPages(r.text, passages.map(p => p.page));
    return { mode: 'model', text: r.text, pages, passages };
  }
  return { mode: 'rules', text: '', pages: [], passages, reason: r.reason };
}
