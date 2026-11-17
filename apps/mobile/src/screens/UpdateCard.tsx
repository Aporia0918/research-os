import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { preferencesKV, type KV } from '../storage/kv';
import {
  DEFAULT_MANIFEST_URL, UpdateError, UPDATE_TIMEOUT_MS, decide, describeUpdateError, downloadVerified, fetchManifestFromSources,
  loadMirrorPrefix, loadSource, manualAllowed, percent, saveSource, sourceList,
  type Downloader, type Manifest,
} from '../update/manifest';
import { CURRENT, TEST_BUILD, TEST_RELEASE_PAGE } from '../update/version';
import { openInstaller, platformDownloader } from '../update/native';

export interface UpdateDeps {
  kv: KV; fetchFn: typeof fetch; downloader: () => Downloader; install: (path: string) => Promise<void>; now: () => number;
}
const defaults = (): UpdateDeps => ({ kv: preferencesKV, fetchFn: (...a) => fetch(...a), downloader: platformDownloader, install: openInstaller, now: Date.now });

/** A test build checks the 测试版 pre-release and its CDN copies only, so there is no address to type. */
export function UpdateCard({ deps, testBuild = TEST_BUILD, current = CURRENT }: { deps?: Partial<UpdateDeps>; testBuild?: boolean; current?: typeof CURRENT }) {
  return <UpdateChecker deps={deps} fixedSources={testBuild ? current.sources : null} current={current} />;
}

function UpdateChecker({ deps, fixedSources, current }: { deps?: Partial<UpdateDeps>; fixedSources: readonly string[] | null; current: typeof CURRENT }) {
  const d = { ...defaults(), ...deps };
  const [src, setSrc] = useState(fixedSources ? fixedSources[0] : DEFAULT_MANIFEST_URL);
  const [msg, setMsg] = useState('');
  const [offer, setOffer] = useState<{ m: Manifest; urgent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState<number | null>(null);   // seconds spent checking
  const [pct, setPct] = useState<number | null>(null);         // download percent
  const [manual, setManual] = useState<string[] | null>(null);  // addresses to download by hand after every mirror failed
  const [ready, setReady] = useState<string | null>(null);      // verified APK waiting for the install permission
  const lastManual = useRef(0);
  useEffect(() => { if (fixedSources === null) void loadSource(d.kv).then(setSrc); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    const now = d.now();
    if (!manualAllowed(lastManual.current, now)) { setMsg(tr('刚检查过,请 30 秒后再试。')); return; }
    lastManual.current = now; setOffer(null); setManual(null); setReady(null);
    if (!src.trim()) { setMsg(tr('未配置源:更新地址还没填,所以不检查更新。')); return; }
    setBusy(true); setMsg(tr('正在检查更新…')); setWaited(0);
    const started = Date.now();
    const tick = setInterval(() => setWaited(Math.min(UPDATE_TIMEOUT_MS / 1000, Math.floor((Date.now() - started) / 1000))), 500);
    try {
      if (fixedSources === null) await saveSource(d.kv, src);
      const prefix = await loadMirrorPrefix(d.kv);
      const { manifest } = await fetchManifestFromSources(fixedSources ?? sourceList(src), d.fetchFn, UPDATE_TIMEOUT_MS, { mirrorPrefix: prefix });
      const r = decide(manifest, current.code, current.channel);
      if (r.kind === 'update') { setOffer({ m: r.manifest, urgent: r.urgent }); setMsg(''); }
      else setMsg(r.kind === 'latest' ? tr('已是最新版本({0})。', current.name) : tr('更新源是别的渠道,已忽略。'));
    } catch (e) { setMsg(describeUpdateError(e)); } finally { clearInterval(tick); setWaited(null); setBusy(false); }
  }
  async function confirm() {
    if (!offer) return;
    setBusy(true); setMsg(tr('正在下载并校验安装包…')); setPct(0); setManual(null);
    let path: string;
    try {
      // sha256 is verified inside downloadVerified BEFORE any install prompt.
      path = (await downloadVerified(offer.m, d.downloader(), (loaded, total) => setPct(percent(loaded, total)))).path;
    } catch (e) {
      setPct(null); setMsg(describeUpdateError(e)); setBusy(false);
      if (e instanceof UpdateError && e.code === 'download_unreachable') setManual(manualLinks(offer.m, fixedSources !== null));
      return;
    }
    setPct(null); setBusy(false);
    await install(path);
  }
  /** Opens the system installer for a verified file. Without the install permission the file is kept for 继续安装. */
  async function install(path: string) {
    setBusy(true); setMsg(tr('校验通过,正在打开系统安装界面。请在系统界面里再确认一次。'));
    try { await d.install(path); setOffer(null); setReady(null); }
    catch (e) { setReady(path); setMsg(describeUpdateError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card" data-testid="update-card">
      <label>{tr('应用内更新(当前版本 {0})', current.name)}</label>
      {fixedSources ? <div className="muted">{tr('测试版：从仓库的测试版页面检查新版本，每次打开 App 也会自动看一眼。')}</div> : <input value={src} onChange={e => setSrc(e.target.value)} inputMode="url" autoCapitalize="off" placeholder={tr('更新地址(version.json),没填就是未配置源')} aria-label={tr('更新地址')} />}
      <button className="ghost" disabled={busy} onClick={check}>{tr('检查更新')}</button>
      {msg && <div className="muted" role="status" data-testid="update-msg">{msg}</div>}
      {waited !== null && <div className="muted" data-testid="update-check-progress">
        <progress max={UPDATE_TIMEOUT_MS / 1000} value={waited} />
        {tr('正在检查:已等 {0} 秒,最多等 {1} 秒', waited, UPDATE_TIMEOUT_MS / 1000)}
      </div>}
      {pct !== null && <div className="muted" data-testid="update-download-progress">
        <progress max={100} value={pct} />
        {tr('正在下载:{0}%', pct)}
      </div>}
      {offer && (
        <div role="dialog" aria-label={tr('发现新版本')} data-testid="update-dialog">
          <strong>{tr('发现新版本 {0}', offer.m.versionName)}</strong>
          {offer.urgent && <div className="verdict warn">{tr('建议尽快更新:你的版本太旧了。')}</div>}
          <div className="muted">{tr('大小 {0} MB · 发布于 {1}', (offer.m.size / 1048576).toFixed(1), offer.m.publishedAt)}</div>
          <pre className="prewrap">{offer.m.releaseNotes}</pre>
          {ready
            ? <button className="primary" disabled={busy} onClick={() => install(ready)}>{tr('继续安装')}</button>
            : <button className="primary" disabled={busy} onClick={confirm}>{tr('下载并安装')}</button>}
          <button className="ghost" disabled={busy} onClick={() => { setOffer(null); setReady(null); setManual(null); }}>{tr('以后再说')}</button>
          {manual && <div className="muted" data-testid="update-manual">
            {tr('手动下载（长按复制，用浏览器打开）：')}
            {manual.map(u => <div key={u} className="prewrap" style={{ userSelect: 'text', wordBreak: 'break-all' }}>{u}</div>)}
          </div>}
        </div>
      )}
    </div>
  );
}

/** Every mirror of this version (the app tried them all), plus the test release page that opens in any browser. */
function manualLinks(m: Manifest, testBuild: boolean): string[] {
  return [...m.apk.map(x => x.url), ...(testBuild ? [TEST_RELEASE_PAGE] : [])];
}
