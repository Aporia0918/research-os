import { tr, trObj, getLang, setLang, onLang, loadLang, saveLang, type Lang } from './i18n';
import { useEffect, useState } from 'react';
import { AskScreen } from './screens/AskScreen';
import { LedgerScreen } from './screens/LedgerScreen';
import { LogScreen } from './screens/LogScreen';
import { GuideScreen } from './screens/GuideScreen';
import { PlanScreen } from './screens/PlanScreen';
import { ExamScreen } from './screens/ExamScreen';
import { EnhancedScreen } from './screens/EnhancedScreen';
import { loadComputerSettings } from './settings';
import { SettingsScreen } from './screens/SettingsScreen';
import { preferencesKV } from './storage/kv';
import { loadDemo, saveDemo } from './demo/demo';
import { autoCheckUpdate } from './update/manifest';
import { LOCAL_VERSION_CODE, UPDATE_CHANNEL } from './update/version';

/** The startup update check waits until the first screen is on, then runs in the background. */
const STARTUP_CHECK_DELAY_MS = 1500;
type Tab = 'ledger' | 'ask' | 'log' | 'plan' | 'exam' | 'guide' | 'enhanced' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = trObj([
  { id: 'ledger', label: '账本', icon: '¥' }, { id: 'ask', label: '提问', icon: '?' }, { id: 'log', label: '记录', icon: '+' }, { id: 'plan', label: '计划', icon: '☰' },
  { id: 'exam', label: '零世界', icon: '◎' },
  { id: 'guide', label: '指导', icon: '✎' },
  { id: 'settings', label: '设置', icon: '⚙' },
]);

export function App() {
  const [tab, setTab] = useState<Tab>('ledger');
  const [demo, setDemo] = useState(false);
  useEffect(() => { void loadDemo(preferencesKV).then(setDemo); }, []);
  const [lang, setLangState] = useState<Lang>(getLang());
  useEffect(() => {
    const off = onLang(setLangState);
    void loadLang(preferencesKV).then(setLang);
    return off;
  }, []);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => { void loadComputerSettings(preferencesKV).then(s => setEnhanced(s.enabled)); }, [tab]);
  const [newVer, setNewVer] = useState<string | null>(null);
  useEffect(() => { // cold start: background check after first paint, 10 s limit, 12h throttle, never installs
    let live = true;
    const t = setTimeout(() => {
      void autoCheckUpdate(preferencesKV, Date.now(), LOCAL_VERSION_CODE, UPDATE_CHANNEL, (...a) => fetch(...a)).then(m => { if (live && m) setNewVer(m.versionName); });
    }, STARTUP_CHECK_DELAY_MS);
    return () => { live = false; clearTimeout(t); };
  }, []);
  const chooseLang = (l: Lang) => { setLang(l); void saveLang(preferencesKV, l); };
  const toggleDemo = (on: boolean) => { setDemo(on); void saveDemo(preferencesKV, on); };
  return (
    <div className="app" data-lang={lang}>
      {newVer && (
        <div className="card" role="note" data-testid="update-banner">
          {tr('发现新版本 {0}。到设置页点“检查更新”查看说明,确认后才会安装。', newVer)}
          <button className="ghost" onClick={() => { setNewVer(null); setTab('settings'); }}>{tr('去设置')}</button>
          <button className="ghost" onClick={() => setNewVer(null)}>{tr('以后再说')}</button>
        </div>
      )}
      <main className="screen">
        {tab === 'ledger' && <LedgerScreen />}
        {tab === 'ask' && <AskScreen demo={demo} />}
        {tab === 'log' && <LogScreen demo={demo} />}
        {tab === 'plan' && <PlanScreen demo={demo} />}
        {tab === 'exam' && <ExamScreen />}
        {tab === 'guide' && <GuideScreen demo={demo} />}
        {tab === 'enhanced' && enhanced && <EnhancedScreen />}
        {tab === 'settings' && <SettingsScreen demo={demo} onDemo={toggleDemo} lang={lang} onLang={chooseLang} onComputer={setEnhanced} />}
      </main>
      <nav className="tabbar" role="tablist" aria-label={tr('主导航')}>
        {[...TABS, ...(enhanced ? [{ id: 'enhanced' as Tab, label: tr('电脑增强'), icon: '+' }] : [])].map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
