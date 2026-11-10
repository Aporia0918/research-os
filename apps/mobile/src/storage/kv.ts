import { Preferences } from '@capacitor/preferences';

/** Minimal key-value store; native Preferences on device, swappable in tests. */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const preferencesKV: KV = {
  async get(key) { return (await Preferences.get({ key })).value; },
  async set(key, value) { await Preferences.set({ key, value }); },
};

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
}
