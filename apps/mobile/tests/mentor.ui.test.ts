// @vitest-environment jsdom
// The 组会之后 screens render, load the demo data, and the offline meeting reading finds both sides' to-dos.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MentorApp } from '../src/mentor/MentorApp';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });
const click = (el: Element | undefined | null) => { if (!el) throw new Error('element not found'); act(() => { (el as HTMLElement).click(); }); };
const button = (h: HTMLElement, text: RegExp) => [...h.querySelectorAll('button')].find(b => text.test(b.textContent ?? ''));

describe('组会之后 screens', () => {
  it('loads demo data and walks every tab', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(MentorApp)); }); await flush();
    click(button(host, /载入示例数据/)); await flush();
    expect(host.querySelector('h1')?.textContent).toBe('今天做哪一步');
    expect(host.textContent).toMatch(/第 \d+\/\d+ 步/);
    click(button(host, /^任务$/)); await flush();
    expect(host.textContent).toContain('我的课表');
    click(button(host, /^组会$/)); await flush();
    click(button(host, /用示例记录/));
    click(button(host, /整理待办/)); await flush();
    expect(host.textContent).toContain('导师答应的');
    expect(host.textContent).toMatch(/数据集链接/);
    expect(host.textContent).toMatch(/导师的要求(变了|前后矛盾)/);
    click(button(host, /^导师$/)); await flush();
    expect(host.textContent).toContain('导出总览发给导师');
  });
});
