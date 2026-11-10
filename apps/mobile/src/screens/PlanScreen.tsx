import { tr, fmtDate } from '../i18n';
import { useEffect, useState } from 'react';
import { describeError } from '../api/computer';
import type { Plan, PlanCategory } from '../logic/types';
import { preferencesKV } from '../storage/kv';

import { LAST_PAPER_KEY, METHOD_LABEL, type PaperRef } from '../logic/papers';
import { APPROVAL_LABEL, CATEGORIES, CATEGORY_LABEL, KEY_ACTION_LABEL, NO_METHOD_LABEL, NUMBER_GATE_LABEL, addItem, canConfirm, canEdit, confirmLocal, decideLocal, decideNumberLocal, openKeyActions, openNumberGates, editItem, grouped, methodSectionMissing, removeItem } from '../logic/plan';
import { LAST_PLAN_KEY, draftPlan, loadPlan, savePlan, confirmPlan as confirmPlanLocal, planAction, planNumber, updatePlan } from '../local/research';
import { loadPaper } from '../local/paperStore';
import { tagAll } from '../rules/planActions';
import { HypothesisCard } from './HypothesisCard';
import { DEMO_LABEL, demoPaper, demoPlan } from '../demo/demo';

/** Pick paper -> Generate plan -> review/edit items (each with its page citation) -> Confirm. */
export function PlanScreen({ demo }: { demo: boolean }) {
  const [paper, setPaper] = useState<PaperRef | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState<PlanCategory>('materials');
  useEffect(() => {
    setPlan(null); setMsg('');
    if (demo) { setPaper({ versionId: demoPaper.versionId, name: demoPaper.name, parseState: 'parsed' }); return; }
    void preferencesKV.get(LAST_PAPER_KEY).then(v => setPaper(v ? JSON.parse(v) as PaperRef : null));
    // W6C wiring: reopen the last confirmed plan so the hypothesis card is reachable after switching tabs.
    void loadPaper(preferencesKV).then(p => { if (p) void loadPlan(preferencesKV, p.ref.versionId).then(setPlan); });
  }, [demo]);
  

  async function generate() {
    if (!paper) return;
    setBusy(true); setMsg('');
    try {
      const next = demo ? demoPlan() : draftPlan((await loadPaper(preferencesKV))!);
      if (!demo) await savePlan(preferencesKV, next);
      setPlan(next);
    } catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!plan) return;
    setBusy(true); setMsg('');
    try {
      let next: Plan;
      if (demo) next = confirmLocal(plan);
      else { const tagged = await updatePlan(preferencesKV, plan); setPlan(tagged); next = await confirmPlanLocal(preferencesKV, tagged); }
      setPlan(next); await preferencesKV.set(LAST_PLAN_KEY, next.id);
    } catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  async function decide(id: string, d: 'approve' | 'reject') {
    if (!plan) return; setBusy(true); setMsg('');
    try { const next = demo ? decideLocal(plan, id, d) : await planAction(preferencesKV, plan, id, d); setPlan(next); }
    catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  // Re-tag on every change so a key action (model call / data out / share) or an unquoted number gets its
  // approve / confirm buttons right away, not only when the user presses 确认计划.
  function commitPlan(next: Plan) { const tagged = { ...next, items: tagAll(next.items, plan?.items ?? []) }; setPlan(tagged); if (!demo) void savePlan(preferencesKV, tagged); }
  const openActions = openKeyActions(plan).length;
  async function decideNumber(id: string, d: 'confirm_match' | 'reject_match') {
    if (!plan) return; setBusy(true); setMsg('');
    try { const next = demo ? decideNumberLocal(plan, id, d) : await planNumber(preferencesKV, plan, id, d); setPlan(next); }
    catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }
  const editable = canEdit(plan);
  const openNums = openNumberGates(plan).length;
  const g = plan ? grouped(plan.items) : null;
  return (
    <section>
      <h1>{tr('实验计划')}</h1>
      {demo && <div className="demo-banner" role="note">{tr(DEMO_LABEL)}</div>}
      <div className="card">
        <label>{tr('论文')}</label>
        <div className="muted" data-testid="plan-paper">{paper ? `${paper.name} · ${tr('本机')}` : tr('还没有论文。请先在「提问」页导入。')}</div>
        <button className="primary" disabled={busy || !paper || (plan?.state === 'confirmed')} onClick={generate}>
          {busy && !plan ? tr('处理中…') : tr('生成计划')}</button>
        <div className="muted">{tr('根据论文方法部分在本机起草。你点「确认计划」之前都不算数。')}</div>
      </div>
      {msg && <div className="card error">{msg}</div>}
      {plan && methodSectionMissing(plan) && (
        <div className="card error" data-testid="plan-no-method">
          <b>{tr(NO_METHOD_LABEL)}</b>
          <div className="muted">{tr('这篇论文里没找到方法类标题(Methods / Materials and Methods / Experimental setup / Dataset),所以没有起草计划条目。不会从摘要、引言或结果里猜。')}</div>
        </div>
      )}
      {plan && g && !methodSectionMissing(plan) && (
        <>
          <div className="card" data-testid="plan-state">
            <b>{plan.state === 'draft' ? tr('草稿 — 检查、修改后再确认') : tr('已确认,时间 {0}', fmtDate(plan.confirmed_at!))}</b>
            <span className="muted">{tr('方式:')}{METHOD_LABEL(plan.method)}{plan.method === 'deterministic_fallback' ? tr('(没有模型密钥,用了规则)') : ''}</span>
          </div>
          {CATEGORIES.map(cat => (
            <div className="card" key={cat}>
              <h2>{CATEGORY_LABEL[cat]} ({g[cat].length})</h2>
              {g[cat].length === 0 && <div className="muted">{tr('方法部分里没有找到。')}</div>}
              {g[cat].map(i => (
                <div className={i.key_action ? 'plan-item key-action' : 'plan-item'} key={i.id}>
                  {i.key_action && <div className="key-action-head" data-testid="key-action">
                    <b>{KEY_ACTION_LABEL[i.key_action]}</b> · {APPROVAL_LABEL[i.approval?.state ?? 'needs_approval']}
                    {i.approval?.decided_at && <span className="muted"> ({fmtDate(i.approval.decided_at)})</span>}
                    <div className="muted">{tr('辅助提示:这一步会调用模型、送出数据或分享,是否执行由你判断。这里只记录你的决定,不会自动执行。')}</div>
                    {editable && <div className="row">
                      <button className="primary small" disabled={busy} onClick={() => decide(i.id, 'approve')}>{tr('批准')}</button>
                      <button className="ghost small" disabled={busy} onClick={() => decide(i.id, 'reject')}>{tr('拒绝')}</button>
                    </div>}
                  </div>}
                  {editable
                    ? <textarea rows={2} value={i.text} aria-label={tr('条目内容')} onChange={e => commitPlan(editItem(plan, i.id, { text: e.target.value }))} />
                    : <div>{i.text}</div>}
                  {i.citation
                    ? <div className="quote"><span className="cite">[p.{i.citation.page_number}]</span> “{i.citation.quote.replace(/\s+/g, ' ').slice(0, 220)}”</div>
                    : <div className="muted">{tr('你自己加的 — 没有论文引用。')}</div>}
                  {i.number_gate && i.number_gate.state !== 'ok' && <div className="number-gate" data-testid="number-gate">
                    <b>{NUMBER_GATE_LABEL[i.number_gate.state]}</b>{tr(': 数字')} {i.number_gate.missing.join(', ')} {i.citation ? tr('在引用页找不到原文') : tr('没有论文引用')}{tr('。辅助定位原文、由你判断。')}
                    {editable && i.number_gate.state === 'needs_confirmation' && <div className="row">
                      <button className="primary small" disabled={busy} onClick={() => decideNumber(i.id, 'confirm_match')}>{tr('确认此数值')}</button>
                      <button className="ghost small" disabled={busy} onClick={() => decideNumber(i.id, 'reject_match')}>{tr('否认')}</button>
                    </div>}
                  </div>}
                  {i.edited && i.citation && <div className="muted">{tr('你改过;上面引的是原文出处。')}</div>}
                  {editable && <div className="row">
                    <select value={i.category} aria-label={tr('类别')} onChange={e => commitPlan(editItem(plan, i.id, { category: e.target.value as PlanCategory }))}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                    <button className="ghost small" onClick={() => commitPlan(removeItem(plan, i.id))}>{tr('删除')}</button>
                  </div>}
                </div>
              ))}
            </div>
          ))}
          {editable && (
            <div className="card">
              <label>{tr('添加你自己的条目')}</label>
              <select aria-label={tr('新条目类别')} value={newCat} onChange={e => setNewCat(e.target.value as PlanCategory)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <input value={newText} onChange={e => setNewText(e.target.value)} placeholder={tr('例如:我们的放大器型号')} aria-label={tr('新条目内容')} />
              <button className="ghost" disabled={!newText.trim()} onClick={() => { commitPlan(addItem(plan, newCat, newText.trim(), `local-${crypto.randomUUID()}`)); setNewText(''); }}>{tr('添加')}</button>
            </div>
          )}
          {editable && openActions > 0 && <div className="card muted" data-testid="key-action-open">{tr('还有')} {openActions} {tr('个关键动作待你批准或拒绝。')}</div>}
          {editable && openNums > 0 && <div className="card muted" data-testid="number-gate-open">{tr('还有')} {openNums} {tr('条数字需确认。')}</div>}
          <HypothesisCard plan={plan} demo={demo} onChange={p => { setPlan(p); if (!demo) void savePlan(preferencesKV, p); }} />
          {editable && <button className="primary confirm" disabled={busy || !canConfirm(plan) || openNums > 0} onClick={confirm}>{tr('确认计划')}</button>}
        </>
      )}
    </section>
  );
}
