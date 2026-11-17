/**
 * 备份与恢复: everything the app keeps in Preferences, as one JSON file the user holds.
 * Secrets never go in (model keys live in the secure store; legacy copies are filtered here),
 * and neither do device-only settings such as the computer address or update checks.
 */
export interface Store {
  keys(): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const BACKUP_APP = 'researchos';
export const BACKUP_FORMAT = 1;
const SKIP = /apikey|secure|secret|token|password|^settings\.computer|^update\.|^backup\./i;

export interface Backup { app: string; format: number; createdAt: string; version: string; data: Record<string, string> }

export function keepKey(key: string): boolean { return !SKIP.test(key); }

export async function makeBackup(store: Store, version: string, now = new Date()): Promise<Backup> {
  const data: Record<string, string> = {};
  for (const k of (await store.keys()).filter(keepKey).sort()) {
    const v = await store.get(k);
    if (v !== null) data[k] = v;
  }
  return { app: BACKUP_APP, format: BACKUP_FORMAT, createdAt: now.toISOString(), version, data };
}

export class BackupError extends Error {}

/** Parse and check a backup file; throws BackupError with a user-facing reason. */
export function readBackup(text: string): Backup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError('这不是备份文件'); }
  const b = raw as Partial<Backup> | null;
  if (!b || b.app !== BACKUP_APP || typeof b.data !== 'object' || b.data === null) throw new BackupError('这不是备份文件');
  if (typeof b.format !== 'number' || b.format > BACKUP_FORMAT) throw new BackupError('备份来自更新的版本，请先更新应用');
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.data)) if (typeof v === 'string' && keepKey(k)) data[k] = v;
  return { app: BACKUP_APP, format: b.format, createdAt: String(b.createdAt ?? ''), version: String(b.version ?? ''), data };
}

/** Write a backup back; keys the backup lacks are left as they are. Returns how many keys were written. */
export async function restoreBackup(store: Store, b: Backup): Promise<number> {
  const entries = Object.entries(b.data);
  for (const [k, v] of entries) await store.set(k, v);
  return entries.length;
}

/** How many ledger entries a backup holds, so the user sees what they are about to restore. */
export function entryCount(b: Backup): number {
  const raw = b.data['mindledger.v1'];
  if (!raw) return 0;
  try { const v = JSON.parse(raw) as unknown; return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

export function backupName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `researchos-backup-${d}.json`;
}

/** Automatic snapshots: one a day at most, newest kept. */
export const AUTO_EVERY_MS = 24 * 3600 * 1000;
export const AUTO_KEEP = 5;
export function autoDue(lastMs: number | null, nowMs: number): boolean { return lastMs === null || nowMs - lastMs >= AUTO_EVERY_MS; }
export function autoPrune(names: string[]): string[] {
  const auto = names.filter(n => /^auto-\d{4}-\d{2}-\d{2}T[\d-]+\.json$/.test(n)).sort();
  return auto.slice(0, Math.max(0, auto.length - AUTO_KEEP));
}
