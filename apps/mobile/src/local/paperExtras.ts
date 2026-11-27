// The code and data links 科研 keeps beside each paper, on this phone only, by paper name (the topic its debts are booked under).
import type { KV } from '../storage/kv';

export type LinkKind = 'code' | 'dataset';
export interface PaperLink { kind: LinkKind; url: string; page?: number }

export async function linksFor(kv: KV, paper: string): Promise<PaperLink[]> {
  try {
    const all = JSON.parse((await kv.get('paper.links.v1')) ?? '{}') as Record<string, PaperLink[]> | null;
    return all && typeof all === 'object' && Array.isArray(all[paper]) ? all[paper] : [];
  } catch { return []; }
}
