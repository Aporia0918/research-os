import { tr } from '../i18n';
import type { KV } from '../storage/kv';

/** Default GitHub Releases "latest" download directory (no trailing slash). Configurable via opts / mirror. */
export const DEFAULT_RELEASE_BASE =
  'https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download';
/** Default version.json URL. Address is configurable; leave empty in settings to disable. */
export const DEFAULT_MANIFEST_URL = `${DEFAULT_RELEASE_BASE}/version.json`;
/** Hard limit for one version.json request (connect + body). */
export const UPDATE_TIMEOUT_MS = 10000;
/**
 * Ordered update sources. Tried top to bottom; only enabled entries are used.
 * Only GitHub is enabled. Backup mirrors are proposed in phone-package/MIRROR-PLAN.md and stay
 * disabled (and empty) until the user approves one; nothing here may be switched on without that.
 */
export interface UpdateSource { id: string; url: string; enabled: boolean }
export const UPDATE_SOURCES: readonly UpdateSource[] = [
  { id: 'github', url: DEFAULT_MANIFEST_URL, enabled: true },
  { id: 'mirror-pending-approval', url: '', enabled: false },
];

/** version.json per UPDATE-MANIFEST-SPEC.md. Only versionCode is compared. */
export interface Mirror { url: string; priority: number }
export interface Manifest {
  versionName: string; versionCode: number; minSupportedVersionCode: number;
  /** APK file name only (no path). Client builds URL as `{base}/{asset}`. */
  asset?: string;
  apk: Mirror[]; sha256: string; size: number; releaseNotes: string; publishedAt: string; channel: string;
  signature?: { scheme?: string; keyId?: string };
}
export type UpdateCode = 'no_source' | 'bad_source' | 'offline' | 'timeout' | 'http' | 'bad_json' | 'bad_manifest'
  | 'size_mismatch' | 'sha_mismatch' | 'download_failed' | 'not_android' | 'install_failed';
export class UpdateError extends Error {
  constructor(public code: UpdateCode, public status = 0) { super(code); this.name = 'UpdateError'; }
}

export function describeUpdateError(e: unknown): string {
  const c = e instanceof UpdateError ? e.code : 'download_failed';
  const s = e instanceof UpdateError ? e.status : 0;
  switch (c) {
    case 'no_source': return tr('未配置更新源:请先在设置里填更新地址。');
    case 'bad_source': return tr('更新地址必须以 http:// 或 https:// 开头。');
    case 'offline':
    case 'timeout': return tr('暂时连不上更新服务器，稍后再试');
    case 'http': return tr('更新源出错(错误代码 {0})。', s);
    case 'bad_json': return tr('更新信息格式不对,看不懂,已停止更新。');
    case 'bad_manifest': return tr('更新信息缺少必要内容,已停止更新。');
    case 'size_mismatch': return tr('下载的安装包大小不对,已删除,没有安装。');
    case 'sha_mismatch': return tr('下载的安装包校验值(sha256)不一致,可能被改动或损坏,已删除,没有安装。');
    case 'not_android': return tr('只有在安卓手机上才能安装更新。');
    case 'install_failed': return tr('没能打开系统安装界面,请允许本应用“安装未知应用”后重试。');
    default: return tr('所有下载地址都失败了,没有安装。');
  }
}

const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
/** Asset is a single file name (no slash / backslash / ".."). */
export function isAssetName(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*\.apk$/i.test(v) && !v.includes('..');
}

/**
 * Optional domestic-mirror prefix (e.g. `https://ghproxy.example/`).
 * Empty → unchanged. Non-empty → `{prefix}/{originalUrl}` (ghproxy-style).
 */
export function withMirrorPrefix(url: string, prefix: string): string {
  const p = prefix.trim().replace(/\/+$/, '');
  if (!p) return url;
  if (!/^https?:\/\/\S+$/i.test(p)) throw new UpdateError('bad_source');
  return `${p}/${url}`;
}

/** Build an absolute APK (or version.json) URL under the release base, then apply mirror prefix. */
export function releaseUrl(
  fileName: string,
  opts: { base?: string; mirrorPrefix?: string } = {},
): string {
  if (!isAssetName(fileName) && fileName !== 'version.json') throw new UpdateError('bad_manifest');
  const base = (opts.base ?? DEFAULT_RELEASE_BASE).replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(base)) throw new UpdateError('bad_source');
  return withMirrorPrefix(`${base}/${fileName}`, opts.mirrorPrefix ?? '');
}

export type ResolveOpts = { base?: string; mirrorPrefix?: string };

/**
 * Ensure `apk[]` has absolute URLs. Prefer explicit `apk[]`; otherwise build from `asset` + base.
 * Mirror prefix is applied to every URL (for a future domestic mirror).
 */
