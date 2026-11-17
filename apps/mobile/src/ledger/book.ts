// The one ledger on this phone, shared by the ledger screen and the trial switch in Settings.
import { Book } from './ledger';
import { preferencesKV } from '../storage/kv';

export const book = new Book(preferencesKV);
/** The user's own calendar day (local time), so a debt due tomorrow is not due at 8 in the morning in China. */
export const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Copy text for the user; falls back to a selected textarea where the clipboard API is refused. */
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back below */ }
  const t = document.createElement('textarea');
  t.value = text; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } finally { t.remove(); }
}
