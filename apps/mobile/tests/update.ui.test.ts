// @vitest-environment jsdom
// T6: update dialog; installer only after sha256 verifies AND the user taps confirm. 非真机 (installer is a stub here).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpdateCard } from '../src/screens/UpdateCard';
import { saveSource, type Downloader } from '../src/update/manifest';
import { memoryKV } from '../src/storage/kv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
const SHA = 'a'.repeat(64);
const body = JSON.stringify({ versionName: '1.5.0', versionCode: 6, minSupportedVersionCode: 1, sha256: SHA, size: 2097152,
  asset: 'paper-lab-assistant-1.3.apk',
  releaseNotes: '新增应用内更新。', publishedAt: '2026-11-20T12:00:00+08:00', channel: 'stable' });
const fetchFn = (async () => new Response(body)) as unknown as typeof fetch;

async function mount(src: string | null, dl: Downloader, install = vi.fn(async () => {}), f: typeof fetch = fetchFn) {
  const kv = memoryKV();
  // null = leave unset (default GitHub URL); '' = explicit disable; otherwise save the URL.
  if (src !== null) await saveSource(kv, src);
  let t = 1_000_000;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(UpdateCard, { deps: { kv, fetchFn: f, downloader: () => dl, install, now: () => (t += 60_000) } })); });
  await flush();
  return { h: host, install };
}
const btn = (h: HTMLElement, t: string) => { const b = [...h.querySelectorAll('button')].find(x => x.textContent === t); if (!b) throw new Error(t); return b; };
const click = async (b: HTMLElement) => { act(() => b.click()); await flush(); };

describe('T6 update UI', () => {
  it('empty source shows 未配置源 and makes no request', async () => {
    const dl = vi.fn(); const { h } = await mount('', dl as unknown as Downloader);
    await click(btn(h, '检查更新'));
    expect(h.querySelector('[data-testid=update-msg]')?.textContent).toMatch(/未配置源/);
    expect(h.querySelector('[role=dialog]')).toBeNull(); expect(dl).not.toHaveBeenCalled();
  });
  it('shows notes; nothing downloaded or installed until confirm', async () => {
    const dl = vi.fn(async () => ({ ok: true as const, path: '/cache/updates/update.apk' }));
    const { h, install } = await mount('https://u.example/version.json', dl);
    await click(btn(h, '检查更新'));
    const d = h.querySelector('[data-testid=update-dialog]')!;
    expect(d.textContent).toContain('发现新版本 1.5.0'); expect(d.textContent).toContain('新增应用内更新。');
    expect(dl).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
    await click(btn(h, '以后再说'));
    expect(h.querySelector('[role=dialog]')).toBeNull(); expect(install).not.toHaveBeenCalled();
    await click(btn(h, '检查更新')); await click(btn(h, '下载并安装'));
    expect(dl).toHaveBeenCalledTimes(1); expect(install).toHaveBeenCalledWith('/cache/updates/update.apk');
  });
  it('sha256 mismatch: install prompt is never shown (installer never opened)', async () => {
    const dl = vi.fn(async () => ({ ok: false as const, code: 'sha_mismatch' as const }));
    const { h, install } = await mount('https://u.example/version.json', dl);
    await click(btn(h, '检查更新'));
    expect(h.querySelector('[data-testid=update-dialog]')).not.toBeNull(); // offer dialog ok
    await click(btn(h, '下载并安装'));
    expect(h.querySelector('[data-testid=update-msg]')?.textContent).toMatch(/sha256.*没有安装/);
    expect(install).not.toHaveBeenCalled(); // system install prompt never shown
    expect(dl).toHaveBeenCalled(); // download+verify ran; failed on sha
  });
  it('1.4: shows checking progress while waiting, then download percent', async () => {
    const slow = (async () => { await new Promise(r => setTimeout(r, 120)); return new Response(body); }) as unknown as typeof fetch;
    const dl: Downloader = async (_u, _s, _h, onP) => { onP?.(1048576, 2097152); await new Promise(r => setTimeout(r, 120)); return { ok: true, path: '/cache/updates/update.apk' }; };
    const { h } = await mount('https://u.example/version.json', dl, vi.fn(async () => {}), slow);
    act(() => btn(h, '检查更新').click()); await flush();
    expect(h.querySelector('[data-testid=update-check-progress]')?.textContent).toMatch(/正在检查:已等 \d+ 秒,最多等 10 秒/);
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
    expect(h.querySelector('[data-testid=update-check-progress]')).toBeNull();
    act(() => btn(h, '下载并安装').click()); await flush();
    expect(h.querySelector('[data-testid=update-download-progress]')?.textContent).toContain('正在下载:50%');
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
    expect(h.querySelector('[data-testid=update-download-progress]')).toBeNull();
  });
});
