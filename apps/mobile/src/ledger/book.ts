// The one ledger on this phone, shared by the ledger screen and the trial switch in Settings.
import { Book } from './ledger';
import { preferencesKV } from '../storage/kv';

export const book = new Book(preferencesKV);
export const today = (): string => new Date().toISOString().slice(0, 10);

/** Copy text for the user; falls back to a selected textarea where the clipboard API is refused. */
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back below */ }
  const t = document.createElement('textarea');
  t.value = text; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } finally { t.remove(); }
}
