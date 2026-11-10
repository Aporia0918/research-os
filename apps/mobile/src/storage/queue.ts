import type { KV } from './kv';
export type LogKind = 'photo' | 'voice' | 'text';
export interface LogEntry { id: string; kind: LogKind; createdAt: string; note: string; media?: string; mimeType?: string; durationMs?: number }
const KEY = 'log.entries.v1';
/** Private, on-device experiment log. No sending or synchronization exists. */
export class LogQueue {
  constructor(private kv: KV, private now: () => Date = () => new Date(), private newId: () => string = () => crypto.randomUUID()) {}
  async all(): Promise<LogEntry[]> {
    const raw = await this.kv.get(KEY); if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v as LogEntry[] : []; } catch { return []; }
  }
  async add(e: Omit<LogEntry, 'id' | 'createdAt'>): Promise<LogEntry> {
    const entry: LogEntry = { ...e, id: this.newId(), createdAt: this.now().toISOString() };
    const list = await this.all(); list.unshift(entry); await this.kv.set(KEY, JSON.stringify(list)); return entry;
  }
}
