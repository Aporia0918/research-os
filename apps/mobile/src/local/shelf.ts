// 书架: the last few papers imported on this phone, as text pages only, so 查重提醒 and 综述矛盾点 can read more than one.
// The newest import is also the "current paper" (paperStore.ts); the shelf never leaves the phone.
import type { KV } from '../storage/kv';
import type { Source } from '../rules/recall';

export const SHELF_KEY = 'paper.shelf.v1';
export const SHELF_MAX = 5;
export interface Shelved extends Source { versionId: string }

export async function loadShelf(kv: KV): Promise<Shelved[]> {
  try { const s = JSON.parse((await kv.get(SHELF_KEY)) ?? '[]') as Shelved[]; return Array.isArray(s) ? s.filter(p => p.versionId && Array.isArray(p.pages)) : []; }
  catch { return []; }
}
/** Newest first; the same paper imported again moves to the front; past SHELF_MAX the oldest goes. */
export async function shelve(kv: KV, p: Shelved): Promise<void> {
  const rest = (await loadShelf(kv)).filter(x => x.versionId !== p.versionId);
  await kv.set(SHELF_KEY, JSON.stringify([{ versionId: p.versionId, name: p.name, pages: p.pages }, ...rest].slice(0, SHELF_MAX)));
}
export async function unshelve(kv: KV, versionId: string): Promise<void> {
  await kv.set(SHELF_KEY, JSON.stringify((await loadShelf(kv)).filter(x => x.versionId !== versionId)));
}
