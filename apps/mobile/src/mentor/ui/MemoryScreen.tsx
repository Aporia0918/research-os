// 导师要求账: what this advisor has asked for across meetings (newest wording on top), and what they promised.
// Exporting the progress overview stays here as a small extra; it holds tasks and to-dos only.
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { useState } from 'react';
import { buildMemory } from '../memory';
import { advisorOwes, overviewHtml } from '../overview';
import { habits } from '../rehearse';
import { when, type ScreenProps } from './common';

export function MemoryScreen({ data, now }: ScreenProps) {
  const [msg, setMsg] = useState('');
  const memory = buildMemory(data.meetings);
  const usual = habits(data.meetings);
  const owes = advisorOwes(data.meetings);
  async function share() {
    if (!Capacitor.isNativePlatform()) { setMsg('电脑浏览器里不能分享，请在手机上试。'); return; }
    try {
      const path = 'mentor/overview.html';
      await Filesystem.writeFile({ path, data: overviewHtml(data.tasks, data.meetings, Date.now()), directory: Directory.Cache, recursive: true, encoding: 'utf8' as never });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ title: '本周进度', files: [uri] });
    } catch { setMsg('没有分享出去，可以再试一次。'); }
  }
  return (
    <>
      <h1>导师要求账</h1>
      <p className="muted">从每次组会里记下导师的要求。同一件事说了几次，只留最新的说法，以前的放在下面。</p>
      <div className="card">
        {memory.map(s => (
          <div key={s.now.id} className={s.state === '待确认' ? 'plan-item red-mark' : 'plan-item'}>
            <span>{s.now.text}</span>
            <span className="muted">{when(s.now.at, now).split(' ')[0]}{s.state === '待确认' ? ' · 和以前说的不一样，还没确认' : ''}</span>
            {s.before.map(b => <span key={b.id} className="muted" style={{ textDecoration: 'line-through' }}>{b.text}</span>)}
          </div>
        ))}
        {!memory.length && <p className="muted">还没有记下要求。去「组会」粘一次组会记录就有了。</p>}
      </div>
      {usual.length > 0 && <div className="card">
        <b>导师常问的</b>
        {usual.slice(0, 4).map(h => <span key={h.kind}>{h.kind}（{h.count} 次）：<span className="muted">{h.example}</span></span>)}
      </div>}
      <div className="card">
        <b>导师答应过、还没做的</b>
        {owes.map((o, i) => <span key={i}>{o.what}{o.due ? `（${when(o.due, now).split(' ')[0]}前）` : ''}</span>)}
        {!owes.length && <span className="muted">没有</span>}
      </div>
      <button className="ghost" onClick={() => void share()}>导出本周进度，发给导师</button>
      {msg && <p className="note">{msg}</p>}
    </>
  );
}
