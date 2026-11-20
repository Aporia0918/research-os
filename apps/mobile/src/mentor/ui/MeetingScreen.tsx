// 组会: paste the notes (or the transcript), get both sides' to-dos and any change in the advisor's requirements.
import { useState } from 'react';
import { newId } from '../../local/store';
import { readMeeting } from '../ai';
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
