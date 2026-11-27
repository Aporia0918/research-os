import { tr, trObj, getLang, setLang, onLang, loadLang, saveLang, type Lang } from './i18n';
import { useEffect, useState } from 'react';
import { LedgerScreen } from './screens/LedgerScreen';
import { XiweiScreen } from './screens/XiweiScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { preferencesKV } from './storage/kv';
import { autoBackup } from './backup/native';
import { followAppearance, loadAppearance, saveAppearance } from './appearance';
import type { Appearance } from '@jelly/theme';
import { autoCheckUpdate } from './update/manifest';
import { CURRENT, TEST_BUILD } from './update/version';
import { Icon, type IconName } from './icons';
import { Backdrop } from '@jelly/Backdrop';
import { jellyPress } from '@jelly/spring';
import { Welcome } from './screens/Welcome';
import { loadProfile, saveProfile, type Profile } from './me/profile';
import { onShared } from './me/shareIn';
import { onTap } from './remind/native';
import { refreshReminders } from './remind';
import { book, today } from './ledger/book';
import type { LedgerIntent } from './screens/LedgerScreen';
import { markReady } from './perf/timing';

/** The startup update check waits until the first screen is on, then runs in the background. */
const STARTUP_CHECK_DELAY_MS = 1500;
/** Everything a finger presses on the real pages squashes and springs back. */
const PRESSABLE = 'button.primary, button.ghost, .orb-button, .tab, .alert, .seg > button, .course-row, .chip';
/** The main line first: 析微 (one condition changed, answered without the AI), then repay and read the report (账本). */
type Tab = 'xiwei' | 'ledger' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = trObj([
  { id: 'xiwei', label: '析微', icon: 'xiwei' }, { id: 'ledger', label: '账本', icon: 'ledger' }, { id: 'settings', label: '设置', icon: 'settings' },
]);

export function App() {
  const [tab, setTab] = useState<Tab>('xiwei');
  /** undefined while loading; null = first open, show the welcome. */
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => { void loadProfile(preferencesKV).then(setProfile); }, []);
  /** Text shared in from another app opens in 析微 (只记一笔 hands it to the ledger); a tapped reminder opens the ledger. */
  const [intent, setIntent] = useState<LedgerIntent | null>(null);
  const [shared, setShared] = useState<{ text: string; at: number } | null>(null);
  const toLedger = (text: string) => { setTab('ledger'); setIntent({ kind: 'share', text, at: Date.now() }); };
  useEffect(() => {
    const offShare = onShared(text => { setTab('xiwei'); setShared({ text, at: Date.now() }); });
    const offTap = onTap(async t => {
      if (t.action === 'open') { setTab('ledger'); setIntent({ kind: 'due', entryId: t.entryId, at: Date.now() }); return; }
      await (t.action === 'later' ? book.snooze(t.entryId, today()) : book.drop(t.entryId, today()));
      await refreshReminders();
    });
    return () => { offShare(); offTap(); };
  }, []);
  async function welcomed(p: Profile, board: '学习' | '科研') {
    await saveProfile(preferencesKV, p);
    await preferencesKV.set('mindledger.board.v1', board);
    setProfile(p); void refreshReminders();
  }
  useEffect(() => jellyPress(PRESSABLE), []);
  useEffect(() => { if (profile !== undefined) requestAnimationFrame(() => markReady()); }, [profile]); // first screen painted
  useEffect(() => { const t = setTimeout(() => void autoBackup(), 3000); return () => clearTimeout(t); }, []); // daily private snapshot, after first paint
  const [lang, setLangState] = useState<Lang>(getLang());
  useEffect(() => {
    const off = onLang(setLangState);
    void loadLang(preferencesKV).then(setLang);
    return off;
  }, []);
  const [look, setLook] = useState<Appearance>('light');
  useEffect(() => { void loadAppearance(preferencesKV).then(setLook); }, []);
  useEffect(() => followAppearance(look), [look]);
  const chooseLook = (a: Appearance) => { setLook(a); void saveAppearance(preferencesKV, a); };
  const [newVer, setNewVer] = useState<string | null>(null);
  useEffect(() => { // cold start: background check after first paint, 10 s limit, 12h throttle, never installs
    let live = true;
    const t = setTimeout(() => {
      // A test build looks at every start: new test builds come often and the check is one small file.
      void autoCheckUpdate(preferencesKV, Date.now(), CURRENT.code, CURRENT.channel, (...a) => fetch(...a), TEST_BUILD ? { sources: CURRENT.sources, everyStart: true } : {}).then(m => { if (live && m) setNewVer(m.versionName); });
    }, STARTUP_CHECK_DELAY_MS);
    return () => { live = false; clearTimeout(t); };
  }, []);
  const chooseLang = (l: Lang) => { setLang(l); void saveLang(preferencesKV, l); };
  if (profile === null) return <div className="app" data-lang={lang}><Backdrop /><main className="screen"><Welcome onDone={(p, b) => void welcomed(p, b)} /></main></div>;
  return (
    <div className="app" data-lang={lang}>
      <Backdrop />
      {newVer && (
        <div className="card" role="note" data-testid="update-banner">
          {tr('发现新版本 {0}。到设置页点“检查更新”查看说明,确认后才会安装。', newVer)}
          <button className="ghost" onClick={() => { setNewVer(null); setTab('settings'); }}>{tr('去设置')}</button>
          <button className="ghost" onClick={() => setNewVer(null)}>{tr('以后再说')}</button>
        </div>
      )}
      <main className="screen">
        {tab === 'xiwei' && <XiweiScreen shared={shared} onLedger={toLedger} />}
        {tab === 'ledger' && profile !== undefined && <LedgerScreen intent={intent} />}
        {tab === 'settings' && <SettingsScreen lang={lang} onLang={chooseLang} look={look} onLook={chooseLook} />}
      </main>
      <nav className="tabbar" role="tablist" aria-label={tr('主导航')}>
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => setTab(t.id)}>
            <span className="tab-icon"><Icon name={t.icon} size={22} /></span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
