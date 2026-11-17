import type { KV } from './kv';
export type LogKind = 'photo' | 'voice' | 'text' | 'data';
/** An experiment data file kept in the app's own storage (local/expFiles.ts). */
export interface DataFile { name: string; path: string; size: number; mime?: string }
export interface LogEntry { id: string; kind: LogKind; createdAt: string; note: string; media?: string; mimeType?: string; durationMs?: number; files?: DataFile[] }
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
  /** Sets the data files listed on one record; returns the record, or null when it is gone. */
  async setFiles(id: string, files: DataFile[]): Promise<LogEntry | null> {
    const list = await this.all(); const e = list.find(x => x.id === id); if (!e) return null;
    if (files.length) e.files = files; else delete e.files;
    await this.kv.set(KEY, JSON.stringify(list)); return e;
  }
}
