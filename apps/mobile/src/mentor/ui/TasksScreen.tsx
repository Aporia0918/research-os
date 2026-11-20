// 任务: the advisor's one-line ask → a breakdown the advisor edits and confirms; plus the student's timetable.
import { useState } from 'react';
import { newId } from '../../local/store';
import { draftBreakdown, findGaps } from '../ai';
import { askLine, type Gap } from '../gaps';
import { buildMemory } from '../memory';
import { selfCheck, titleOf } from '../breakdown';
import { freeTime } from '../schedule';
import type { Busy, Step } from '../types';
import { SourceTag, WEEK, when, type ScreenProps } from './common';

const endOfDay = (s: string) => { const d = new Date(`${s}T23:59`); return d.getTime(); };
const isoDay = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export function TasksScreen({ data, update, now }: ScreenProps) {
  const [ask, setAsk] = useState('');
  const [student, setStudent] = useState(data.me);
  const [due, setDue] = useState(isoDay(now + 7 * 86_400_000));
  const [draft, setDraft] = useState<{ steps: Step[]; note: string; source: 'model' | 'rules' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<{ ask: Gap[]; filled: Gap[]; note: string; source: 'model' | 'rules' } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const memory = buildMemory(data.meetings);
  const freeMinutes = freeTime(data.timetable, now, endOfDay(due)).reduce((a, f) => a + (f.end - f.start) / 60_000, 0);
  const check = draft ? selfCheck(draft.steps, freeMinutes) : null;

  async function checkGaps() {
    setBusy(true);
    try { const r = await findGaps(ask, memory); setGaps({ ...r.value, note: r.note, source: r.source }); setAnswers({}); } finally { setBusy(false); }
  }
  /** The ask as the student now understands it: the advisor's words, their answers, and the earlier requirements that apply. */
  const fullAsk = () => [ask,
    ...(gaps?.ask ?? []).filter(g => answers[g.slot]?.trim()).map(g => `${g.slot}：${answers[g.slot].trim()}`),
    ...(gaps?.filled ?? []).map(g => `导师以前说过：${g.filledBy!.now.text}`)].join('\n');
  async function breakdown() {
    setBusy(true);
    try { const r = await draftBreakdown(fullAsk(), freeMinutes); setDraft({ steps: r.value, note: r.note, source: r.source }); } finally { setBusy(false); }
  }
  const edit = (id: string, patch: Partial<Step>) => setDraft(d => d && { ...d, steps: d.steps.map(s => s.id === id ? { ...s, ...patch } : s) });
  function confirm() {
    if (!draft) return;
    const asked = (gaps?.ask ?? []).map(g => ({ question: g.question, answer: answers[g.slot]?.trim() ?? '' }));
    update(d => ({ ...d, tasks: [...d.tasks, { id: newId(), ask, title: titleOf(ask), student: student.trim() || d.me, due: endOfDay(due), steps: draft.steps, createdAt: Date.now(), confirmed: true, source: draft.source, asked }] }));
    setAsk(''); setDraft(null); setGaps(null);
  }
  return (
    <>
      <h1>导师布置了什么</h1>
      <div className="card">
        <textarea rows={2} placeholder="导师的一句话，比如：下周组会前把这三篇论文的方法对比做出来" value={ask} onChange={e => setAsk(e.target.value)} />
        <div className="row">
          <label className="muted">谁做 <input value={student} onChange={e => setStudent(e.target.value)} style={{ width: 80 }} /></label>
          <label className="muted">截止 <input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
        </div>
        <div className="row">
          <button className="primary" disabled={!ask.trim() || busy} onClick={() => void checkGaps()}>先看哪里没说清</button>
          <button className="ghost" disabled={!ask.trim() || busy} onClick={() => void breakdown()}>{busy ? '请稍等…' : '直接拆成小步'}</button>
        </div>
      </div>
      {gaps && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>{gaps.note} <SourceTag source={gaps.source} /></p>
          {gaps.ask.length ? <>
            <b>这句话没说清，建议当场问一句</b>
            <p className="plan-item key-action" style={{ margin: 0 }}>{askLine(gaps.ask)}</p>
            <button className="ghost" onClick={() => void navigator.clipboard?.writeText(askLine(gaps.ask))}>复制这句话</button>
            {gaps.ask.map(g => (
              <label key={g.slot} className="muted">导师怎么回答「{g.slot}」
                <input value={answers[g.slot] ?? ''} onChange={e => setAnswers({ ...answers, [g.slot]: e.target.value })} placeholder="问完记一句，拆解时会用上" />
              </label>
            ))}
          </> : <b>这句话说得挺清楚，不用再问。</b>}
          {gaps.filled.length > 0 && <>
            <b>这些按导师以前说的来，不用再问</b>
            {gaps.filled.map(g => <span key={g.slot} className="muted">{g.slot}：「{g.filledBy!.now.text}」</span>)}
          </>}
          <button className="primary" disabled={busy} onClick={() => void breakdown()}>{busy ? '正在拆…' : '拆成小步'}</button>
        </div>
      )}
      {draft && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>{draft.note} <SourceTag source={draft.source} /></p>
          {draft.steps.map((s, i) => (
            <div key={s.id} className="plan-item">
              <input value={s.title} onChange={e => edit(s.id, { title: e.target.value })} aria-label={`第 ${i + 1} 步`} />
              <div className="row">
                <input value={s.output} onChange={e => edit(s.id, { output: e.target.value })} placeholder="交什么" style={{ flex: 1 }} />
                <input inputMode="numeric" value={s.minutes} onChange={e => edit(s.id, { minutes: Number(e.target.value) || 0 })} style={{ width: 64 }} aria-label="分钟" />
              </div>
            </div>
          ))}
          {check && !check.ok && <ul className="alert">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
          <p className="muted" style={{ margin: 0 }}>截止前空闲约 {Math.round(freeMinutes / 60)} 小时（按课表算）</p>
          <button className="primary" onClick={confirm}>确认，加入任务</button>
        </div>
      )}
      <h2>进行中</h2>
      {data.tasks.filter(t => t.confirmed).map(t => (
        <div key={t.id} className="card entry">
          <div style={{ flex: 1 }}><b>{t.title}</b><div className="muted">{t.student} · {when(t.due, now)} 截止 · {t.steps.filter(s => s.done).length}/{t.steps.length} 步</div></div>
          <button className="ghost" onClick={() => update(d => ({ ...d, tasks: d.tasks.filter(x => x.id !== t.id) }))}>删除</button>
        </div>
      ))}
      <Timetable data={data} update={update} now={now} />
    </>
  );
}

