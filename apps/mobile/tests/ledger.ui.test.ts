// @vitest-environment jsdom
// 演示第一段 on the real screen: book a debt, say 讲不出来, see it red at the top of the pre-exam list.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LedgerScreen } from '../src/screens/LedgerScreen';
import { today } from '../src/ledger/book';
import { addDays } from '../src/ledger/ledger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

function type(el: Element | undefined, value: string) {
  if (!el) throw new Error('field not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLInputElement && el.type === 'date' ? 'change' : 'input', { bubbles: true }));
  });
}
const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find(b => b.textContent === text);
const field = (h: HTMLElement, hint: string) => [...h.querySelectorAll('textarea')].find(t => t.placeholder.startsWith(hint));

describe('讲不出来 on the ledger screen', () => {
  it('asks right after booking, marks the debt red and puts it first on the pre-exam list', async () => {
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(LedgerScreen)); });
    await flush();
    type(host.querySelector('input[type=date]')!, addDays(today(), 1));
    await flush();
    type(field(host, '问了 AI 什么'), '这道换元积分怎么做');
    type(field(host, 'AI 的回答'), '令 u 等于里层函数，dx 换成 du 除以 u 的导数，积完再把 u 换回去。');
    await act(async () => { button(host!, '记下')!.click(); });
    await flush();
    const card = host.querySelector('[data-testid=explain-now]');
    expect(card?.textContent).toContain('这一步你讲给我听？');
    await act(async () => { button(host!, '讲不出来')!.click(); });
    await flush();
    expect(host.querySelector('[data-testid=explain-now]')).toBeNull();
    const first = host.querySelector('[data-testid=exam-list] li');
    expect(first?.className).toBe('red-mark');
    expect(first?.textContent).toContain('这道换元积分怎么做');
    expect(host.textContent).toContain('这一笔标红，排在考前清单最前面');
    expect(host.textContent).not.toMatch(/分数|失败|不及格/);
  });
});
