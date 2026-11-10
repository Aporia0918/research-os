import { tr, trObj, fmtDate } from '../i18n';
import { useEffect, useState } from 'react';
import { describeError } from '../api/computer';
import type { Guidance, LocalLog } from '../logic/types';
import { preferencesKV } from '../storage/kv';
import { LogQueue } from '../storage/queue';
import { loadPaper } from '../local/paperStore';
import { runGuidance, loadPlan, loadGuidance, saveGuidance, confirmGuidance } from '../local/research';
import { LAST_PAPER_KEY, METHOD_LABEL, type PaperRef } from '../logic/papers';
import { DECISION_LABEL, PREDICT_KIND_LABEL, PREDICT_NOTE, toggleLog, canDecide, decisionsFor, invalidEdits, openNearMatches, setDecision, tally, verdictLabel, NO_IDEA_TOPIC, TALLY_LABEL, noIdeaQuestions } from '../logic/guidance';

type Mode = 'questions' | 'citation_check' | 'methods_check' | 'predict';
const MODES: { id: Mode; label: string; hint: string; placeholder: string }[] = trObj([
  { id: 'questions', label: '反问', hint: '写下你的研究想法。会针对你想法里提到的内容给出最多 5 个反问,每个都对应论文方法部分的一句原文和页码;对不上时不出反问。',
    placeholder: '例如:我想用我们自己的 32 通道 EEG 复现,并和基线对比。' },
  { id: 'citation_check', label: '引用检查', hint: '粘贴你写的关于这篇论文的句子。每句会得到:找到原句(页码 + 原句)、找到相近原文(需要你确认),或无法核对(规则模式读不懂意译,不等于没有依据)。辅助定位原文、由你判断。',
    placeholder: '例如:模型用 Adam 训练了 750 个 epoch。' },
  { id: 'methods_check', label: '方法检查', hint: '粘贴你的方法段落。会和你最近确认的计划对照;计划里你没写到的条目排在前面。',
    placeholder: '例如:EEG 做了 1-40 Hz 带通滤波,并切成 2 s 的片段。' },
  { id: 'predict', label: '预测与调整', hint: '勾选实验记录。记录里的数字会和你最近确认的计划所用论文对照;每条建议都带页码。预测与调整建议仅为辅助参考,是否调整由你决定。',
    placeholder: '' },
]);

