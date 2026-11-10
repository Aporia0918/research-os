import { describe, it, expect, vi } from 'vitest';
import { ResearchOsClient, ApiError, normalizeBaseUrl, describeError, type FetchLike } from '../src/api/computer';

import { COMPUTER_ENABLED_KEY, DEFAULT_COMPUTER_URL, loadComputerSettings, saveComputerSettings } from '../src/settings';
import { memoryKV } from '../src/storage/kv';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
describe('optional computer link', () => {
  it('is disabled by default and persists only with an explicit toggle', async () => {
    const kv = memoryKV(); expect(await loadComputerSettings(kv)).toEqual({ enabled: false, url: DEFAULT_COMPUTER_URL });
    await saveComputerSettings(kv, { enabled: true, url: ' http://computer:8443/ ' });
    expect(await loadComputerSettings(kv)).toEqual({ enabled: true, url: 'http://computer:8443' });
    expect(await kv.get(COMPUTER_ENABLED_KEY)).toBe('1');
    await saveComputerSettings(kv, { enabled: false, url: 'http://computer:8443' });
    expect((await loadComputerSettings(kv)).enabled).toBe(false);
  });
  it('caps transport at five seconds and maps failure to plain wording', async () => {
    vi.useFakeTimers();
    const hang: FetchLike = (_u, init) => new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('aborted'))));
    const task = new ResearchOsClient('http://computer:1', hang, 60000).health().catch(e => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = await task;
    expect(err).toBeInstanceOf(ApiError); expect(describeError(err)).toContain('电脑未连接，已用手机处理');
    vi.useRealTimers();
  });
  it('normalizes an address and never displays a secret in an exception', async () => {
    expect(normalizeBaseUrl(' http://computer:8443/ ')).toBe('http://computer:8443');
    expect(() => normalizeBaseUrl('file:///key')).toThrow('电脑地址');
    const err = await new ResearchOsClient('http://computer:1', async () => { throw new Error('private details'); }).health().catch(e => e);
    expect(describeError(err)).not.toContain('private details');
    await wait(1);
  });
});

describe('1.4: computer 5 s hard limit even if the fetch ignores AbortSignal', () => {
  it('rejects at the limit with the phone-fallback message', async () => {
    const deaf: FetchLike = () => new Promise(() => { /* ignores abort, never settles */ });
    const t0 = Date.now(); const e = await new ResearchOsClient('http://computer:1', deaf, 1000).health().catch(x => x);
    expect(e).toBeInstanceOf(ApiError); expect(describeError(e)).toBe('电脑未连接，已用手机处理');
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});
