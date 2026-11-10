import { Capacitor, registerPlugin } from '@capacitor/core';
import { UpdateError, fetchDownloader, type Downloader } from './manifest';

/** Native side: android/app/src/main/java/dev/paperlab/assistant/UpdateInstallerPlugin.java (未在真机验证). */
interface UpdateInstallerPlugin {
  download(o: { url: string; size: number; sha256: string }): Promise<{ ok: boolean; path?: string; code?: string }>;
  install(o: { path: string }): Promise<{ started: boolean }>;
  addListener(ev: 'downloadProgress', f: (e: { loaded: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>;
}
const Native = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');
export const isAndroid = () => Capacitor.getPlatform() === 'android';

export function platformDownloader(): Downloader {
  if (!isAndroid()) return fetchDownloader();
  return async (url, size, sha256, onProgress) => {
    const h = onProgress ? await Native.addListener('downloadProgress', e => onProgress(e.loaded, e.total)) : null;
    let r: Awaited<ReturnType<UpdateInstallerPlugin['download']>>;
    try { r = await Native.download({ url, size, sha256 }); } finally { await h?.remove(); }
    return r.ok && r.path ? { ok: true, path: r.path } : { ok: false, code: (r.code as never) ?? 'download_failed' };
  };
}
/** Only call after the user tapped confirm. Opens the system installer; never installs silently. */
export async function openInstaller(path: string): Promise<void> {
  if (!isAndroid()) throw new UpdateError('not_android');
  try { const r = await Native.install({ path }); if (!r.started) throw new Error('x'); }
  catch { throw new UpdateError('install_failed'); }
}
