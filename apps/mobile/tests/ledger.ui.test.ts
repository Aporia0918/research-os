// @vitest-environment jsdom
// 演示第一段 on the real screen: book a debt, say 讲不出来, see it red at the top of the pre-exam list.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LedgerScreen } from '../src/screens/LedgerScreen';
import { today } from '../src/ledger/book';
import { addDays } from '../src/ledger/ledger';
import { book } from '../src/ledger/book';
import { preferencesKV } from '../src/storage/kv';

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
/** A paper as an earlier version stored it on the phone (the recall and citation source). */
const keepPaper = (name: string, pages: string[]) => preferencesKV.set('paper.localDocument.v2', JSON.stringify({ ref: { name }, doc: { pages: pages.map(text => ({ text })) } }));
const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find(b => b.textContent === text);
const field = (h: HTMLElement, hint: string) => [...h.querySelectorAll('textarea')].find(t => t.placeholder.startsWith(hint));

describe('讲不出来 on the ledger screen', () => {
  it('asks right after booking, marks the debt red and puts it first on the pre-exam list', async () => {
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(LedgerScreen)); });
    await flush();
    await act(async () => { button(host!, '考前清单')!.click(); });
    type(host.querySelector('input[type=date]')!, addDays(today(), 1));
    await flush();
    await act(async () => { button(host!, '‹ 账本')!.click(); });
    await act(async () => { button(host!, '记一笔')!.click(); });
    type(field(host, '问了 AI 什么'), '这道换元积分怎么做');
    type(field(host, 'AI 的回答'), '令 u 等于里层函数，dx 换成 du 除以 u 的导数，积完再把 u 换回去。');
    await act(async () => { button(host!, '记下')!.click(); });
    await flush();
    const card = host.querySelector('[data-testid=explain-now]');
    expect(card?.textContent).toContain('这一步你讲给我听？');
    await act(async () => { button(host!, '讲不出来')!.click(); });
    await flush();
    expect(host.querySelector('[data-testid=explain-now]')).toBeNull();
    expect(host.textContent).toContain('这一笔标红，排在考前清单最前面');
    expect(host.querySelector('[data-testid=owed]')?.textContent).toBe('1');
    await act(async () => { button(host!, '考前清单')!.click(); });
    await flush();
    const first = host.querySelector('[data-testid=exam-list] li');
    expect(first?.className).toBe('red-mark');
    expect(first?.textContent).toContain('这道换元积分怎么做');
    expect(host.textContent).not.toMatch(/分数|失败|不及格/);
  });
});

describe('召回单 on the ledger screen (演示第三段, phone half)', () => {
  it('a paper that says the opposite shows a recall notice with the page; accepting puts the debt back on today', async () => {
    await book.add({ clientId: 'r1', board: '科研', question: '空间滤波为什么放在分类之前', answer: '空间滤波应放在分类之前。', helpLevel: 'answer',
      ai: '豆包' }, addDays(today(), -20));
    const pages = ['引言。', '综述指出，空间滤波应在分类之后进行。'];
    await keepPaper('导师发的综述.pdf', pages);
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(LedgerScreen)); });
    await flush();
    expect(host.querySelector('[data-testid=recall-alert]')).toBeNull();
    await act(async () => { button(host!, '考前清单')!.click(); });
    await act(async () => { button(host!, '用导入的论文查一遍召回')!.click(); });
    await flush();
    const slip = host.querySelector('[data-testid=recall-slip]');
    expect(slip?.textContent).toContain('当时 豆包 说：空间滤波应放在分类之前。');
    expect(slip?.textContent).toContain('《导师发的综述.pdf》第 2 页：综述指出，空间滤波应在分类之后进行。');
    await act(async () => { button(host!, '我有原文证据')!.click(); });
    type(field(host, '贴一句导入论文里的原话'), '我觉得没错。');
    await act(async () => { button(host!, '提交证据')!.click(); });
    await flush();
    expect(host.textContent).toContain('召回单保留');
    await act(async () => { button(host!, '接受，重开这笔')!.click(); });
    await flush();
    expect(host.querySelector('[data-testid=recall-slips]')).toBeNull();
    expect(host.textContent).toContain('这笔重新打开了');
    await act(async () => { button(host!, '‹ 账本')!.click(); });
    await act(async () => { button(host!, '讲给我听 · 今天 1 笔')!.click(); });
    await flush();
    expect(host.querySelector('.item')?.textContent).toContain('空间滤波为什么放在分类之前');
  });
});

