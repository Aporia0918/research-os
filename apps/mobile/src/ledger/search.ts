import type { Entry } from './ledger';

/** 搜索账本: every word must appear somewhere in the debt; red and still-owed debts come first, then newest. */
export interface Hit { entry: Entry; where: 'question' | 'ownIdea' | 'answer' | 'topic' | 'usedIn'; snippet: string }

const FIELDS: Hit['where'][] = ['question', 'ownIdea', 'answer', 'topic', 'usedIn'];
const norm = (s: string) => s.toLowerCase().normalize('NFKC');

export function searchEntries(es: Entry[], query: string, limit = 50): Hit[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const e of es) {
    if (e.dropped) continue;
    const text = FIELDS.map(f => norm(e[f] ?? '')).join('\n');
    if (!words.every(w => text.includes(w))) continue;
    const where = FIELDS.find(f => norm(e[f] ?? '').includes(words[0]))!;
    hits.push({ entry: e, where, snippet: around(e[where] ?? '', words[0]) });
  }
  const rank = (e: Entry) => (e.red ? 0 : e.dueOn ? 1 : 2);
  return hits.sort((a, b) => rank(a.entry) - rank(b.entry) || b.entry.createdOn.localeCompare(a.entry.createdOn)).slice(0, limit);
}

/** About 40 characters around the first match, so the user sees why it came up. */
export function around(text: string, word: string, span = 20): string {
  const i = norm(text).indexOf(word);
  if (i < 0) return text.slice(0, span * 2);
  const from = Math.max(0, i - span), to = Math.min(text.length, i + word.length + span);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}
