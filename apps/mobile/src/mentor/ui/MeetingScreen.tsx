// 组会: paste the notes (or the transcript), get both sides' to-dos and any change in the advisor's requirements.
import { useState } from 'react';
import { newId } from '../../local/store';
import { feedback, readMeeting, rehearse } from '../ai';
import { buildMemory } from '../memory';
import type { Probe } from '../rehearse';
import { DEMO_NOTES } from '../demo';
import { commonSlots } from '../schedule';
import type { Meeting } from '../types';
import { SourceTag, when, type ScreenProps } from './common';

export function MeetingScreen({ data, update, now }: ScreenProps) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const history = data.meetings.flatMap(m => m.requirements);
  const slots = commonSlots([data.timetable, data.advisorBusy], now);

  async function read() {
    setBusy(true);
    try {
      const id = newId(), at = Date.now();
      const r = await readMeeting(notes, id, at, history);
      const m: Meeting = { id, at, text: notes, ...r.value, source: r.source };
      update(d => ({ ...d, meetings: [m, ...d.meetings] }));
      setNote(r.note); setNotes('');
    } finally { setBusy(false); }
  }
  const patch = (mid: string, f: (m: Meeting) => Meeting) => update(d => ({ ...d, meetings: d.meetings.map(m => m.id === mid ? f(m) : m) }));
  return (
    <>
      <Rehearsal data={data} update={update} now={now} />
      <h1>组会之后</h1>
      <div className="card">
        <textarea rows={6} placeholder={'把组会记录粘进来，每行一个人说的话，例如：\n老师：你下周三之前把第四篇补进对比表。\n小林：好的。'} value={notes} onChange={e => setNotes(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={!notes.trim() || busy} onClick={() => void read()}>{busy ? '正在整理…' : '整理待办'}</button>
          <button className="ghost" onClick={() => setNotes(DEMO_NOTES)}>用示例记录</button>
        </div>
        {note && <p className="muted" style={{ margin: 0 }}>{note}</p>}
      </div>
      {slots.length > 0 && <div className="card"><b>下次组会可以约</b>{slots.map(s => <span key={s.start} className="muted">{when(s.start, now)}–{new Date(s.end).toTimeString().slice(0, 5)}</span>)}<span className="muted">按你的课表和导师的忙碌时间算</span></div>}
      {data.meetings.filter(m => m.text).map(m => (
        <div key={m.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{when(m.at, now)} 的组会</b><SourceTag source={m.source} /></div>
          {m.changes.filter(c => c.kind === '改变' || c.kind === '矛盾').map(c => (
            <div key={c.now.id} className={c.settled ? 'plan-item' : 'plan-item red-mark'}>
              <b>导师的要求{c.kind === '矛盾' ? '前后矛盾' : '变了'}</b>
              <span className="muted">以前：{c.before?.text}</span>
              <span>这次：{c.now.text}</span>
              {c.settled ? <span className="muted">已确认按这次的要求做</span>
                : <button className="ghost" onClick={() => patch(m.id, x => ({ ...x, changes: x.changes.map(y => y.now.id === c.now.id ? { ...y, settled: true } : y) }))}>双方确认按这次的来</button>}
            </div>
          ))}
          {(['学生', '导师'] as const).map(who => (
            <div key={who}>
              <b>{who === '学生' ? '学生要做' : '导师答应的'}</b>
              {m.todos.filter(t => t.who === who).map(t => (
                <label key={t.id} className="item">
                  <span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.what}{t.due ? `（${when(t.due, now).split(' ')[0]}前）` : ''}</span>
                  <input type="checkbox" checked={t.done} onChange={() => patch(m.id, x => ({ ...x, todos: x.todos.map(y => y.id === t.id ? { ...y, done: !y.done } : y) }))} />
                </label>
              ))}
              {!m.todos.some(t => t.who === who) && <p className="muted">没有</p>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** 组会前预演: the advisor's likely questions on one task; type an answer, see what it leaves out. */
function Rehearsal({ data }: ScreenProps) {
  const mine = data.tasks.filter(t => t.confirmed && t.student === data.me);
  const [taskId, setTaskId] = useState(mine[0]?.id ?? '');
  const [probes, setProbes] = useState<{ list: Probe[]; note: string } | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const task = mine.find(t => t.id === taskId);
  if (!mine.length) return null;
  async function start() {
    if (!task) return;
    const work = `${task.title}：${task.steps.filter(s => s.done).map(s => s.output).join('、') || task.ask}`;
    const r = await rehearse(work, buildMemory(data.meetings), data.meetings);
    setProbes({ list: r.value, note: r.note }); setAnswers({}); setNotes({});
  }
  async function judge(i: number) {
    const r = await feedback(probes!.list[i], answers[i] ?? '');
    setNotes({ ...notes, [i]: r.value });
  }
  return (
    <>
      <h1>组会前预演</h1>
      <div className="card">
        <div className="row">
          <select value={taskId} onChange={e => { setTaskId(e.target.value); setProbes(null); }}>{mine.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          <button className="primary" onClick={() => void start()}>导师可能会问什么</button>
        </div>
        {probes && <p className="muted" style={{ margin: 0 }}>{probes.note}</p>}
        {probes?.list.map((p, i) => (
          <div key={i} className="plan-item">
            <b>{p.question}</b>
            <span className="muted">{p.why}</span>
            <textarea rows={2} placeholder="先自己答一遍" value={answers[i] ?? ''} onChange={e => setAnswers({ ...answers, [i]: e.target.value })} />
            <button className="ghost" onClick={() => void judge(i)}>看看缺什么</button>
            {notes[i] && <span className="note">{notes[i]}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
