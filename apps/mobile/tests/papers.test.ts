// @vitest-environment jsdom
// 文献对照: 查重提醒 and 综述矛盾点 over the papers kept on the phone.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { conflicts, sameAs } from '../src/rules/overlap';
import { loadShelf, shelve, SHELF_MAX } from '../src/local/shelf';
import { preferencesKV } from '../src/storage/kv';
import { PapersScreen } from '../src/screens/PapersScreen';
import { book } from '../src/ledger/book';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

const A = { name: '论文甲', pages: ['引言。', '我们发现每天午睡二十分钟会显著提高大学生下午的记忆成绩。样本为 120 名学生。'] };
const B = { name: '论文乙', pages: ['在 80 名受试者中，每天午睡二十分钟会显著降低大学生下午的记忆成绩。'] };
const C = { name: '论文丙', pages: ['咖啡因摄入与睡眠质量之间的关系仍需进一步研究，本研究没有测量记忆。'] };

describe('查重提醒', () => {
  it('flags a sentence copied from a paper with its page, and leaves quoted and own sentences alone', () => {
    const draft = '每天午睡二十分钟会显著提高大学生下午的记忆成绩。「每天午睡二十分钟会显著提高大学生下午的记忆成绩。」我打算换一个年龄段再做一次。';
    const s = sameAs(draft, [A, C]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ paper: '论文甲', page: 2 });
    expect(s[0].same).toBeGreaterThanOrEqual(70);
  });
});

describe('综述矛盾点', () => {
  it('pairs two papers that say opposite things about the same thing, with pages', () => {
    const c = conflicts([A, B, C]);
    expect(c).toHaveLength(1);
    expect(c[0].a).toMatchObject({ paper: '论文甲', page: 2 });
    expect(c[0].b).toMatchObject({ paper: '论文乙', page: 1 });
  });
  it('finds nothing when the papers agree or talk about something else', () => {
    expect(conflicts([A, C])).toEqual([]);
  });
});

describe('书架', () => {
  it('keeps the newest few, newest first, one copy each', async () => {
    for (let i = 0; i < SHELF_MAX + 2; i++) await shelve(preferencesKV, { versionId: `v${i}`, name: `p${i}`, pages: ['x'] });
    await shelve(preferencesKV, { versionId: 'v3', name: 'p3', pages: ['x'] });
    const s = await loadShelf(preferencesKV);
    expect(s.map(p => p.versionId)).toEqual(['v3', 'v6', 'v5', 'v4', 'v2']);
  });
  it('the screen lists the papers, flags copied sentences and books a contradiction as a debt', async () => {
    await shelve(preferencesKV, { versionId: 'b', ...B });
    await shelve(preferencesKV, { versionId: 'a', ...A });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(PapersScreen)); }); await flush();
    expect(host.textContent).toContain('《论文甲》，2 页');
    const ta = host.querySelector('[data-testid=draft]') as HTMLTextAreaElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, '我们发现每天午睡二十分钟会显著提高大学生下午的记忆成绩。'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    const btn = (t: string) => [...host!.querySelectorAll('button')].find(b => b.textContent === t)!;
    await act(async () => { btn('查一查').click(); });
    expect(host.querySelector('[data-testid=same]')!.textContent).toContain('《论文甲》第 2 页');
    await act(async () => { btn('找一找').click(); });
    expect(host.querySelectorAll('[data-testid=conflicts] li')).toHaveLength(1);
    await act(async () => { btn('记一笔：讲讲哪个对').click(); }); await flush();
    const es = await book.all();
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ board: '科研', helpLevel: 'hint' });
    expect(es[0].question).toContain('说法相反');
  });
});
