import { setAppearance, type Appearance } from '@jelly/theme';
import type { KV } from './storage/kv';

export const APPEARANCE_KEY = 'look.appearance.v1';

/** Light unless the user picked otherwise: the light jelly is the product's own look. */
export async function loadAppearance(kv: KV): Promise<Appearance> {
  const v = await kv.get(APPEARANCE_KEY);
  return v === 'dark' || v === 'system' ? v : 'light';
}
export async function saveAppearance(kv: KV, a: Appearance): Promise<void> { await kv.set(APPEARANCE_KEY, a); }

/** Apply the look now and, for 跟随系统, again whenever the phone switches; returns the cleanup. */
export function followAppearance(a: Appearance): () => void {
  setAppearance(a);
  if (a !== 'system' || typeof matchMedia !== 'function') return () => {};
  const q = matchMedia('(prefers-color-scheme: dark)');
  const on = () => setAppearance('system');
  q.addEventListener?.('change', on);
  return () => q.removeEventListener?.('change', on);
}