describe('讲给我听 talks back, and 引用债 needs the original', () => {
  async function open() {
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(LedgerScreen)); });
    await flush();
    return host;
  }
  it('a miss offers to go through the missed points, never a score; 改天再聊 moves it to tomorrow', async () => {
    await book.add({ clientId: 'w1', board: '科研', question: '什么是导数', helpLevel: 'answer',
      answer: '导数是函数在某点的瞬时变化率。几何上它是切线的斜率。求导要先写出差商再取极限。' }, addDays(today(), -1));
    await book.add({ clientId: 'w2', board: '科研', question: '链式法则', helpLevel: 'answer', answer: '外层导数乘内层导数。' }, addDays(today(), -1));
    const h = await open();
    await act(async () => { button(h, '讲给我听 · 今天 2 笔')!.click(); });
    await act(async () => { [...h.querySelectorAll('.item')].find(b => b.textContent?.includes('什么是导数'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    type(field(h, '不看答案'), '不会');
    await act(async () => { button(h, '讲完了')!.click(); });
    await flush();
    const walk = h.querySelector('[data-testid=walk-through]');
    expect(walk?.textContent).toContain('我们一起捋一遍');
    expect(walk?.querySelectorAll('li').length).toBe(1);
    await act(async () => { button(h, '懂了，下一条')!.click(); });
    expect(h.querySelectorAll('[data-testid=walk-through] li').length).toBe(2);
    expect(h.textContent).not.toMatch(/分数|失败|不及格/);
    await act(async () => { [...h.querySelectorAll('.item')].find(b => b.textContent?.includes('链式法则'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    await act(async () => { button(h, '改天再聊')!.click(); });
    await flush();
    expect((await book.all()).find(e => e.clientId === 'w2')!.dueOn).toBe(addDays(today(), 1));
  });
  it('books a citation debt and clears it only with the sentence from the imported paper', async () => {
    await keepPaper('方法.pdf', ['我们用 0.5 到 40 Hz 带通滤波。']);
    const h = await open();
    await act(async () => { button(h, '记一笔')!.click(); });
    await act(async () => { h.querySelector<HTMLButtonElement>('[data-testid=kind-citation]')!.click(); });
    type(field(h, 'AI 给的那句引用'), '论文用了 0.5 到 40 Hz 带通滤波');
    type(h.querySelector('[data-testid=used-in]')!, '第二章');
    await act(async () => { button(h, '记下')!.click(); });
    await flush();
    expect(h.textContent).toContain('记了一笔引用债');
    await act(async () => { button(h, '讲给我听 · 今天 1 笔')!.click(); });
    await act(async () => { h.querySelector<HTMLButtonElement>('[data-testid=citation-due] .item')!.click(); });
    await flush();
    expect(h.querySelector('[data-testid=citation-due]')?.textContent).toContain('用在：第二章');
    type(field(h, '贴一句原文'), '我们用 0.5 到 40 Hz 带通滤波。');
    await act(async () => { button(h, '找到原文')!.click(); });
    await flush();
    expect(h.textContent).toContain('这笔引用债还清');
    await act(async () => { button(h, '‹ 账本')!.click(); });
    await act(async () => { h.querySelector<HTMLButtonElement>('[data-testid=go-balance]')!.click(); });
    expect(h.querySelector('[data-testid=week-bill]')?.textContent).toContain('思维账本每周账单');
  });
});
