import type { KV } from '../storage/kv';
export function newId(): string { return globalThis.crypto.randomUUID(); }
export async function saveJson<T>(kv: KV, key: string, value: T): Promise<void> { await kv.set(key, JSON.stringify(value)); }
export async function readJson<T>(kv: KV, key: string): Promise<T | null> {
  const raw = await kv.get(key); if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
export function appError(message: string): never { throw new Error(message); }
