import { useEffect, useState } from 'react';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { tr } from '../i18n';
import { preferencesKV } from '../storage/kv';
import { base64ToBlob } from '../pdf/blob';
import { DEMO_LABEL, demoAnswer, demoPaper } from '../demo/demo';
import { askLocal, chunks, type LocalAnswer } from '../logic/askLocal';
import { describePdfError } from '../pdf/extract';
import { loadKey, loadModelSettings } from '../model/settings';
import { ANSWER_STATUS_LABEL, type PaperRef } from '../logic/papers';
import { pageLabel } from '../logic/types';
import { loadPaper, paperPages, preparePaper, savePaper, type ImportTimings, type LocalPaper } from '../local/paperStore';
import { book, today } from '../ledger/book';
import { importStages, resetImportTimings, timed } from '../perf/timing';

export function AskScreen({ demo }: { demo: boolean }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<PaperRef | null>(null);
  const [answer, setAnswer] = useState<typeof demoAnswer | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<LocalPaper | null>(null);
  const [local, setLocal] = useState<LocalAnswer | null>(null);
  useEffect(() => {
    let live = true;
    setAnswer(null); setError(''); setInfo(''); setLocal(null);
    void loadPaper(preferencesKV).then(p => {
      if (!live) return;
      setSaved(p);
      if (demo) { setPaper({ versionId: demoPaper.versionId, name: demoPaper.name, parseState: 'parsed' }); setQ(demoAnswer.question ?? ''); }
      else setPaper(p?.ref ?? null);
    });
    return () => { live = false; };
  }, [demo]);

  async function importPdf() {
    setError(''); setInfo(''); setAnswer(null); setLocal(null);
    try {
      const r = await timed('file_pick', () => FilePicker.pickFiles({ types: ['application/pdf'], limit: 1, readData: true }));
      const f = r.files[0]; if (!f) return;
      setBusy(true);
      resetImportTimings();
      const all = await timed('import_after_user_pick', async () => {
        const data = await timed('file_read_ms', async () => {
          const blob = f.blob ?? (f.data ? base64ToBlob(f.data, 'application/pdf') : null);
          if (!blob) throw new Error(tr('读不到这个文件。'));
          return new Uint8Array(await blob.arrayBuffer());
        });
        setInfo(tr('正在本机解析 {0}，不用连接电脑，不上传。', f.name));
        const { extractOnPhone } = await timed('parser_load_ms', () => import('../pdf/browser'));
        const doc = await timed('pdf_parse_ms', () => extractOnPhone(data));
        const versionId = `local-${crypto.randomUUID()}`;
        const built = await timed('chunking_ms', () => preparePaper(f.name, versionId, doc));
        // The small reusable method index is part of import, not hidden inside the first question.
        const indexed = await timed('rule_index_ms', () => built.chunks.filter(c => c.section_role === 'methods').length);
        void indexed;
        await timed('save_ms', () => savePaper(preferencesKV, built));
        return built;
      });
      setSaved(all); setPaper(all.ref); setInfo(tr('已在本机读好 {0}:共 {1} 页,可以提问、生成计划和做引用检查了。', f.name, all.doc.numPages));
      // 知识召回: a new paper is checked against every AI answer on the ledger, on the phone, by rules only.
      const hits = await book.recallScan({ name: f.name, pages: paperPages(all) }, today());
      if (hits.length) setInfo(tr('已在本机读好 {0}。账上有 {1} 条 AI 的说法被这篇论文的原话推翻，召回单在账本最上面。', f.name, hits.length));
      const timings: ImportTimings = {
        file_read_ms: round('file_read_ms'), parser_load_ms: round('parser_load_ms'), pdf_parse_ms: round('pdf_parse_ms'),
        chunking_ms: round('chunking_ms'), rule_index_ms: round('rule_index_ms'), save_ms: round('save_ms'), total_after_pick_ms: round('import_after_user_pick'),
      };
      // Aggregate durations only, no title, text, key or address. Wait for paint before measurement is read.
      const stage = document.getElementById('import-timings'); if (stage) stage.textContent = JSON.stringify(timings);
    } catch (e) { setPaper(null); setSaved(null); setError(describePdfError(e)); } finally { setBusy(false); }
  }
  function round(stage: string): number { return importStages.find(s => s.stage === stage)?.ms ?? 0; }
  async function submit() {
    if (demo) { setAnswer(demoAnswer); setInfo(tr('演示:示例问题的预先保存回答。')); return; }
    if (!saved) return;
    setBusy(true); setError(''); setAnswer(null); setLocal(null);
    try { setLocal(await askLocal(saved.doc, q.trim(), await loadModelSettings(preferencesKV), await loadKey(preferencesKV))); }
    finally { setBusy(false); }
  }

  const sentences = answer?.answer?.sentences ?? [];
  return <section>
    <h1>{tr('向论文提问')}</h1>
    {demo && <div className="demo-banner" role="note">{tr(DEMO_LABEL)}</div>}
    <div className="card">
      <div className="muted" data-testid="paper">{paper ? tr('论文:{0}(已在本机解析)', paper.name) : tr('还没有导入论文。')}</div>
      <button className="primary" disabled={busy || demo} onClick={importPdf} data-testid="import-pdf">{busy ? tr('处理中…') : tr('导入 PDF')}</button>
      <div className="muted">{tr('论文只在这台手机上读取。导入、分块、计划和引用检查都不联网;只有你主动提问且已填模型密钥时才会调用模型。')}</div>
      {saved && <div className="muted">{tr('可读文字段落:')}{chunks(saved.doc).length}</div>}
    </div>
    <div className="card">
      <textarea value={q} readOnly={demo} onChange={e => setQ(e.target.value)} rows={3} placeholder={tr('例如:EEG 是怎么预处理的?')} aria-label={tr('问题')} />
      <button className="primary" disabled={busy || (!saved && !demo) || q.trim().length < 3} onClick={submit}>{busy ? tr('处理中…') : tr('提问')}</button>
      {!demo && <div className="muted">{tr('模型请求最多等 8 秒。没有密钥或请求失败时,会直接在手机上给出相关原文段落。相近匹配要你自己判断,系统分不出真假。')}</div>}
    </div>
    {info && <div className="card muted" role="status" data-testid="import-ready">{info}</div>}
    {error && <div className="card error">{error}</div>}
    <div id="import-timings" data-testid="import-timings" hidden />
    {local && <div className="card" data-testid="local-answer">
      <div className="muted">{local.mode === 'model' ? tr('模型回答(手机直连模型,辅助定位原文、由你判断)') : tr('规则模式:下面是找到的原文段落(带页码),辅助定位原文、由你判断')}</div>
      {local.reason && <div className="verdict warn" role="status">{local.reason}</div>}
      {local.mode === 'model' && <p className="prewrap">{local.text}</p>}
      {local.mode === 'model' && (local.pages.length ? <div className="muted">{tr('引用页码:')}{local.pages.map(n => <span className="cite" key={n}>[p.{n}]</span>)}</div> : <div className="verdict warn">{tr('模型回答没有标出页码,请对照下面的原文段落。')}</div>)}
      {local.passages.map((p, i) => <div className="passage" key={i}><span className="cite">p.{p.page}</span><div>{p.text.length > 400 ? p.text.slice(0, 400) + '…' : p.text}</div></div>)}
    </div>}
    {answer && <div className="card" data-testid="answer">
      <div className="muted">{tr('状态:')}{ANSWER_STATUS_LABEL(answer.status)}{answer.status === 'not_configured' ? tr(' — 没有配置模型密钥,下面列出找到的原文段落(带页码),辅助定位原文、由你判断') : ''}</div>
      {sentences.map((s, i) => <p key={i}>{s.text} {(s.citations ?? []).map((c, j) => c.page_index != null && <span className="cite" key={j}>[{pageLabel(c.page_index)}]</span>)}</p>)}
      {(answer.passages ?? []).map(p => <div className="passage" key={p.label + p.page_index}><span className="cite">{p.label} · {pageLabel(p.page_index)}</span> <span className="muted">{p.title}</span><div>{p.text.length > 400 ? p.text.slice(0, 400) + '…' : p.text}</div></div>)}
    </div>}
  </section>;
}
