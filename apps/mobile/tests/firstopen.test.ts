// @vitest-environment jsdom
// 第一次打开、到期提醒、分享进来记账、未成年人模式 (plan 2.2, 2.4 ⑦).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { planReminders, MAX_A_DAY } from '../src/remind/plan';
import { lifeLocked, isMinor, loadProfile, preset, restDue, saveProfile, type Profile } from '../src/me/profile';
import { fromShared } from '../src/me/shareIn';
import type { Entry } from '../src/ledger/ledger';
import { book } from '../src/ledger/book';
import { preferencesKV } from '../src/storage/kv';
import { Welcome } from '../src/screens/Welcome';
import { LifeScreen } from '../src/screens/LifeScreen';
import { LedgerScreen } from '../src/screens/LedgerScreen';
import { MeCard } from '../src/screens/MeCard';
import { localNow } from '../src/remind';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });
async function mount(el: ReturnType<typeof createElement>) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(el); }); await flush(); return host;
}
function type(el: Element | null | undefined, value: string) {
  if (!el) throw new Error('field not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find(b => b.textContent === text);
const click = async (el: Element | undefined) => { if (!el) throw new Error('button not found'); await act(async () => { (el as HTMLElement).click(); }); await flush(); };

const debt = (id: string, dueOn: string | null, more: Partial<Entry> = {}): Entry => ({
  id, clientId: id, board: '学习', topic: '高数', question: `问题${id}`, answer: '', ownIdea: '', helpLevel: 'hint',
  weight: 'light', passes: 0, attempts: 0, dueOn, createdOn: '2026-11-10', ...more,
});

describe('到期提醒', () => {
  const es = [debt('a', '2026-11-17'), debt('b', '2026-11-17', { red: true }), debt('c', '2026-11-17'), debt('d', '2026-11-19', { kind: 'citation' }),
    debt('e', '2026-11-17', { board: '生活' }), debt('f', '2026-11-17', { kind: 'conclusion', board: '科研' }), debt('g', '2026-11-17', { dropped: '2026-11-16' }), debt('h', null)];
  it('comes only at the free times, red first, one debt a slot, two a day, never at night', () => {
    const rs = planReminders(es, ['12:10', '17:40', '23:30', '06:00'], '2026-11-17T09:00', 3);
    expect(rs.map(r => r.at)).toEqual(['2026-11-17T12:10', '2026-11-17T17:40', '2026-11-18T12:10', '2026-11-19T12:10']);
    expect(rs.map(r => r.entryId)).toEqual(['b', 'a', 'c', 'd']);
    expect(rs[3].title).toBe('找一找原文？');
    expect(rs[0].title).toBe('这个你给我讲讲？');
    for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) expect(rs.filter(r => r.at.startsWith(day)).length).toBeLessThanOrEqual(MAX_A_DAY);
  });
  it('skips a time already past today; 生活, 结论债 and dropped debts never push', () => {
    const rs = planReminders(es, ['12:10', '17:40'], '2026-11-17T13:00', 1);
    expect(rs.map(r => r.at)).toEqual(['2026-11-17T17:40']);
    const all = planReminders(es, ['08:00', '12:10', '17:40'], '2026-11-17T07:00', 7).map(r => r.entryId);
    expect(all).not.toContain('e'); expect(all).not.toContain('f'); expect(all).not.toContain('g');
  });
  it('the local clock string is what reminders are set by', () => {
    expect(localNow(new Date(2026, 10, 17, 8, 5))).toBe('2026-11-17T08:05');
  });
});

describe('我是谁和未成年人模式', () => {
  it('presets by who: research opens on 科研, work starts with reminders off', () => {
    expect(preset('research').board).toBe('科研');
    expect(preset('college').remind).toBe(true);
    expect(preset('work').remind).toBe(false);
  });
  it('rests sooner for minors; 生活 under 14 waits for a guardian', () => {
    expect(restDue(0, 39 * 60000, true)).toBeNull();
    expect(restDue(0, 41 * 60000, true)).toBe(41);
    expect(restDue(0, 100 * 60000, false)).toBeNull();
    expect(restDue(0, 121 * 60000, false)).toBe(121);
    const kid: Profile = { who: 'middle', age: 12, slots: [], remind: true };
    expect(isMinor(kid)).toBe(true); expect(lifeLocked(kid)).toBe(true);
    expect(lifeLocked({ ...kid, guardian: true })).toBe(false);
    expect(lifeLocked({ ...kid, age: 15 })).toBe(false);
  });
  it('keeps only real times, once each, in order', async () => {
    await saveProfile(preferencesKV, { who: 'college', slots: ['17:40', '25:00', '12:10', '17:40'], remind: true });
    expect((await loadProfile(preferencesKV))!.slots).toEqual(['12:10', '17:40']);
  });
  it('生活 asks for a guardian under 14, then says it is an AI', async () => {
    await saveProfile(preferencesKV, { who: 'middle', age: 12, slots: [], remind: true });
    const h = await mount(createElement(LifeScreen, {}));
    expect(h.querySelector('[data-testid=life-guardian]')).not.toBeNull();
    await click(button(h, '监护人已同意'));
    expect(h.querySelector('[data-testid=life-guardian]')).toBeNull();
    expect(h.querySelector('[data-testid=life-ai-note]')!.textContent).toBe('我是 AI，不是真人。');
    expect((await loadProfile(preferencesKV))!.guardian).toBe(true);
  });
  it('设置 changes who and the reminder times', async () => {
    await saveProfile(preferencesKV, { who: 'college', slots: ['12:10'], remind: true });
    const h = await mount(createElement(MeCard));
    type(h.querySelector('[data-testid=me-slot]'), '18:30');
    await click(button(h, '加一个时间'));
    expect((await loadProfile(preferencesKV))!.slots).toEqual(['12:10', '18:30']);
    await click(button(h, '12:10 ×'));
    await click(h.querySelector('[data-testid=me-remind]')!);
    const p = (await loadProfile(preferencesKV))!;
    expect(p.slots).toEqual(['18:30']); expect(p.remind).toBe(false);
  });
});

describe('第一次打开', () => {
  it('who you are, one thing explained, booked as your own idea, then into the app', async () => {
    const done = vi.fn();
    const h = await mount(createElement(Welcome, { onDone: done }));
    await click(button(h, '大学生'));
    expect(h.textContent).toContain('最近在学什么？');
    type(h.querySelector('textarea'), '导数就是瞬时变化率。比如速度是位移对时间的导数');
    await click(button(h, '讲完了'));
    expect(h.querySelector('[data-testid=welcome-reply]')!.textContent).toContain('进账');
    const es = await book.all();
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ board: '学习', helpLevel: 'own', question: '导数就是瞬时变化率', weight: null });
    await click(button(h, '开始用'));
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ who: 'college', remind: true, slots: ['12:10', '17:40'] }), '学习');
  });
  it('asks a middle-schooler their age, and research opens with a paper question', async () => {
    const done = vi.fn();
    let h = await mount(createElement(Welcome, { onDone: done }));
    await click(button(h, '中学生'));
    type(h.querySelector('input[type=number]'), '13');
    await click(button(h, '好了'));
    await click(button(h, '先跳过'));
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ who: 'middle', age: 13 }), '学习');
    act(() => root?.unmount()); host?.remove();
    h = await mount(createElement(Welcome, { onDone: done }));
    await click(button(h, '做科研'));
    expect(h.textContent).toContain('最近在读哪篇论文、跑哪个分析？');
  });
});

