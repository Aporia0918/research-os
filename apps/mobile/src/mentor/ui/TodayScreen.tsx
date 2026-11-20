// 今天: for each task, the one next step, when the plan puts it, and whether time is short. Ticking a step off asks
// how long it really took, which feeds the personal pace for the rest of the plan.
import { useState } from 'react';
import { helpMessage } from '../ai';
import { planTask } from '../schedule';
import type { Task } from '../types';
import { SourceTag, when, type ScreenProps } from './common';

export function TodayScreen({ data, update, now }: ScreenProps) {
  const mine = data.tasks.filter(t => t.confirmed && t.student === data.me && t.steps.some(s => !s.done)).sort((a, b) => a.due - b.due);
  return (
    <>
      <h1>今天做哪一步</h1>
      {!mine.length && <div className="card"><p>没有进行中的任务。导师布置的任务确认后会出现在这里。</p></div>}
      {mine.map(t => <NextStep key={t.id} task={t} data={data} update={update} now={now} />)}
    </>
  );
}

function NextStep({ task, data, update, now }: ScreenProps & { task: Task }) {
  const plan = planTask({ steps: task.steps, due: task.due, now, timetable: data.timetable });
  const step = task.steps.find(s => !s.done)!;
  const slot = plan.placed[0]?.pieces[0];
  const [actual, setActual] = useState(String(Math.round(step.minutes * plan.pace)));
  const [stuck, setStuck] = useState(false);
  const [words, setWords] = useState('');
  const [help, setHelp] = useState<{ text: string; note: string; source: 'model' | 'rules' } | null>(null);
  const done = task.steps.filter(s => s.done).length;
  function finish() {
    const minutes = Math.max(1, Number(actual) || step.minutes);
    update(d => ({ ...d, tasks: d.tasks.map(t => t.id !== task.id ? t : { ...t, steps: t.steps.map(s => s.id === step.id ? { ...s, done: true, doneAt: Date.now(), actualMinutes: minutes } : s) }) }));
  }
  async function draftHelp() {
    const r = await helpMessage(task.title, step.title, words);
    setHelp({ text: r.value, note: r.note, source: r.source });
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{task.title}</b><span className="muted">第 {done + 1}/{task.steps.length} 步 · {when(task.due, now)} 截止</span></div>
      <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{step.title}</p>
      <p className="muted" style={{ margin: 0 }}>交：{step.output} · 约 {Math.round(step.minutes * plan.pace)} 分钟{plan.pace !== 1 ? `（按你的速度 ×${plan.pace.toFixed(1)}）` : ''}</p>
      {slot && <p className="note" style={{ margin: 0 }}>安排在 {when(slot.start, now)}，会在这之前提醒你</p>}
      {plan.shortMinutes > 0 && <p className="alert" style={{ margin: 0 }}>按现在的空闲时间，会比截止晚大约 {Math.ceil(plan.shortMinutes / 60)} 小时。可以和导师商量，或在课表里补上空闲时间。</p>}
      {!plan.shortMinutes && plan.slackHours !== null && plan.slackHours < 24 && <p className="muted" style={{ margin: 0, color: 'var(--warn)' }}>时间比较紧：最晚 {when(plan.latestStart[step.id], now)} 必须开始。</p>}
      <div className="row">
        <label className="muted">实际用了 <input inputMode="numeric" value={actual} onChange={e => setActual(e.target.value)} style={{ width: 64 }} /> 分钟</label>
        <button className="primary" onClick={finish}>这步做完了</button>
        <button className="ghost" onClick={() => setStuck(!stuck)}>卡住了</button>
      </div>
      {stuck && (
        <div className="plan-item">
          <textarea rows={3} placeholder="用一句话说卡在哪、试过什么" value={words} onChange={e => setWords(e.target.value)} />
          <button className="ghost" onClick={() => void draftHelp()}>帮我写给导师的话</button>
          {help && <>
            <p className="muted">{help.note} <SourceTag source={help.source} /></p>
            <textarea rows={4} value={help.text} onChange={e => setHelp({ ...help, text: e.target.value })} />
            <button className="ghost" onClick={() => void navigator.clipboard?.writeText(help.text)}>复制，去聊天软件发</button>
          </>}
        </div>
      )}
    </div>
  );
}