function Timetable({ data, update }: ScreenProps) {
  const [slot, setSlot] = useState<Busy>({ day: 1, start: '08:00', end: '09:40' });
  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>我的课表</h2>
      <p className="muted" style={{ margin: 0 }}>上课时间不会安排任务，也不会提醒。</p>
      {[...data.timetable].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)).map((b, i) => (
        <div key={`${b.day}${b.start}${i}`} className="row" style={{ alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{WEEK[b.day]} {b.start}–{b.end} {b.label ?? ''}</span>
          <button className="ghost" onClick={() => update(d => ({ ...d, timetable: d.timetable.filter(x => x !== b) }))}>删除</button>
        </div>
      ))}
      <div className="row">
        <select value={slot.day} onChange={e => setSlot({ ...slot, day: Number(e.target.value) })}>{WEEK.map((w, i) => <option key={w} value={i}>{w}</option>)}</select>
        <input type="time" value={slot.start} onChange={e => setSlot({ ...slot, start: e.target.value })} />
        <input type="time" value={slot.end} onChange={e => setSlot({ ...slot, end: e.target.value })} />
        <button className="ghost" disabled={slot.end <= slot.start} onClick={() => update(d => ({ ...d, timetable: [...d.timetable, slot] }))}>加一节课</button>
      </div>
    </div>
  );
}
