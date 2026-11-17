// Model settings live only on this phone (Capacitor Preferences = Android SharedPreferences, app-private).
// The KEY itself lives in Android Keystore-backed secure storage (storage/secureKeyStore),
// migrated out of Preferences once on first read after upgrading from v1.0.
// The key is never sent to the optional computer service and never logged.
import type { KV } from '../storage/kv';
import { nativeSecretStore, preferencesMap, readSecret, writeSecret } from '../storage/secureKeyStore';

export type KeyHeader = 'bearer' | 'x-api-key';
/** The jobs that may each use their own model through one key (OpenRouter routes them all). Empty = the main model. */
export type Job = 'grade' | 'photo';
export interface ModelSettings { baseUrl: string; model: string; header: KeyHeader; timeoutMs: number; jobs?: Partial<Record<Job, string>> }
export const MODEL_SETTINGS_KEY = 'model.settings.v1';
export const MODEL_KEY_KEY = 'model.apiKey.v1';
/** One key, every model: the app only needs OpenRouter's address to switch models by name. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Long enough for a real model to answer a question about a paper; the screen falls back to rule mode after it. */
export const MAX_TIMEOUT_MS = 30000;
export const DEFAULT_MODEL_SETTINGS: ModelSettings = { baseUrl: '', model: '', header: 'bearer', timeoutMs: 20000 };
export const clampTimeout = (ms: number | undefined): number => Math.min(MAX_TIMEOUT_MS, Math.max(1000, ms ?? DEFAULT_MODEL_SETTINGS.timeoutMs));

export async function loadModelSettings(kv: KV): Promise<ModelSettings> {
  try {
    const saved = JSON.parse((await kv.get(MODEL_SETTINGS_KEY)) ?? '{}') as Partial<ModelSettings>;
    return { ...DEFAULT_MODEL_SETTINGS, ...saved, timeoutMs: clampTimeout(saved.timeoutMs) };
  }
  catch { return { ...DEFAULT_MODEL_SETTINGS }; }
}
export async function saveModelSettings(kv: KV, s: ModelSettings): Promise<void> {
  const jobs = Object.fromEntries(Object.entries(s.jobs ?? {}).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v));
  await kv.set(MODEL_SETTINGS_KEY, JSON.stringify({ ...s, baseUrl: s.baseUrl.trim().replace(/\/+$/, ''), model: s.model.trim(), jobs }));
}
/** The settings one job runs with: its own model when one is set, the main model otherwise. */
export const forJob = (s: ModelSettings, job: Job): ModelSettings => ({ ...s, model: s.jobs?.[job]?.trim() || s.model });
export async function loadKey(kv: KV): Promise<string> { void kv; return readSecret(MODEL_KEY_KEY, nativeSecretStore, preferencesMap); }
export async function saveKey(kv: KV, key: string): Promise<void> { void kv; await writeSecret(MODEL_KEY_KEY, key, nativeSecretStore, preferencesMap); }
export async function clearKey(kv: KV): Promise<void> { await saveKey(kv, ''); }
export async function hasKey(kv: KV): Promise<boolean> { return (await loadKey(kv)).length > 0; }