export function materializeApks(m: Manifest, opts: ResolveOpts = {}): Manifest {
  const prefix = opts.mirrorPrefix ?? '';
  let apk: Mirror[];
  if (m.apk.length > 0) {
    apk = m.apk.map((x, i) => ({
      url: withMirrorPrefix(x.url, prefix),
      priority: x.priority ?? 1000 + i,
    }));
  } else if (m.asset) {
    apk = [{ url: releaseUrl(m.asset, { base: opts.base, mirrorPrefix: prefix }), priority: 10 }];
  } else {
    throw new UpdateError('bad_manifest');
  }
  apk = [...apk].sort((a, b) => a.priority - b.priority);
  return { ...m, apk };
}

export function parseManifest(text: string, opts: ResolveOpts = {}): Manifest {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new UpdateError('bad_json'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new UpdateError('bad_json');
  const o = j as Record<string, unknown>;
  const hasAsset = o.asset !== undefined && o.asset !== null && o.asset !== '';
  if (hasAsset && !isAssetName(o.asset)) throw new UpdateError('bad_manifest');
  const rawApk = Array.isArray(o.apk) ? o.apk : [];
  const apkOk = rawApk.length > 0 && rawApk.every(m => m && typeof m === 'object' && isUrl((m as Mirror).url)
    && ((m as Mirror).priority === undefined || typeof (m as Mirror).priority === 'number'));
  // Must have versionCode + sha256 + (asset name and/or apk mirrors).
  const ok = str(o.versionName) && int(o.versionCode) && int(o.minSupportedVersionCode) && int(o.size) && (o.size as number) > 0
    && typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) && typeof o.releaseNotes === 'string'
    && str(o.publishedAt) && str(o.channel)
    && (apkOk || hasAsset);
  if (!ok) throw new UpdateError('bad_manifest');
  const apk = apkOk
    ? (rawApk as Mirror[]).map((m, i) => ({ url: m.url, priority: m.priority ?? 1000 + i }))
    : [];
  const draft: Manifest = {
    versionName: o.versionName as string,
    versionCode: o.versionCode as number,
    minSupportedVersionCode: o.minSupportedVersionCode as number,
    asset: hasAsset ? (o.asset as string) : undefined,
    apk,
    sha256: o.sha256 as string,
    size: o.size as number,
    releaseNotes: o.releaseNotes as string,
    publishedAt: o.publishedAt as string,
    channel: o.channel as string,
    signature: o.signature && typeof o.signature === 'object' ? o.signature as Manifest['signature'] : undefined,
  };
  return materializeApks(draft, opts);
}

export type Decision =
  | { kind: 'latest' } | { kind: 'other_channel' }
  | { kind: 'update'; urgent: boolean; manifest: Manifest };
export function decide(m: Manifest, localCode: number, channel: string): Decision {
  if (m.channel !== channel) return { kind: 'other_channel' };
  if (m.versionCode > localCode) return { kind: 'update', urgent: localCode < m.minSupportedVersionCode, manifest: m };
  return { kind: 'latest' };
}

export function normalizeSource(url: string): string {
  const u = url.trim();
  if (!u) throw new UpdateError('no_source');
  if (!/^https?:\/\/\S+$/.test(u)) throw new UpdateError('bad_source');
  return u;
}

export async function fetchManifest(
  url: string,
  f: typeof fetch = fetch,
  timeoutMs = UPDATE_TIMEOUT_MS,
  opts: ResolveOpts = {},
): Promise<Manifest> {
  const u = withMirrorPrefix(normalizeSource(url), opts.mirrorPrefix ?? '');
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new UpdateError('timeout')); }, timeoutMs); });
  try {
    // No personal data: plain GET, no query, no key, no paper content.
    const res = await Promise.race([f(u, { method: 'GET', signal: ac.signal, cache: 'no-store' }), timeout]);
    if (!res.ok) throw new UpdateError('http', res.status);
    return parseManifest(await Promise.race([res.text(), timeout]), opts);
  } catch (e) {
    if (e instanceof UpdateError) throw e;
    throw new UpdateError('offline');
  } finally { clearTimeout(timer); }
}

/**
 * The URLs to try, in order. The default address means "use the built-in list" (enabled entries, top to bottom);
 * an address the user typed in replaces the list (it is their explicit choice, so nothing else is contacted).
 */
export function sourceList(userSource: string, sources: readonly UpdateSource[] = UPDATE_SOURCES): string[] {
  const u = userSource.trim();
  const builtIn = sources.filter(s => s.enabled && s.url).map(s => s.url);
  if (!u || u === DEFAULT_MANIFEST_URL) return builtIn;
  return [u];
}
/** Try each source in order, each with its own hard timeout; first valid version.json wins. */
export async function fetchManifestFromSources(
  urls: string[], f: typeof fetch = fetch, timeoutMs = UPDATE_TIMEOUT_MS, opts: ResolveOpts = {},
): Promise<{ manifest: Manifest; url: string }> {
  if (!urls.length) throw new UpdateError('no_source');
  let last: unknown = new UpdateError('offline');
  for (const url of urls) {
    try { return { manifest: await fetchManifest(url, f, timeoutMs, opts), url }; } catch (e) { last = e; }
  }
  throw last;
}

