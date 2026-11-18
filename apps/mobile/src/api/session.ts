// The computer session from pairing. Kept in Keystore-backed secure storage like the model key and sent as a bearer
// header, so closing the app or restarting the phone never signs it out; only its expiry or a revoke on the computer
// (设置 → 设备) does, and then 设置 says to pair again. The token is never shown, logged or put in a backup.
import { loadComputerSettings } from '../settings';
import { preferencesKV, type KV } from '../storage/kv';
import { nativeSecretStore, preferencesMap, readSecret, writeSecret, type PlainMap, type SecretStore } from '../storage/secureKeyStore';
import { ResearchOsClient, type FetchLike } from './computer';

export const SESSION_KEY = 'computer.session.v1';
export interface Vault { store: SecretStore; plain: PlainMap }
const native: Vault = { store: nativeSecretStore, plain: preferencesMap };

export const loadSession = (v: Vault = native) => readSecret(SESSION_KEY, v.store, v.plain);
export const forgetSession = (v: Vault = native) => writeSecret(SESSION_KEY, '', v.store, v.plain);

/** Pair with the 8-character code and keep the session. A computer from before want_token keeps its cookie instead. */
export async function pairWith(url: string, code: string, v: Vault = native, f?: FetchLike): Promise<void> {
  const r = await new ResearchOsClient(url, f, 5000).pair(code);
  await writeSecret(SESSION_KEY, r.token ?? '', v.store, v.plain);
}

/** The paired computer as the screens use it, or null when computer features are off. */
export async function computerClient(kv: KV = preferencesKV, v: Vault = native, f?: FetchLike): Promise<ResearchOsClient | null> {
  const s = await loadComputerSettings(kv);
  return s.enabled ? new ResearchOsClient(s.url, f, 5000, await loadSession(v)) : null;
}
