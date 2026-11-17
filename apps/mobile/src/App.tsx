import { tr, trObj, getLang, setLang, onLang, loadLang, saveLang, type Lang } from './i18n';
import { setLook } from './look';
import { useEffect, useState } from 'react';
import { AskScreen } from './screens/AskScreen';
import { LedgerScreen } from './screens/LedgerScreen';
import { ResearchScreen } from './screens/ResearchScreen';
import { EnhancedScreen } from './screens/EnhancedScreen';
import { loadComputerSettings } from './settings';
import { SettingsScreen } from './screens/SettingsScreen';
import { preferencesKV } from './storage/kv';
import { loadDemo, saveDemo } from './demo/demo';
import { autoCheckUpdate } from './update/manifest';
import { CURRENT, TEST_BUILD } from './update/version';
import { Icon, type IconName } from './icons';
import { JellyDemo } from './jelly/JellyDemo';

/** The startup update check waits until the first screen is on, then runs in the background. */
const STARTUP_CHECK_DELAY_MS = 1500;
/** One main line on the surface: borrow (提问), repay and read the report (账本). Research tools sit in one tab. */
type Tab = 'ledger' | 'ask' | 'research' | 'enhanced' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = trObj([
  { id: 'ledger', label: '账本', icon: 'ledger' }, { id: 'ask', label: '提问', icon: 'ask' },
  { id: 'research', label: '科研', icon: 'research' }, { id: 'settings', label: '设置', icon: 'settings' },
]);

export function App() {
  const [tab, setTab] = useState<Tab>('ledger');
  useEffect(() => { if (tab !== 'ledger') setLook('scifi'); }, [tab]);
  const [researchStart, setResearchStart] = useState<'exam' | null>(null);
  /** From the ledger home straight into 提问 or 科研 → 零世界. */
  const go = (to: 'ask' | 'exam') => { setResearchStart(to === 'exam' ? 'exam' : null); setTab(to === 'exam' ? 'research' : 'ask'); };
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
      // A test build looks at every start: new test builds come often and the check is one small file.
      void autoCheckUpdate(preferencesKV, Date.now(), CURRENT.code, CURRENT.channel, (...a) => fetch(...a), TEST_BUILD ? { source: CURRENT.source, everyStart: true } : {}).then(m => { if (live && m) setNewVer(m.versionName); });
    }, STARTUP_CHECK_DELAY_MS);
    return () => { live = false; clearTimeout(t); };
  }, []);
  /** Test builds open on the jelly demo page until the owner confirms the look; 设置 can open it again. */
  const [jelly, setJelly] = useState(TEST_BUILD);
  const chooseLang = (l: Lang) => { setLang(l); void saveLang(preferencesKV, l); };
  const toggleDemo = (on: boolean) => { setDemo(on); void saveDemo(preferencesKV, on); };
  if (jelly) return <JellyDemo onExit={() => setJelly(false)} />;
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
        {tab === 'ledger' && <LedgerScreen onGo={go} />}
        {tab === 'ask' && <AskScreen demo={demo} />}
        {tab === 'research' && <ResearchScreen demo={demo} start={researchStart} />}
        {tab === 'enhanced' && enhanced && <EnhancedScreen />}
        {tab === 'settings' && <SettingsScreen demo={demo} onDemo={toggleDemo} lang={lang} onLang={chooseLang} onComputer={setEnhanced} onJelly={() => setJelly(true)} />}
      </main>
      <nav className="tabbar" role="tablist" aria-label={tr('主导航')}>
        {[...TABS, ...(enhanced ? [{ id: 'enhanced' as Tab, label: tr('电脑增强'), icon: 'computer' as IconName }] : [])].map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => { setResearchStart(null); setTab(t.id); }}>
            <span className="tab-icon"><Icon name={t.icon} size={22} /></span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
