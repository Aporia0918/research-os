// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { EN } from '../src/i18n/en';
import { collectKeys } from '../scripts/i18n-keys.mjs';
import { LANG_KEY, getLang, loadLang, saveLang, setLang, tr, fmtDate } from '../src/i18n';
import { memoryKV } from '../src/storage/kv';
import { ERROR_ZH, describeError, ApiError } from '../src/api/computer';
import { App } from '../src/App';
import { preferencesKV } from '../src/storage/kv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
async function mount() {
  await preferencesKV.set('profile.v1', JSON.stringify({ who: 'college', slots: [], remind: false })); // past the first-open welcome
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(App)); });
  await flush();
  return host;
}
function unmount() { act(() => root?.unmount()); host?.remove(); root = null; host = null; }
function click(el: Element | null | undefined) { if (!el) throw new Error('element not found'); act(() => { (el as HTMLElement).click(); }); }
const tab = (h: HTMLElement, name: RegExp) => [...h.querySelectorAll('nav.tabbar [role=tab]')].find(b => name.test(b.textContent ?? ''));
const opt = (h: HTMLElement, name: string) => [...h.querySelectorAll('[data-testid=lang-switch] [role=radio]')].find(b => b.textContent === name);

afterEach(() => { unmount(); setLang('zh'); localStorage.clear(); });

describe('language dictionary', () => {
  it('every Chinese UI string has an English entry', () => {
    const missing = (collectKeys() as string[]).filter(k => !EN[k]);
    expect(missing).toEqual([]);
  });
  it('demo bundle strings shown in the UI have English entries', async () => {
    const { demoPaper, demoSource } = await import('../src/demo/demo');
    expect(EN[demoPaper.name]).toBeTruthy(); expect(EN[demoSource]).toBeTruthy();
  });
  it('English text never claims verification', () => {
    for (const v of Object.values(EN)) expect(v).not.toMatch(/verif/i);
    expect(Object.values(EN).some(v => v.includes('helps locate the source text; you decide'))).toBe(true);
  });
});

describe('language logic', () => {
  it('defaults to zh even when the browser says en-US', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
    expect(await loadLang(memoryKV())).toBe('zh');
    expect(getLang()).toBe('zh');
    expect(tr('设置')).toBe('设置');
  });
  it('persists the choice in the KV and reloads it', async () => {
    const kv = memoryKV();
    await saveLang(kv, 'en');
    expect(await kv.get(LANG_KEY)).toBe('en');
    expect(await loadLang(kv)).toBe('en');
    await saveLang(kv, 'zh');
    expect(await loadLang(kv)).toBe('zh');
  });
  it('error codes are mapped in both languages, never raw English details', () => {
    const e = new ApiError(409, 'citation_gate_open', 'numbers not found on cited page');
    setLang('zh'); expect(describeError(e)).toBe(ERROR_ZH.citation_gate_open);
    expect(describeError(e)).toMatch(/[\u4e00-\u9fff]/);
    setLang('en'); expect(describeError(e)).toContain('numbers');
    expect(describeError(new ApiError(418, 'weird_code', 'Some English'))).not.toContain('Some English');
  });
  it('dates follow the chosen language', () => {
    const d = '2026-11-05T08:00:00Z';
    setLang('zh'); expect(fmtDate(d)).toBe(new Date(d).toLocaleString('zh-CN'));
    setLang('en'); expect(fmtDate(d)).toBe(new Date(d).toLocaleString('en-US'));
  });
});

describe('language switch in the app', () => {
  it('starts in zh under an en-US navigator, switches to en immediately, survives reload, and switches back', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    let h = await mount();
    expect(tab(h, /设置/)).toBeTruthy();
    click(tab(h, /设置/));
    expect(h.querySelector('h1')?.textContent).toBe('设置');
    click(opt(h, 'English'));
    await flush();
    expect(h.querySelector('h1')?.textContent).toBe('Settings');
    expect(tab(h, /Ask/)).toBeTruthy();
    expect(h.textContent).not.toMatch(/演示模式|后端地址/);
    unmount();
    // reload: a fresh module state reads the stored choice back
    setLang('zh');
    h = await mount();
    expect(tab(h, /Settings/)).toBeTruthy();
    click(tab(h, /Settings/));
    click(opt(h, '中文'));
    await flush();
    expect(h.querySelector('h1')?.textContent).toBe('设置');
    expect(tab(h, /提问/)).toBeTruthy();
    unmount(); setLang('en');
    h = await mount();
    expect(tab(h, /提问/)).toBeTruthy();
  });
});

describe('1.4 computer toggle', () => {
  it('is off by default; enhanced tab hidden until switched on; never says 后端/backend', async () => {
    const h = await mount();
    click(tab(h, /设置/)); await flush();
    const box = h.querySelector('[data-testid=computer-settings] input[type=checkbox]') as HTMLInputElement;
    expect(box.getAttribute('aria-label')).toBe('连接电脑（增强功能）'); expect(box.checked).toBe(false);
    expect(tab(h, /电脑增强/)).toBeUndefined();
    click(box); await flush();
    expect(tab(h, /电脑增强/)).toBeDefined(); // appears right away, no tab switch needed
    expect(h.textContent).not.toMatch(/后端|backend/i);
    click(tab(h, /设置/)); await flush();
    click(h.querySelector('[data-testid=computer-settings] input[type=checkbox]')); await flush();
  });
});
