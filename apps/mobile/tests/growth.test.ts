// @vitest-environment jsdom
// 成长空间 (the 生活 board renamed): the 主意账 in its own table, deadlines that pull a course's debts forward, the weekly
// growth report, and the screen behind the 成长空间 tab (no chat).
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LifeBook, monday } from '../src/ledger/life';
import { GrowthBook, growthWeek, monthAgo, pullDays, upcoming } from '../src/ledger/growth';
import { Book, type Entry } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';
import { LedgerScreen } from '../src/screens/LedgerScreen';

describe('主意账', () => {
  it('keeps one line per decision in its own table; a week runs Monday to Sunday', async () => {
    const kv = memoryKV();
    const life = new LifeBook(kv);
    expect(monday('2026-11-16')).toBe('2026-11-16');
    expect(monday('2026-11-22')).toBe('2026-11-16');
    await life.add('own', '  选课题方向  ', '2026-11-17', 'a');
    await life.add('ai', '组会讲哪篇', '2026-11-18', 'b');
    expect(await life.add('own', '   ', '2026-11-19', 'd')).toBeNull();
    await life.add('own', '上周的事', '2026-11-15', 'e');
    expect(await life.week('2026-11-22')).toMatchObject({ own: 1, ai: 1, balance: 0, named: '选课题方向' });
    await new Book(kv).add({ clientId: 'x', board: '学习', question: '换元积分', helpLevel: 'answer' }, '2026-11-17');
    await life.clear();
    expect(await life.all()).toEqual([]);
    expect(await new Book(kv).all()).toHaveLength(1); // the debt ledger is another table
    await expect(new Book(kv).add({ clientId: 'y', board: '生活', question: 'q', helpLevel: 'answer' }, '2026-11-17')).rejects.toThrow('life_has_its_own_book');
  });
});

describe('截止日和成长周报', () => {
  it('lists open deadlines nearest first; an exam within a week pulls that course forward', async () => {
    const kv = memoryKV();
    const g = new GrowthBook(kv);
    await g.addDeadline({ id: '1', title: ' 高数期中 ', course: '高数', kind: '考试', on: '2026-11-20' });
    await g.addDeadline({ id: '2', title: '实验报告', course: '电路', kind: '实验报告', on: '2026-11-18' });
    await g.addDeadline({ id: '3', title: '', course: '', kind: '其他', on: '2026-11-19' });
    await g.addDeadline({ id: '4', title: '远的考试', course: '英语', kind: '考试', on: '2026-12-30' });
    const c = await g.finish('2', '2026-11-17');
    expect(upcoming(c.deadlines, '2026-11-17').map(d => [d.title, d.left])).toEqual([['高数期中', 3], ['远的考试', 43]]);
    expect([...pullDays(c.deadlines, '2026-11-17')]).toEqual([['高数', '2026-11-20']]);

    const book = new Book(kv);
    const e = await book.add({ clientId: 'q', board: '学习', topic: '高数', question: '换元积分', helpLevel: 'answer' }, '2026-11-10');
    const later = { ...e, dueOn: '2026-11-25' };
    await kv.set('mindledger.v1', JSON.stringify([later]));
    expect(await book.pullForward('高数', '2026-11-20', '2026-11-17')).toBe(1);
    expect((await book.all())[0].dueOn! < '2026-11-20').toBe(true);
  });

  it('the week counts repayments, new debts, focus that led to explaining, deadlines met and who decided', async () => {
    const g = new GrowthBook(memoryKV());
    await g.focused('2026-11-17', 25);
    await g.focused('2026-11-18', 25);
    await g.repaidAfterFocus('2026-11-18');
    await g.addDeadline({ id: 'a', title: '作业', course: '', kind: '作业', on: '2026-11-19' });
    const c = await g.finish('a', '2026-11-19');
    const es = [
      { board: '学习', createdOn: '2026-11-16', tries: [{ on: '2026-11-17', ok: true }] },
      { board: '科研', createdOn: '2026-11-01', tries: [{ on: '2026-11-18', ok: false }] },
      { board: '学习', createdOn: '2026-10-18', tries: [{ on: '2026-10-19', ok: true }], question: '一个月前的那笔', answer: 'a' },
    ] as Entry[];
    const w = growthWeek(c, es, { from: '', to: '', own: 2, ai: 1, balance: 3, named: 'x' }, '2026-11-20');
    expect(w).toMatchObject({ repaid: 1, booked: 1, focus: 2, focusRepaid: 1, due: 1, done: 1, own: 2, ai: 1 });
    expect(monthAgo(es, '2026-11-18')?.question).toBe('一个月前的那笔');
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });
async function mount(el: ReturnType<typeof createElement>) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  await flush();
  return host;
}
function type(el: Element | null | undefined, value: string) {
  if (!el) throw new Error('field not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find(b => b.textContent === text);
const click = async (b: HTMLButtonElement | undefined) => { await act(async () => { b!.click(); }); await flush(); };

describe('成长空间 screen', () => {
  it('the third tab is 成长空间: deadlines, focus and the growth report, no chat', async () => {
    const h = await mount(createElement(LedgerScreen));
    expect(h.querySelector('[data-testid=ledger-hero]')).not.toBeNull();
    const tabs = [...h.querySelectorAll<HTMLButtonElement>('[data-testid=board-switch] button')].map(b => b.textContent);
    expect(tabs).toEqual(['学习', '科研', '成长空间']);
    await click([...h.querySelectorAll<HTMLButtonElement>('[data-testid=board-switch] button')].find(b => b.textContent === '成长空间'));
    expect(h.querySelector('[data-testid=growth]')).not.toBeNull();
    expect(document.documentElement.dataset.board).toBe('生活');
    expect(h.querySelector('[data-testid=life-chat]')).toBeNull();
    expect(h.querySelector('[data-testid=focus]')).not.toBeNull();
    expect(h.querySelector('[data-testid=growth-week]')!.textContent).toContain('成长周报');

    await click(button(h, '加一个截止日'));
    type(h.querySelector('[aria-label=截止日名称]'), '高数第 5 章作业');
    type(h.querySelector('input[type=date]'), '2099-01-01');
    await click(button(h, '记下'));
    expect(h.querySelector('[data-testid=deadlines]')!.textContent).toContain('高数第 5 章作业');

    await click(button(h, '我自己定了一件事'));
    type(h.querySelector('[data-testid=decide] input'), '选课题方向');
    await click(button(h, '记下'));
    expect(h.querySelector('[data-testid=growth-week]')!.textContent).toContain('这周你自己拿了 1 个主意，0 个交给了 AI。');
  });
});