/** One mirror attempt: must check size then sha256 and delete the file on mismatch. */
export type MirrorResult = { ok: true; path: string } | { ok: false; code: UpdateCode };
export type Progress = (loaded: number, total: number) => void;
export type Downloader = (url: string, size: number, sha256: string, onProgress?: Progress) => Promise<MirrorResult>;
export function percent(loaded: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.floor(loaded * 100 / total))) : 0;
}

/** Try mirrors in priority order; first verified file wins. Never returns an unverified path. */
export async function downloadVerified(m: Manifest, dl: Downloader, onProgress?: Progress): Promise<{ path: string; url: string }> {
  let last: UpdateCode = 'download_failed';
  for (const mirror of m.apk) {
    let r: MirrorResult;
    try { r = await dl(mirror.url, m.size, m.sha256, onProgress); } catch { r = { ok: false, code: 'offline' }; }
    if (r.ok) return { path: r.path, url: mirror.url };
    last = r.code;
  }
  throw new UpdateError(last);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}

/** Pure-JS downloader (web preview + tests). Keeps verified bytes in memory only. */
export function fetchDownloader(f: typeof fetch = fetch, store = new Map<string, Uint8Array>()): Downloader {
  return async (url, size, sha, onProgress) => {
    let res: Response;
    try { res = await f(url); } catch { return { ok: false, code: 'offline' }; }
    if (!res.ok) return { ok: false, code: 'http' };
    let bytes: Uint8Array;
    const reader = res.body?.getReader?.();
    if (reader) {
      const parts: Uint8Array[] = []; let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); n += value.length; onProgress?.(n, size);
        if (n > size) return { ok: false, code: 'size_mismatch' };
      }
      bytes = new Uint8Array(n); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    } else { bytes = new Uint8Array(await res.arrayBuffer()); onProgress?.(bytes.length, size); }
    if (bytes.length !== size) return { ok: false, code: 'size_mismatch' };
    if ((await sha256Hex(bytes)) !== sha) return { ok: false, code: 'sha_mismatch' };
    const path = `mem:${store.size}`; store.set(path, bytes);
    return { ok: true, path };
  };
}

// ---- settings + throttle ----
const SOURCE_KEY = 'update.sourceUrl.v1';
const MIRROR_KEY = 'update.mirrorPrefix.v1';
const LAST_KEY = 'update.lastAutoCheck.v1';
export const AUTO_INTERVAL_MS = 12 * 3600 * 1000;
export const MANUAL_GUARD_MS = 30 * 1000;
/** Unset → default GitHub latest version.json. Explicit empty string disables updates. */
export async function loadSource(kv: KV): Promise<string> {
  const v = await kv.get(SOURCE_KEY);
  return v === null || v === undefined ? DEFAULT_MANIFEST_URL : v;
}
export async function saveSource(kv: KV, url: string): Promise<void> { await kv.set(SOURCE_KEY, url.trim()); }
export async function loadMirrorPrefix(kv: KV): Promise<string> { return (await kv.get(MIRROR_KEY)) ?? ''; }
export async function saveMirrorPrefix(kv: KV, prefix: string): Promise<void> { await kv.set(MIRROR_KEY, prefix.trim()); }
/** Auto check runs at most once per 12h (success or failure). Clock is injectable. */
export async function shouldAutoCheck(kv: KV, now: number): Promise<boolean> {
  const last = Number(await kv.get(LAST_KEY) ?? 0);
  return !(last > 0 && now - last < AUTO_INTERVAL_MS && now >= last);
}
export async function markAutoCheck(kv: KV, now: number): Promise<void> { await kv.set(LAST_KEY, String(now)); }
export function manualAllowed(lastManual: number, now: number): boolean { return lastManual === 0 || now - lastManual >= MANUAL_GUARD_MS; }

/**
 * Cold-start auto check. Silent when no source is configured or on any failure; throttled to 12h
 * (success or failure); never downloads or installs — it only reports that an update exists.
 */
export async function autoCheckUpdate(kv: KV, now: number, localCode: number, channel: string, f: typeof fetch = fetch): Promise<Manifest | null> {
  const src = await loadSource(kv);
  if (!src.trim()) return null;
  if (!(await shouldAutoCheck(kv, now))) return null;
  await markAutoCheck(kv, now);
  try {
    const prefix = await loadMirrorPrefix(kv);
    const { manifest } = await fetchManifestFromSources(sourceList(src), f, UPDATE_TIMEOUT_MS, { mirrorPrefix: prefix });
    const d = decide(manifest, localCode, channel);
    return d.kind === 'update' ? d.manifest : null;
  } catch { return null; }
}
