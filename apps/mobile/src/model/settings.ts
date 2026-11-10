// Model settings live only on this phone (Capacitor Preferences = Android SharedPreferences, app-private).
// The KEY itself lives in Android Keystore-backed secure storage (storage/secureKeyStore),
// migrated out of Preferences once on first read after upgrading from v1.0.
// The key is never sent to the optional computer service and never logged.
import type { KV } from '../storage/kv';
import { nativeSecretStore, preferencesMap, readSecret, writeSecret } from '../storage/secureKeyStore';

export type KeyHeader = 'bearer' | 'x-api-key';
export interface ModelSettings { baseUrl: string; model: string; header: KeyHeader; timeoutMs: number }
export const MODEL_SETTINGS_KEY = 'model.settings.v1';
export const MODEL_KEY_KEY = 'model.apiKey.v1';
export const DEFAULT_MODEL_SETTINGS: ModelSettings = { baseUrl: '', model: '', header: 'bearer', timeoutMs: 8000 };

export async function loadModelSettings(kv: KV): Promise<ModelSettings> {
  try {
    const saved = JSON.parse((await kv.get(MODEL_SETTINGS_KEY)) ?? '{}') as Partial<ModelSettings>;
    return { ...DEFAULT_MODEL_SETTINGS, ...saved, timeoutMs: Math.min(8000, Math.max(1000, saved.timeoutMs ?? 8000)) };
  }
  catch { return { ...DEFAULT_MODEL_SETTINGS }; }
}
export async function saveModelSettings(kv: KV, s: ModelSettings): Promise<void> {
  await kv.set(MODEL_SETTINGS_KEY, JSON.stringify({ ...s, baseUrl: s.baseUrl.trim().replace(/\/+$/, ''), model: s.model.trim() }));
}
export async function loadKey(kv: KV): Promise<string> { void kv; return readSecret(MODEL_KEY_KEY, nativeSecretStore, preferencesMap); }
export async function saveKey(kv: KV, key: string): Promise<void> { void kv; await writeSecret(MODEL_KEY_KEY, key, nativeSecretStore, preferencesMap); }
export async function clearKey(kv: KV): Promise<void> { await saveKey(kv, ''); }
export async function hasKey(kv: KV): Promise<boolean> { return (await loadKey(kv)).length > 0; }
