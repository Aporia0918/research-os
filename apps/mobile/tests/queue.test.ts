import { describe, it, expect } from 'vitest';
import { LogQueue } from '../src/storage/queue';
import { memoryKV } from '../src/storage/kv';
let n = 0;
const mk = (kv = memoryKV()) => new LogQueue(kv, () => new Date('2026-11-04T00:00:00Z'), () => `id${++n}`);
describe('local experiment records', () => {
  it('stores newest first and survives reopening without network state', async () => {
    const kv = memoryKV(); const q = mk(kv);
    await q.add({ kind: 'text', note: 'a' }); await q.add({ kind: 'photo', note: 'b', media: 'file://x.jpg' });
    expect((await mk(kv).all()).map(e => e.note)).toEqual(['b', 'a']);
    expect((await mk(kv).all()).every(e => !('status' in e) && !('serverId' in e))).toBe(true);
  });
  it('corrupt storage reads as empty', async () => { const kv = memoryKV(); await kv.set('log.entries.v1', '{bad'); expect(await mk(kv).all()).toEqual([]); });
  it('has no upload API on a core record', () => { expect('flush' in mk()).toBe(false); });
});
