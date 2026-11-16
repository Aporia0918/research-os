// @vitest-environment jsdom
// 生活板块: the risk word list and its scores on the developers' own sentences, the fixed care message, the light ledger
// in its own table, and the screen (care first, no record of what was said, the model checked twice).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/life/risk.json';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CARE, HOTLINE, decision, redact, risk, unsafe } from '../src/rules/life';
import { LifeBook, monday } from '../src/ledger/life';
import { Book } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';
import { LifeScreen, type LifeModel } from '../src/screens/LifeScreen';
import { LedgerScreen } from '../src/screens/LedgerScreen';

const FX: Record<'dev' | 'heldout', { text: string; risk: boolean }[]> = fixture;

describe('risk word list', () => {
  // dev was written with the list; the list was frozen before heldout was written, and heldout was scored once.
  it.each([['dev', 10, 1], ['heldout', 3, 1]] as const)('%s: caught and false alarms are pinned', (set, caught, alarms) => {
    const xs = FX[set];
    expect(xs.filter(x => x.risk).length).toBe(10);
    expect(xs.filter(x => x.risk && risk(x.text)).length).toBe(caught);
    expect(xs.filter(x => !x.risk && risk(x.text)).length).toBe(alarms);
  });
  it('everyday idioms are excused, nothing else', () => {
    for (const t of ['累死了', '笑死我了', '电脑死机了', '气死我了', '秒杀']) expect(risk(t)).toBe(false);
    expect(risk('累死了，真的不想活了')).toBe(true);
  });
  it('the care message is fixed: the hotline, then 120 and 110, and someone you trust', () => {
    expect(HOTLINE).toBe('12356');
    expect(CARE).toContain('12356');
    expect(CARE).toMatch(/120 或 110/);
    expect(CARE).toContain('信任的人');
    expect(CARE).not.toMatch(/[他她]/);
    expect(CARE).not.toMatch(/保密|诊断/);
  });
});

describe('decisions, replies and what leaves the phone', () => {
  it('tells a decision handed to the AI from one the user made, and stays silent when unsure', () => {
    expect(decision('你帮我决定周末去不去聚会')).toBe('ai');
    expect(decision('帮我回一下这条消息')).toBe('ai');
    expect(decision('我决定不去了')).toBe('own');
    expect(decision('我想好了，请半天假')).toBe('own');
    expect(decision('今天好累')).toBeNull();
    expect(decision('我决定不了，你帮我选')).toBeNull(); // both: unsure, not recorded
  });
  it('a reply may not promise lasting company, miss the user, play a partner or diagnose', () => {
    for (const r of ['我会一直陪着你的', '想你了', '宝贝别难过', '你有抑郁症']) expect(unsafe(r)).toBe(true);
    expect(unsafe('听起来这周压力很大。哪件事最让你担心？')).toBe(false);
  });
  it('masks phone numbers, ID numbers and e-mail before a model sees the text', () => {
    expect(redact('打 13812345678 或发 a.b@x.cn，证件 11010119900101123X')).toBe('打 [手机号] 或发 [邮箱]，证件 [证件号]');
  });
});

describe('生活这本账', () => {
  it('keeps one line per decision in its own table; a week runs Monday to Sunday', async () => {
    const kv = memoryKV();
    const life = new LifeBook(kv);
    expect(monday('2026-11-16')).toBe('2026-11-16');
    expect(monday('2026-11-22')).toBe('2026-11-16');
    await life.add('own', '  请半天假  ', '2026-11-17', 'a');
    await life.add('ai', '周末聚会去不去', '2026-11-18', 'b');
    await life.add('own', '这条太长'.repeat(20), '2026-11-19', 'c');
    expect(await life.add('own', '   ', '2026-11-19', 'd')).toBeNull();
    await life.add('own', '上周的事', '2026-11-15', 'e');
    expect(await life.week('2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22', own: 2, ai: 1, balance: 1, named: '这条太长'.repeat(7) + '这条' });
    expect((await life.all()).map(d => d.title)).toContain('请半天假');
    await new Book(kv).add({ clientId: 'x', board: '学习', question: '换元积分', helpLevel: 'answer' }, '2026-11-17');
    await life.clear();
    expect(await life.all()).toEqual([]);
    expect(await new Book(kv).all()).toHaveLength(1); // the debt ledger is another table
    await expect(new Book(kv).add({ clientId: 'y', board: '生活', question: 'q', helpLevel: 'answer' }, '2026-11-17')).rejects.toThrow('life_has_its_own_book');
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
async function say(h: HTMLElement, text: string) {
  type(h.querySelector('[data-testid=life-chat] textarea'), text);
  await act(async () => { button(h, '说完了')!.click(); });
  await flush();
}

describe('生活 screen', () => {
  it('a risk message gets the fixed care message at once, with no model call and nothing to record', async () => {
    const model: LifeModel = { reply: vi.fn(async () => '嗯'), flag: vi.fn(async () => false) };
    const h = await mount(createElement(LifeScreen, { model }));
    await say(h, '我决定了，不想活了');
    expect(h.querySelector('[data-testid=life-care]')?.textContent).toContain('12356');
    expect(model.reply).not.toHaveBeenCalled();
    expect(h.querySelector('[data-testid=life-record]')).toBeNull();
  });
  it('the model is a second risk check, and an unsafe reply is asked again', async () => {
    const flag = vi.fn(async (t: string) => t.includes('累赘'));
    const reply = vi.fn().mockResolvedValue('嗯').mockResolvedValueOnce('我会一直陪着你').mockResolvedValueOnce('听起来很累。今晚最想先放下哪件事？');
    const h = await mount(createElement(LifeScreen, { model: { reply, flag } }));
    await say(h, '复习不完，有点崩');
    expect(h.textContent).toContain('今晚最想先放下哪件事？');
    expect(h.textContent).not.toContain('一直陪着你');
    await say(h, '我觉得自己是个累赘');
    expect(h.querySelector('[data-testid=life-care]')).not.toBeNull();
  });
  it('a decision is offered as one line to record; the week card counts it', async () => {
    const h = await mount(createElement(LifeScreen, { model: null }));
    await say(h, '我想好了，明天社团活动请半天假');
    expect(h.textContent).toContain('我在听。');
    const card = h.querySelector('[data-testid=life-record]');
    expect(card?.textContent).toContain('记一笔：自己拿的主意');
    type(card!.querySelector('input'), '请半天假');
    await act(async () => { button(h, '记下')!.click(); });
    await flush();
    expect(h.querySelector('[data-testid=life-week]')?.textContent).toContain('这周你自己拿了 1 个主意，0 个交给了我，生活这本账结余 +1。「请半天假」那次是你自己定的。');
  });
  it('asks once, after eight messages, whether a friend has heard this', async () => {
    const h = await mount(createElement(LifeScreen, { model: null }));
    for (let i = 0; i < 8; i++) await say(h, `第 ${i} 句`);
    expect(h.textContent).toContain('这事和朋友或家里人说过吗？');
  });
  it('the ledger screen switches boards; 生活 shows the chat, not the debts', async () => {
    const h = await mount(createElement(LedgerScreen));
    expect(h.textContent).toContain('考前真实掌握度');
    await act(async () => { [...h.querySelectorAll<HTMLButtonElement>('[data-testid=board-switch] button')].find(b => b.textContent === '生活')!.click(); });
    await flush();
    expect(h.querySelector('[data-testid=life-chat]')).not.toBeNull();
    expect(h.textContent).not.toContain('考前真实掌握度');
  });
});
