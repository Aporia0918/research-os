// 导师: the overview the advisor sees, one row per student, exported as a page the student sends in any chat app.
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { useState } from 'react';
import { advisorOwes, overviewHtml, rows } from '../overview';
import { when, type ScreenProps } from './common';

export function AdvisorScreen({ data, now }: ScreenProps) {
  const [msg, setMsg] = useState('');
  const owes = advisorOwes(data.meetings);
  async function share() {
    const html = overviewHtml(data.tasks, data.meetings, Date.now());
    if (!Capacitor.isNativePlatform()) { setMsg('电脑浏览器里不能分享，请在手机上试。'); return; }
    try {
      const path = 'mentor/overview.html';
      await Filesystem.writeFile({ path, data: html, directory: Directory.Cache, recursive: true, encoding: 'utf8' as never });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ title: '本周进度总览', files: [uri] });
    } catch { setMsg('没有分享出去，可以再试一次。'); }
  }
  return (
    <>
      <h1>导师看到的</h1>
      <div className="card">
        {rows(data.tasks, now).map(r => (
          <div key={r.student} className="plan-item">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{r.student}</b><span className="muted">{r.doneSteps}/{r.totalSteps} 步</span></div>
            <span>{r.current}</span>
            {r.overdue > 0 && <span className="red-tag">{r.overdue} 个任务超期</span>}
          </div>
        ))}
        {!data.tasks.some(t => t.confirmed) && <p className="muted">还没有确认过的任务。</p>}
      </div>
      <div className="card">
        <b>导师答应过、还没做的</b>
        {owes.map((o, i) => <span key={i}>{o.what}{o.due ? `（${when(o.due, now).split(' ')[0]}前）` : ''}</span>)}
        {!owes.length && <span className="muted">没有</span>}
      </div>
      <button className="primary big-button" onClick={() => void share()}>导出总览发给导师</button>
      {msg && <p className="note">{msg}</p>}
      <p className="muted">只包含任务和待办，没有在线时长、位置这类信息。</p>
    </>
  );
}
