import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { preferencesKV, type KV } from '../storage/kv';
import {
  DEFAULT_MANIFEST_URL, UPDATE_TIMEOUT_MS, decide, describeUpdateError, downloadVerified, fetchManifestFromSources,
  loadMirrorPrefix, loadSource, manualAllowed, percent, saveSource, sourceList,
  type Downloader, type Manifest,
} from '../update/manifest';
import { LOCAL_VERSION_CODE, LOCAL_VERSION_NAME, UPDATE_CHANNEL } from '../update/version';
import { openInstaller, platformDownloader } from '../update/native';

export interface UpdateDeps {
  kv: KV; fetchFn: typeof fetch; downloader: () => Downloader; install: (path: string) => Promise<void>; now: () => number;
}
const defaults = (): UpdateDeps => ({ kv: preferencesKV, fetchFn: (...a) => fetch(...a), downloader: platformDownloader, install: openInstaller, now: Date.now });

export function UpdateCard({ deps }: { deps?: Partial<UpdateDeps> }) {
  const d = { ...defaults(), ...deps };
  const [src, setSrc] = useState(DEFAULT_MANIFEST_URL);
  const [msg, setMsg] = useState('');
  const [offer, setOffer] = useState<{ m: Manifest; urgent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState<number | null>(null);   // seconds spent checking
  const [pct, setPct] = useState<number | null>(null);         // download percent
  const lastManual = useRef(0);
  useEffect(() => { void loadSource(d.kv).then(setSrc); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    const now = d.now();
    if (!manualAllowed(lastManual.current, now)) { setMsg(tr('刚检查过,请 30 秒后再试。')); return; }
    lastManual.current = now; setOffer(null);
    if (!src.trim()) { setMsg(tr('未配置源:更新地址还没填,所以不检查更新。')); return; }
    setBusy(true); setMsg(tr('正在检查更新…')); setWaited(0);
    const started = Date.now();
    const tick = setInterval(() => setWaited(Math.min(UPDATE_TIMEOUT_MS / 1000, Math.floor((Date.now() - started) / 1000))), 500);
    try {
      await saveSource(d.kv, src);
      const prefix = await loadMirrorPrefix(d.kv);
      const { manifest } = await fetchManifestFromSources(sourceList(src), d.fetchFn, UPDATE_TIMEOUT_MS, { mirrorPrefix: prefix });
      const r = decide(manifest, LOCAL_VERSION_CODE, UPDATE_CHANNEL);
      if (r.kind === 'update') { setOffer({ m: r.manifest, urgent: r.urgent }); setMsg(''); }
      else setMsg(r.kind === 'latest' ? tr('已是最新版本({0})。', LOCAL_VERSION_NAME) : tr('更新源是别的渠道,已忽略。'));
    } catch (e) { setMsg(describeUpdateError(e)); } finally { clearInterval(tick); setWaited(null); setBusy(false); }
  }
  async function confirm() {
    if (!offer) return;
    setBusy(true); setMsg(tr('正在下载并校验安装包…')); setPct(0);
    try {
      // sha256 is verified inside downloadVerified BEFORE any install prompt.
      const { path } = await downloadVerified(offer.m, d.downloader(), (loaded, total) => setPct(percent(loaded, total)));
      setPct(null);
      setMsg(tr('校验通过,正在打开系统安装界面。请在系统界面里再确认一次。'));
      await d.install(path);
      setOffer(null);
    } catch (e) { setPct(null); setMsg(describeUpdateError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card" data-testid="update-card">
      <label>{tr('应用内更新(当前版本 {0})', LOCAL_VERSION_NAME)}</label>
      <input value={src} onChange={e => setSrc(e.target.value)} inputMode="url" autoCapitalize="off" placeholder={tr('更新地址(version.json),没填就是未配置源')} aria-label={tr('更新地址')} />
      <button className="ghost" disabled={busy} onClick={check}>{tr('检查更新')}</button>
      {msg && <div className="muted" role="status" data-testid="update-msg">{msg}</div>}
      {waited !== null && <div className="muted" data-testid="update-check-progress">
        <progress max={UPDATE_TIMEOUT_MS / 1000} value={waited} style={{ width: '100%' }} />
        {tr('正在检查:已等 {0} 秒,最多等 {1} 秒', waited, UPDATE_TIMEOUT_MS / 1000)}
      </div>}
      {pct !== null && <div className="muted" data-testid="update-download-progress">
        <progress max={100} value={pct} style={{ width: '100%' }} />
        {tr('正在下载:{0}%', pct)}
      </div>}
      {offer && (
        <div role="dialog" aria-label={tr('发现新版本')} data-testid="update-dialog">
          <strong>{tr('发现新版本 {0}', offer.m.versionName)}</strong>
          {offer.urgent && <div className="verdict warn">{tr('建议尽快更新:你的版本太旧了。')}</div>}
          <div className="muted">{tr('大小 {0} MB · 发布于 {1}', (offer.m.size / 1048576).toFixed(1), offer.m.publishedAt)}</div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{offer.m.releaseNotes}</pre>
          <button className="primary" disabled={busy} onClick={confirm}>{tr('下载并安装')}</button>
          <button className="ghost" disabled={busy} onClick={() => setOffer(null)}>{tr('以后再说')}</button>
        </div>
      )}
    </div>
  );
}
