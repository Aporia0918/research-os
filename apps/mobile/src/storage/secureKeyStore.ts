// Model API key storage. The key lives in Android Keystore-backed secure storage
// (@aparajita/capacitor-secure-storage), NOT in plain SharedPreferences.
// One-time migration: a legacy key left in Preferences by v1.0 is moved into secure
// storage and then deleted (Preferences.remove) with a marker so it happens exactly once.
// The key value is never logged, never put in an error message, never written to a file.
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface PlainMap {
  get(key: string): Promise<{ value: string | null }>;
  remove(key: string): Promise<void>;
}
export const MIGRATION_SUFFIX = '.migrated.secure.v1';

export const nativeSecretStore: SecretStore = {
  async get(key) { return (await SecureStorage.getItem(key)) ?? null; },
  async set(key, value) { await SecureStorage.setItem(key, value); },
  async remove(key) { await SecureStorage.removeItem(key); },
};
export const preferencesMap: PlainMap = {
  async get(key) { return Preferences.get({ key }); },
  async remove(key) { await Preferences.remove({ key }); },
};

/** Read the key: secure store first, then a one-time migration out of Preferences. */
export async function readSecret(key: string, store: SecretStore, plain: PlainMap): Promise<string> {
  const secure = await store.get(key);
  if (secure) return secure;
  if ((await plain.get(key + MIGRATION_SUFFIX)).value === '1') return '';
  const legacy = (await plain.get(key)).value;
  if (legacy === null || legacy.trim() === '') {
    if (legacy !== null) await plain.remove(key);
    return '';
  }
  const value = legacy.trim();
  // Write to Keystore BEFORE deleting the legacy copy; if this throws, nothing is deleted.
  await store.set(key, value);
  await plain.remove(key);
  await Preferences.set({ key: key + MIGRATION_SUFFIX, value: '1' });
  return value;
}

export async function writeSecret(key: string, value: string, store: SecretStore, plain: PlainMap): Promise<void> {
  const trimmed = value.trim();
  if (trimmed === '') { await store.remove(key); await plain.remove(key); return; }
  await store.set(key, trimmed);
  await plain.remove(key);
}
