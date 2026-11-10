// Secure key storage: plugin is MOCKED, so no real key, no real Keystore, no device. 非真机.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_SUFFIX, readSecret, writeSecret, type PlainMap, type SecretStore } from '../src/storage/secureKeyStore';

const secure = new Map<string, string>();
const prefs = new Map<string, string>();
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    getItem: vi.fn(async (k: string) => secure.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { secure.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { secure.delete(k); }),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); }),
    remove: vi.fn(async ({ key }: { key: string }) => { prefs.delete(key); }),
  },
}));
import { nativeSecretStore, preferencesMap } from '../src/storage/secureKeyStore';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';
import { clearKey, hasKey, loadKey, saveKey } from '../src/model/settings';
import { memoryKV } from '../src/storage/kv';

const KEY = 'model.apiKey.v1';
// Deliberately NOT a real-looking credential; also used to prove no leakage into thrown objects.
const FAKE = 'test-fake-key-000';
function plain(): PlainMap { return preferencesMap; }
function store(): SecretStore { return nativeSecretStore; }
beforeEach(() => { secure.clear(); prefs.clear(); vi.clearAllMocks(); });

describe('Android Keystore-backed key storage (mocked plugin)', () => {
  it('save writes only to the secure store, never to Preferences', async () => {
    const kv = memoryKV();
    await saveKey(kv, `  ${FAKE} `);
    expect(secure.get(KEY)).toBe(FAKE);
    expect(prefs.has(KEY)).toBe(false);
    expect(await loadKey(kv)).toBe(FAKE);
    expect(await hasKey(kv)).toBe(true);
    await clearKey(kv);
    expect(secure.has(KEY)).toBe(false);
    expect(await hasKey(kv)).toBe(false);
  });
  it('a legacy Preferences key is migrated once and then deleted from Preferences', async () => {
    prefs.set(KEY, FAKE);
    expect(await readSecret(KEY, store(), plain())).toBe(FAKE);
    expect(secure.get(KEY)).toBe(FAKE);
    expect(prefs.has(KEY)).toBe(false);
    expect(prefs.get(KEY + MIGRATION_SUFFIX)).toBe('1');
    const legacyReads = vi.mocked(Preferences.get).mock.calls.length;
    expect(await readSecret(KEY, store(), plain())).toBe(FAKE);
    // marker present -> no second migration attempt, legacy key is gone from Preferences
    expect(vi.mocked(Preferences.get).mock.calls.length).toBe(legacyReads);
    expect(prefs.has(KEY)).toBe(false);
  });
  it('writeSecret with an empty value clears both stores', async () => {
    secure.set(KEY, FAKE); prefs.set(KEY, FAKE);
    await writeSecret(KEY, '', store(), plain());
    expect(secure.has(KEY)).toBe(false);
    expect(prefs.has(KEY)).toBe(false);
  });
  it('the marker alone (no legacy key, nothing in Keystore) reads as empty', async () => {
    prefs.set(KEY + MIGRATION_SUFFIX, '1');
    expect(await readSecret(KEY, store(), plain())).toBe('');
    expect(secure.has(KEY)).toBe(false);
  });
  it('if the Keystore write fails the legacy copy is NOT deleted', async () => {
    prefs.set(KEY, FAKE);
    vi.mocked(SecureStorage.setItem).mockRejectedValueOnce(new Error('keystore unavailable'));
    await expect(readSecret(KEY, store(), plain())).rejects.toThrow();
    expect(prefs.get(KEY)).toBe(FAKE);
    expect(prefs.has(KEY + MIGRATION_SUFFIX)).toBe(false);
  });
  it('key never reaches logs or error text', async () => {
    const spy = vi.spyOn(console, 'log');
    prefs.set(KEY, FAKE);
    await readSecret(KEY, store(), plain());
    expect(JSON.stringify(prefs)).not.toContain(FAKE);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
