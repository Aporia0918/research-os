import { describe, expect, it } from 'vitest';
import { ResearchOsClient, type FetchLike } from '../src/api/computer';
import { base64ToBlob, logForm } from '../src/logic/logSync';
import { pageLabel } from '../src/logic/types';
describe('explicit enhancement only', () => {
  it('builds attachments without automatic calls; one opt-in call keeps its idempotency key', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: FetchLike = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'a', client_id: 'b', created: true, kind: 'text' }), { status: 200 }); };
    const form = await logForm({ id: 'abc', kind: 'voice', note: 'n', createdAt: '2026-11-04T00:00:00Z', media: btoa('xyz'), mimeType: 'audio/aac', durationMs: 1200.4 });
    expect(calls).toEqual([]);
    const out = await new ResearchOsClient('http://computer:1', f).createLog(form, 'stable-key');
    expect(out.id).toBe('a'); expect(calls[0].url).toContain('/mobile/logs');
    expect((calls[0].init!.headers as Record<string, string>)['Idempotency-Key']).toBe('stable-key');
    expect(base64ToBlob(btoa('ab'), 'audio/aac').size).toBe(2); expect(pageLabel(0)).toBe('p.1');
  });
});
