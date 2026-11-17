// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SearchView } from '../src/screens/ledger/SearchView';
import type { Entry } from '../src/ledger/ledger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
const e = (id: string, over: Partial<Entry>): Entry => ({ id, clientId: id, board: '学习', topic: '', question: '', answer: '', ownIdea: '',
  helpLevel: 'hint', weight: null, passes: 0, attempts: 0, dueOn: null, createdOn: '2026-11-01', ...over });

it('types a word, opens a hit, and repays it from search', async () => {
  const onRepay = vi.fn();
  const all = [e('a', { question: '卷积的含义', answer: '翻转平移相乘再积分', ownIdea: '像滑动窗口', dueOn: '2026-11-20' }), e('b', { question: '矩阵求逆', answer: '高斯消元' })];
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(SearchView, { all, onRepay })); });
  const input = host.querySelector('[data-testid=search-input]') as HTMLInputElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, '滑动'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const hits = host.querySelectorAll('[data-testid=search-hit]');
  expect(hits.length).toBe(1);
  await act(async () => { (hits[0].querySelector('button') as HTMLButtonElement).click(); });
  expect(host.textContent).toContain('翻转平移相乘再积分');
  await act(async () => { [...host!.querySelectorAll('button')].find(b => b.textContent === '现在讲给我听')!.click(); });
  expect(onRepay).toHaveBeenCalledWith(all[0]);
});