describe('从别的 App 分享进来', () => {
  it('the first sentence is the question and the whole text is the answer', () => {
    expect(fromShared('极限是函数在某点附近的趋势。它不要求函数在该点有定义。')).toEqual({
      question: '极限是函数在某点附近的趋势', answer: '极限是函数在某点附近的趋势。它不要求函数在该点有定义。' });
    expect(fromShared('a'.repeat(60)).question).toHaveLength(41);
  });
  it('opens 记一笔 with the shared text in place and asks what you thought', async () => {
    const h = await mount(createElement(LedgerScreen, { intent: { kind: 'share', text: '链式法则：外层导数乘内层导数。', at: 1 } }));
    expect([...h.querySelectorAll('textarea')].some(t => t.value === '链式法则：外层导数乘内层导数')).toBe(true);
    expect([...h.querySelectorAll('textarea')].some(t => t.value === '链式法则：外层导数乘内层导数。')).toBe(true);
    expect(h.textContent).toContain('你当时自己是怎么想的？');
  });
});

describe('the app on first open', () => {
  it('shows the welcome until you say who you are, then the ledger', async () => {
    const { App } = await import('../src/App');
    const h = await mount(createElement(App));
    expect(h.querySelector('[data-testid=welcome]')).not.toBeNull();
    expect(h.querySelector('nav.tabbar')).toBeNull();
    await click(button(h, '做科研'));
    await click(button(h, '先跳过'));
    expect(h.querySelector('[data-testid=welcome]')).toBeNull();
    expect(h.querySelector('nav.tabbar')).not.toBeNull();
    expect(await preferencesKV.get('mindledger.board.v1')).toBe('科研');
  });
});
