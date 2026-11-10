import type { KV } from './storage/kv';
export const DEFAULT_PORT = 8443;
export const DEFAULT_COMPUTER_URL = `http://10.0.2.2:${DEFAULT_PORT}`;
export const COMPUTER_URL_KEY = 'settings.computerUrl.v1';
export const COMPUTER_ENABLED_KEY = 'settings.computerEnabled.v1';
export interface ComputerSettings { enabled: boolean; url: string }
/** Old addresses may remain in app-private storage, but cannot turn the enhancement on. */
export async function loadComputerSettings(kv: KV): Promise<ComputerSettings> {
  return { enabled: (await kv.get(COMPUTER_ENABLED_KEY)) === '1', url: (await kv.get(COMPUTER_URL_KEY)) ?? DEFAULT_COMPUTER_URL };
}
export async function saveComputerSettings(kv: KV, s: ComputerSettings): Promise<void> {
  await kv.set(COMPUTER_URL_KEY, s.url.trim().replace(/\/+$/, '')); await kv.set(COMPUTER_ENABLED_KEY, s.enabled ? '1' : '0');
}
