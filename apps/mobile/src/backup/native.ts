import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { CURRENT } from '../update/version';
import { autoDue, autoPrune, backupName, makeBackup, readBackup, restoreBackup, type Backup, type Store } from './backup';

export const prefsStore: Store = {
  async keys() { return (await Preferences.keys()).keys; },
  async get(key) { return (await Preferences.get({ key })).value; },
  async set(key, value) { await Preferences.set({ key, value }); },
};

const AUTO_DIR = 'backups';
const AUTO_LAST = 'backup.autoLast.v1';

/** Write text to a file and open the share sheet so the user can keep or send it anywhere; off the phone it is copied. */
export async function shareFile(name: string, text: string, title: string): Promise<'shared' | 'copied'> {
  if (!Capacitor.isNativePlatform()) { await navigator.clipboard?.writeText(text); return 'copied'; }
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title, files: [uri] });
  return 'shared';
}

/** The backup as a file through the share sheet. */
export async function shareBackup(title: string): Promise<'shared' | 'copied'> {
  return shareFile(backupName(), JSON.stringify(await makeBackup(prefsStore, CURRENT.name)), title);
}

/** Let the user pick a backup file; returns it parsed, or null if they cancelled. */
export async function pickBackup(): Promise<Backup | null> {
  const r = await FilePicker.pickFiles({ types: ['application/json', 'text/plain'], limit: 1, readData: true });
  const f = r.files[0];
  if (!f?.data) return null;
  const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
  return readBackup(new TextDecoder().decode(bytes));
}

export async function applyBackup(b: Backup): Promise<number> { return restoreBackup(prefsStore, b); }

/** Once a day, keep a private snapshot in app storage; the last few are kept. Never throws. */
export async function autoBackup(nowMs = Date.now()): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const last = Number((await Preferences.get({ key: AUTO_LAST })).value) || null;
    if (!autoDue(last, nowMs)) return;
    const stamp = new Date(nowMs).toISOString().slice(0, 19).replace(/:/g, '-');
    const text = JSON.stringify(await makeBackup(prefsStore, CURRENT.name, new Date(nowMs)));
    await Filesystem.writeFile({ path: `${AUTO_DIR}/auto-${stamp}.json`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await Preferences.set({ key: AUTO_LAST, value: String(nowMs) });
    const names = (await Filesystem.readdir({ path: AUTO_DIR, directory: Directory.Data })).files.map(f => f.name);
    for (const n of autoPrune(names)) await Filesystem.deleteFile({ path: `${AUTO_DIR}/${n}`, directory: Directory.Data });
  } catch { /* a failed snapshot must never stop the app */ }
}

/** The automatic snapshots on this phone, newest first. */
export async function autoSnapshots(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const names = (await Filesystem.readdir({ path: AUTO_DIR, directory: Directory.Data })).files.map(f => f.name);
    return names.filter(n => n.startsWith('auto-')).sort().reverse();
  } catch { return []; }
}

export async function readSnapshot(name: string): Promise<Backup> {
  const r = await Filesystem.readFile({ path: `${AUTO_DIR}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return readBackup(String(r.data));
}
