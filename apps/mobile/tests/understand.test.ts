// @vitest-environment jsdom
// 拍一页问一句 → 理解债 (演示第一段的后半): a model answer about the paper books 1 to 3 debts, one per cited page, with
// no extra tap; the user's own reading books nothing; asking twice never books twice; 这次不记 takes them out again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { askDebts, points } from '../src/rules/understand';
import { Book } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';

const paper = { name: '综述.pdf', versionId: 'local-1' };

describe('points: one per cited page', () => {
  it('groups sentences by the page they cite, keeps uncited ones with their neighbours and moves a trailing mark', () => {
    expect(points('先说结论。空间滤波放在分类之前[p.2]。它能提高信噪比。[p.2] 采样率是 128 Hz[p.4]。', [2, 4])).toEqual([
      { pages: [2], text: '先说结论。空间滤波放在分类之前。它能提高信噪比。' },
      { pages: [4], text: '采样率是 128 Hz。' },
    ]);
  });
  it('ignores pages that were never sent, drops "not found" sentences and books nothing without a cited page', () => {
    expect(points('滤波在第 9 页[p.9]。原文没找到采样率。', [2])).toEqual([]);
    expect(points('滤波在分类之前[p.2]。原文里没有提到采样率。', [2])).toEqual([{ pages: [2], text: '滤波在分类之前。' }]);
  });
  it('a fourth page folds into the third debt, so one answer books at most three', () => {
    const got = points('甲[p.1]。乙[p.2]。丙[p.3]。丁[p.5]。', [1, 2, 3, 5]);
    expect(got.map(p => p.pages)).toEqual([[1], [2], [3, 5]]);
    expect(got[2].text).toBe('丙。丁。');
  });
  it('English answers split the same way', () => {
    expect(points('Data were band-pass filtered [p.3]. They were downsampled to 128 Hz [p.3]. EEGNet needs no augmentation [p.20].', [3, 20])
      .map(p => p.pages)).toEqual([[3], [20]]);
  });
});

describe('askDebts on the book', () => {
  const asked = { question: ' 预处理怎么做的 ', answer: '带通滤波 1-40 Hz[p.3]。不需要数据增强[p.20]。', pages: [3, 20], paper, ai: 'deepseek-chat' };

  it('books 科研 理解债 with the page in the question, the AI named, and the same ids on a second ask', async () => {
    const ns = askDebts(asked);
    expect(ns.map(n => [n.board, n.question, n.answer, n.helpLevel, n.ai, n.topic])).toEqual([
      ['科研', '预处理怎么做的（第 3 页）', '带通滤波 1-40 Hz。', 'answer', 'deepseek-chat', '综述.pdf'],
      ['科研', '预处理怎么做的（第 20 页）', '不需要数据增强。', 'answer', 'deepseek-chat', '综述.pdf'],
    ]);
    expect(askDebts(asked).map(n => n.clientId)).toEqual(ns.map(n => n.clientId));
    expect(askDebts({ ...asked, paper: { ...paper, versionId: 'local-2' } })[0].clientId).not.toBe(ns[0].clientId);

    const book = new Book(memoryKV());
    for (const n of [...ns, ...askDebts(asked)]) await book.add(n, '2026-11-17');
    const es = await book.all();
    expect(es).toHaveLength(2);
    expect(es.map(e => [e.weight, e.dueOn])).toEqual([['heavy', '2026-11-18'], ['heavy', '2026-11-18']]);
  });

  it('这次不记 takes out only debts never tried, never synced and never recalled', async () => {
    const book = new Book(memoryKV());
    const [na, nb] = askDebts(asked);
    const a = await book.add(na, '2026-11-17'), b = await book.add(nb, '2026-11-17');
    await book.repay(b.id, '带通滤波', '2026-11-18');
    expect(await book.remove([a.id, b.id])).toBe(1);
    expect((await book.all()).map(e => e.id)).toEqual([b.id]);
  });

  it('a paper debt can be recalled later by another paper (演示第三段)', async () => {
    const book = new Book(memoryKV());
    const [e] = askDebts({ ...asked, answer: '空间滤波应放在分类之前[p.2]。', pages: [2] });
    await book.add(e, '2026-11-17');
    const hits = await book.recallScan({ name: '导师发的综述.pdf', pages: ['综述指出，空间滤波应在分类之后进行。'] }, '2026-11-30');
    expect(hits.map(h => h.question)).toEqual(['预处理怎么做的（第 2 页）']);
  });
});

// ---- screen --------------------------------------------------------------------------------------------------
const ask = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: {} }));
vi.mock('../src/local/paperStore', () => ({
  loadPaper: async () => ({ ref: { versionId: 'local-1', name: '综述.pdf', parseState: 'parsed' }, doc: { numPages: 20, pages: [] } }),
  paperPages: () => [], preparePaper: async () => null, savePaper: async () => undefined,
}));
vi.mock('../src/logic/askLocal', () => ({ askLocal: async () => ask.result, chunks: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

async function askOnScreen(question: string) {
  const { AskScreen } = await import('../src/screens/AskScreen');
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AskScreen, { demo: false })); });
  await flush();
  const t = host.querySelector('textarea')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, question); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { [...host!.querySelectorAll('button')].find(b => b.textContent === '提问')!.click(); });
  await flush();
  return host;
}

describe('ask screen', () => {
  it('a model answer books its debts with no extra tap; 这次不记 takes them out', async () => {
    ask.result = { mode: 'model', text: '带通滤波 1-40 Hz[p.3]。不需要数据增强[p.20]。', pages: [3, 20], passages: [] };
    const h = await askOnScreen('预处理怎么做的');
    const card = h.querySelector('[data-testid=booked]');
    expect(card?.textContent).toContain('记了 2 笔理解债');
    expect(card?.textContent).toContain('预处理怎么做的（第 3 页）');
    const { book } = await import('../src/ledger/book');
    expect(await book.all()).toHaveLength(2);
    await act(async () => { [...h.querySelectorAll('button')].find(b => b.textContent === '这次不记')!.click(); });
    await flush();
    expect(await book.all()).toHaveLength(0);
    expect(h.textContent).toContain('这次的 2 笔没记。');
  });
  it('rule mode is the user reading the original: nothing is booked', async () => {
    ask.result = { mode: 'rules', text: '', pages: [], passages: [{ page: 3, text: '带通滤波', score: 1 }] };
    const h = await askOnScreen('预处理怎么做的');
    expect(h.querySelector('[data-testid=booked]')).toBeNull();
    expect(h.querySelector('[data-testid=not-booked]')?.textContent).toBe('这次是你自己读原文，不记账。');
  });
});
