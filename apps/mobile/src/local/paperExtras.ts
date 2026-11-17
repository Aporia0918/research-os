// What 科研 keeps beside each paper, on this phone only: its code and data links (by paper name, the topic its debts
// are booked under) and its reference fields (by version, for GB/T 7714 export).
import type { KV } from '../storage/kv';
import type { PaperLink } from '../rules/paperLinks';
import type { Ref } from '../rules/gbt7714';

const LINKS_KEY = 'paper.links.v1';
const REFS_KEY = 'paper.refs.v1';

async function read<T>(kv: KV, key: string): Promise<Record<string, T>> {
  try { const v = JSON.parse((await kv.get(key)) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

export async function allLinks(kv: KV): Promise<Record<string, PaperLink[]>> { return read<PaperLink[]>(kv, LINKS_KEY); }
export async function linksFor(kv: KV, paper: string): Promise<PaperLink[]> { return (await allLinks(kv))[paper] ?? []; }
/** Replaces one paper's links; an empty list removes the paper's entry. */
export async function setLinks(kv: KV, paper: string, links: PaperLink[]): Promise<PaperLink[]> {
  const all = await allLinks(kv);
  const seen = new Set<string>();
  const keep = links.filter(l => !seen.has(l.url.toLowerCase()) && seen.add(l.url.toLowerCase()));
  if (keep.length) all[paper] = keep; else delete all[paper];
  await kv.set(LINKS_KEY, JSON.stringify(all));
  return keep;
}

export async function allRefs(kv: KV): Promise<Record<string, Ref>> { return read<Ref>(kv, REFS_KEY); }
export async function saveRef(kv: KV, versionId: string, r: Ref): Promise<void> {
  const all = await allRefs(kv); all[versionId] = r; await kv.set(REFS_KEY, JSON.stringify(all));
}
