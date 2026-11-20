// 「组会之后」 prototype: the existing Android shell and jelly look, with the undergraduate–advisor screens.
import { useEffect, useRef, useState } from 'react';
import { Backdrop } from '@jelly/Backdrop';
import { jellyPress } from '@jelly/spring';
import { followAppearance, loadAppearance, saveAppearance } from '../appearance';
import type { Appearance } from '@jelly/theme';
import { Icon, type IconName } from '../icons';
import { SettingsScreen } from '../screens/SettingsScreen';
import { preferencesKV } from '../storage/kv';
import { demoData } from './demo';
import { syncReminders } from './remind';
import { EMPTY, loadMentor, saveMentor, type MentorData } from './store';
import { MemoryScreen } from './ui/MemoryScreen';
import type { Update } from './ui/common';
import { MeetingScreen } from './ui/MeetingScreen';
import { TasksScreen } from './ui/TasksScreen';
import { TodayScreen } from './ui/TodayScreen';

type Tab = 'today' | 'tasks' | 'meeting' | 'memory' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: '今天', icon: 'log' }, { id: 'tasks', label: '新任务', icon: 'plan' },
  { id: 'meeting', label: '组会', icon: 'ask' }, { id: 'memory', label: '要求账', icon: 'ledger' },
  { id: 'settings', label: '设置', icon: 'settings' },
];
const PRESSABLE = 'button.primary, button.ghost, .tab, .chip';

export function MentorApp() {
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<MentorData | null>(null);
  const [now, setNow] = useState(Date.now());
  const loaded = useRef(false);
  useEffect(() => { void loadMentor().then(d => { setData(d); loaded.current = true; }); }, []);
  useEffect(() => { if (data && loaded.current) { void saveMentor(data); void syncReminders(data); } }, [data]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => jellyPress(PRESSABLE), []);
  const [look, setLook] = useState<Appearance>('light');
  useEffect(() => { void loadAppearance(preferencesKV).then(setLook); }, []);
  useEffect(() => followAppearance(look), [look]);
  useEffect(() => { document.title = '组会之后'; }, []);
  const update: Update = f => setData(d => f(d ?? EMPTY));
  if (!data) return <div className="app"><Backdrop /></div>;
  const empty = !data.tasks.length && !data.meetings.length;
  const props = { data, update, now };
  return (
    <div className="app">
      <Backdrop />
      <main className="screen">
        {empty && tab !== 'settings' && (
          <div className="card demo-banner">
            还没有数据。<button className="ghost" onClick={() => setData(demoData(Date.now()))}>载入示例数据看看</button>
          </div>
        )}
        {tab === 'today' && <TodayScreen {...props} />}
        {tab === 'tasks' && <TasksScreen {...props} />}
        {tab === 'meeting' && <MeetingScreen {...props} />}
        {tab === 'memory' && <MemoryScreen {...props} />}
        {tab === 'settings' && <>
          <div className="card">
            <b>我的名字</b>
            <input value={data.me} onChange={e => update(d => ({ ...d, me: e.target.value }))} />
            <button className="ghost" onClick={() => setData(demoData(Date.now()))}>重新载入示例数据（会覆盖现有数据）</button>
            <button className="ghost" onClick={() => setData(EMPTY)}>清空全部数据</button>
          </div>
          <SettingsScreen demo={false} onDemo={() => undefined} lang="zh" onLang={() => undefined} look={look}
            onLook={a => { setLook(a); void saveAppearance(preferencesKV, a); }} />
        </>}
      </main>
      <nav className="tabbar" role="tablist" aria-label="主导航">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            <span className="tab-icon"><Icon name={t.icon} size={22} /></span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
