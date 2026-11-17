import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { describeError } from '../api/computer';
import type { Hypothesis, HypothesisStatus, Plan, LocalLog } from '../logic/types';
import { preferencesKV } from '../storage/kv';
import { LogQueue } from '../storage/queue';
import { loadHypotheses, createHypothesis, compareHypothesis, setHypothesisStatus } from '../local/research';
import { HYPOTHESIS_NOTE, STATUSES, STATUS_LABEL, canHypothesize, rowLine, setStatusLocal, toggleItem } from '../logic/hypothesis';

/** 假设 card on a CONFIRMED plan: write a hypothesis on plan items, compare with logs, pick a status yourself. */
export function HypothesisCard({ plan, demo, onChange }: { plan: Plan; demo: boolean; onChange: (p: Plan) => void }) {
  const [list, setList] = useState<Hypothesis[]>([]);
  const [text, setText] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const queue = new LogQueue(preferencesKV);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (demo || !canHypothesize(plan)) return;
    void loadHypotheses(preferencesKV, plan.id).then(setList);
    void queue.all().then(l => setLogs(l.map(x => ({ id: x.id, text: x.note, created_at: x.createdAt })).filter(x => x.text)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the plan or its state changes; queue is a fresh view of the same store
  }, [plan.id, plan.state, demo]);
  if (!canHypothesize(plan)) return null;
  const put = (h: Hypothesis) => setList(l => l.some(x => x.id === h.id) ? l.map(x => x.id === h.id ? h : x) : [...l, h]);
  async function add() {
    setMsg('');
    if (demo) { setMsg(tr('演示模式下不保存假设。')); return; }
    try {
      const h = await createHypothesis(preferencesKV, plan, text.trim(), sel); put(h);
      onChange(plan); setText(''); setSel([]);
    } catch (e) { setMsg(describeError(e)); }
  }
  async function compare(h: Hypothesis) {
    try { put(await compareHypothesis(preferencesKV, plan, h, logs)); }
    catch (e) { setMsg(describeError(e)); }
  }
  async function status(h: Hypothesis, s: HypothesisStatus) {
    try { put(demo ? setStatusLocal(h, s) : await setHypothesisStatus(preferencesKV, h, s)); }
    catch (e) { setMsg(describeError(e)); }
  }
  return (
    <div className="card" data-testid="hypothesis-card">
      <h2>{tr('假设')}</h2>
      <div className="muted">{tr(HYPOTHESIS_NOTE)}</div>
      {list.map(h => (
        <div className="plan-item" key={h.id}>
          <div><b>{h.text}</b> — {STATUS_LABEL[h.status]}</div>
          {h.number_check.state === 'needs_confirmation' && <div className="number-gate">{tr('需确认:')} {h.number_check.missing.join(', ')} {tr('未在所引页原文中找到')}</div>}
          {h.comparison?.rows.map(r => <div className="muted" key={r.plan_item_id}>{rowLine(r)}</div>)}
          <div className="row">
            <button className="ghost small" disabled={!logs.length} onClick={() => compare(h)}>{tr('与日志对照')}</button>
            {STATUSES.map(s => <button key={s} className={h.status === s ? 'primary small' : 'ghost small'} onClick={() => status(h, s)}>{STATUS_LABEL[s]}</button>)}
          </div>
        </div>
      ))}
      <textarea rows={2} value={text} aria-label={tr('假设')} placeholder={tr('写下你的假设')} onChange={e => setText(e.target.value)} />
      {plan.items.map(i => (
        <label key={i.id} className="row"><input type="checkbox" checked={sel.includes(i.id)} onChange={() => setSel(toggleItem(sel, i.id))} />
          {i.text.slice(0, 80)} {i.citation ? `[p.${i.citation.page_number}]` : tr('(无论文依据)')}</label>
      ))}
      <button className="ghost" disabled={!text.trim() || !sel.length} onClick={add}>{tr('添加假设')}</button>
      {msg && <div className="error">{msg}</div>}
    </div>
  );
}
