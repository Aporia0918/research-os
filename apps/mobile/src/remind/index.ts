// Keeps the phone's reminders in step with the book: called on start and after every change to the ledger.
import { book } from '../ledger/book';
import { loadProfile } from '../me/profile';
import { preferencesKV } from '../storage/kv';
import { deadlineReminders, planReminders } from './plan';
import { GrowthBook } from '../ledger/growth';
import { schedule } from './native';

/** Local "YYYY-MM-DDTHH:MM": reminders are set by the clock on the user's wall, not UTC. */
export function localNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function refreshReminders(): Promise<void> {
  const p = await loadProfile(preferencesKV);
  if (!p?.remind) { await schedule([]); return; }
  const now = localNow();
  await schedule([...planReminders(await book.all(), p.slots, now), ...deadlineReminders((await new GrowthBook(preferencesKV).get()).deadlines, p.slots, now)]);
}