/** Research and writing guidance. Rules only unless a model key is set on the on-device model; the user decides, then confirms. */
export function GuideScreen({ demo }: { demo: boolean }) {
  const [paper, setPaper] = useState<PaperRef | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('questions');
  const [text, setText] = useState('');
  const [g, setG] = useState<Guidance | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const queue = new LogQueue(preferencesKV);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    void preferencesKV.get(LAST_PAPER_KEY).then(v => setPaper(v ? JSON.parse(v) as PaperRef : null));
    void loadPaper(preferencesKV).then(async p => {
      if (!p) return;
      const plan = await loadPlan(preferencesKV, p.ref.versionId);
      if (plan?.state === 'confirmed') setPlanId(plan.id);
      setG(await loadGuidance(preferencesKV, p.ref.versionId));
    });
  }, []);

  const m = MODES.find(x => x.id === mode)!;
  const needs = mode === 'methods_check' || mode === 'predict' ? !planId : !paper;
  async function loadLogs() {
    try { const l = await queue.all(); const available = l.filter(x => x.note.trim()).map(x => ({ id: x.id, text: x.note, created_at: x.createdAt })); setLogs(available); setSel(available.slice(0, 3).map(x => x.id)); } catch (e) { setMsg(describeError(e)); }
  }

  async function run() {
    setBusy(true); setMsg(''); setG(null);
    try {
      const p = await loadPaper(preferencesKV); if (!p) return;
      const plan = await loadPlan(preferencesKV, p.ref.versionId);
      const next = runGuidance(p, plan, mode, text.trim(), logs.filter(l => sel.includes(l.id)));
      await saveGuidance(preferencesKV, next); setG(next);
    } catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!g) return;
    if (invalidEdits(g).length) { setMsg(tr('有一条改写是空的。请写上你的版本,或者换一个选项。')); return; }
    if (openNearMatches(g).length) { setMsg(tr('每条“相近原文”都需要你确认或否定后,才能确认。')); return; }
    setBusy(true); setMsg('');
    try { setG(await confirmGuidance(preferencesKV, g)); }
    catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  const editable = canDecide(g);
  return (
    <section>
      <h1>{tr('研究指导')}</h1>
      {demo && <div className="card muted" role="note">{tr('演示模式不包含写入指导结果;请关闭演示,在本机使用真实论文。')}</div>}
      <div className="row tabs-inline" role="tablist" aria-label={tr('指导模式')}>
        {MODES.map(x => <button key={x.id} role="tab" aria-selected={mode === x.id} className={mode === x.id ? 'primary small' : 'ghost small'}
                                onClick={() => { setMode(x.id); setG(null); setMsg(''); if (x.id === 'predict' && !demo) void loadLogs(); }}>{x.label}</button>)}
      </div>
      <div className="card">
        <label>{mode === 'methods_check' || mode === 'predict' ? tr('已确认的计划') : tr('论文')}</label>
        <div className="muted" data-testid="guide-source">{mode === 'methods_check' || mode === 'predict'
          ? (planId ? tr('计划已在本机确认,可以检查。') : tr('还没有已确认的计划。请先在「计划」页确认一个。'))
          : (paper ? tr(paper.name) : tr('还没有论文。请先在「提问」页导入。'))}</div>
        <div className="muted">{m.hint}</div>
        {mode === 'predict'
          ? <div data-testid="predict-logs">{logs.length === 0 ? <div className="muted">{tr('还没有实验记录。请先在「记录」页添加。')}</div>
            : logs.map(l => <label key={l.id} className="row"><input type="checkbox" checked={sel.includes(l.id)} onChange={() => setSel(toggleLog(sel, l.id))} />
              <span>{l.text.slice(0, 120)}</span></label>)}</div>
          : <textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={m.placeholder} aria-label={tr('指导输入')} />}
        <button className="primary" disabled={busy || demo || needs || (mode === 'predict' ? sel.length === 0 : !text.trim())} onClick={run}>{busy && !g ? tr('处理中…') : tr('检查')}</button>
      </div>
      {msg && <div className="card error">{msg}</div>}
      {g && (
        <>
          <div className="card" data-testid="guide-state">
            <b>{g.state === 'draft' ? tr('草稿 — 逐条选择后再确认') : tr('已确认,时间 {0}', fmtDate(g.confirmed_at!))}</b>
            <span className="muted">{tr('方式:')}{METHOD_LABEL(g.method)}{g.method !== 'model' ? tr('(规则,未用模型)') : ''} · {Object.entries(tally(g)).map(([k, v]) => `${TALLY_LABEL[k] ?? k} ${v}`).join(' · ')}</span>
            <span className="muted">{tr('是否有用由你判断,App 不给自己打分。')}</span>
            {g.kind === 'predict' && <span className="muted" data-testid="predict-note">{tr(PREDICT_NOTE)}</span>}
          </div>
          {noIdeaQuestions(g) && <div className="card" data-testid="no-idea-questions">{tr(NO_IDEA_TOPIC)}</div>}
          {g.status === 'method_section_not_found' && <div className="card error"><b>{tr('未找到方法章节')}</b><div className="muted">{tr('没有方法章节,所以没有生成反问。')}</div></div>}
          {g.items.map(i => (
            <div className="card plan-item" key={i.id} data-testid="guide-item">
              {g.kind === 'questions' && <div><b>{i.question}</b>{i.why && <div className="muted">{i.why}</div>}</div>}
              {g.kind === 'citation_check' && <div>“{i.claim}”</div>}
              {g.kind === 'methods_check' && <div>{i.plan_text}</div>}
              {g.kind === 'predict' && <div data-testid="predict-item"><div className={i.kind === 'weak_match' ? 'verdict bad' : i.kind === 'adjust' ? 'verdict warn' : i.kind === 'consistent' ? 'verdict ok' : 'verdict warn'}>{PREDICT_KIND_LABEL[i.kind ?? 'adjust']}</div>
                {i.log_text && <div className="muted">{tr('记录:')}{i.log_text.slice(0, 160)}</div>}<div><b>{i.suggestion}</b></div><div className="muted">{i.prediction}</div></div>}
              {i.verdict && <div className={i.verdict === 'missing' ? 'verdict bad' : i.verdict === 'near_match' || i.verdict === 'cannot_check' || i.verdict === 'not_found' ? 'verdict warn' : 'verdict ok'}>{verdictLabel(i)}{i.verdict === 'near_match' ? ` — ${tr('相近匹配要你自己判断,系统分不出真假')}` : ''}</div>}
              {i.kind && <div className="muted">{tr('相近匹配要你自己判断,系统分不出真假')}</div>}
              {i.candidate && <div className="quote" data-testid="near-candidate"><span className="cite">[p.{i.candidate.page_number}]</span> “{i.candidate.quote.replace(/\s+/g, ' ').slice(0, 220)}”<div className="muted">{tr('辅助定位原文、由你判断 — 请对照原文,自己判断是不是这句。')}</div></div>}
              {i.citation && <div className="quote"><span className="cite">[p.{i.citation.page_number}]</span> “{i.citation.quote.replace(/\s+/g, ' ').slice(0, 220)}”</div>}
              {editable ? (
                <div className="row">
                  {decisionsFor(g, i).map(d => <button key={d} className={i.decision === d ? 'primary small' : 'ghost small'} onClick={() => { const next = setDecision(g, i.id, i.decision === d ? null : d); setG(next); if (!demo) void saveGuidance(preferencesKV, next); }}>{DECISION_LABEL[d]}</button>)}
                </div>
              ) : i.decision && <div className="muted">{tr('你的选择:')}{DECISION_LABEL[i.decision]}</div>}
              {i.decision === 'edit' && (editable
                ? <textarea rows={2} value={i.user_text ?? ''} aria-label={tr('你的版本')} onChange={e => { const next = setDecision(g, i.id, 'edit', e.target.value); setG(next); void saveGuidance(preferencesKV, next); }} />
                : <div>{tr('你的版本:')}{i.user_text}</div>)}
            </div>
          ))}
          {editable && g.items.length > 0 && <button className="primary confirm" disabled={busy} onClick={confirm}>{tr('确认')}</button>}
        </>
      )}
    </section>
  );
}
