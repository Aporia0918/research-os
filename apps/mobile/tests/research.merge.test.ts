// @vitest-environment jsdom
// 科研 merges (板块修改总结): experiment data files on a record, a paper's code and data links hung on its debts, GB/T 7714
// references, and meeting minutes turned into questions to book. Rules only; nothing is booked or kept unchosen.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { cleanLink, findLinks, kindOf } from '../src/rules/paperLinks';
import { author, authorList, complete, gbt7714, guessRef } from '../src/rules/gbt7714';
import { minuteItems, MINUTES_MAX } from '../src/rules/minutes';
import { allRefs, linksFor, saveRef, setLinks } from '../src/local/paperExtras';
import { fmtSize, safeName } from '../src/local/expFiles';
import { LogQueue } from '../src/storage/queue';
import { memoryKV } from '../src/storage/kv';
import { book } from '../src/ledger/book';
import { LogScreen } from '../src/screens/LogScreen';

describe('a paper\'s code and data links', () => {
  it('finds the links a paper prints for code and data, once each, code first, with the page', () => {
    const pages = [
      'Abstract. We release data at https://doi.org/10.5281/zenodo.123456.',
      'Code: github.com/lab/eeg-fnirs-net, and see https://www.example.com/about for the lab. Data on\nhttps://openneuro.org/datasets/ds004000; mirror 10.6084/m9.figshare.99.',
      'As before, https://github.com/lab/eeg-fnirs-net.',
    ];
    expect(findLinks(pages)).toEqual([
      { kind: 'code', url: 'https://github.com/lab/eeg-fnirs-net', page: 2 },
      { kind: 'dataset', url: 'https://doi.org/10.5281/zenodo.123456', page: 1 },
      { kind: 'dataset', url: 'https://openneuro.org/datasets/ds004000', page: 2 },
      { kind: 'dataset', url: 'https://doi.org/10.6084/m9.figshare.99', page: 2 },
    ]);
    expect(kindOf('https://www.example.com/about')).toBeNull();
    expect(cleanLink('javascript:alert(1)')).toBeNull();
    expect(cleanLink('http://gitee.com/a/b/')).toBe('https://gitee.com/a/b');
  });
  it('keeps each paper\'s links under its name, once each; an empty list removes them', async () => {
    const kv = memoryKV();
    await setLinks(kv, 'P', [{ kind: 'code', url: 'https://github.com/a/b' }, { kind: 'code', url: 'https://GITHUB.com/a/b' }]);
    expect(await linksFor(kv, 'P')).toHaveLength(1);
    await setLinks(kv, 'P', []);
    expect(await linksFor(kv, 'P')).toEqual([]);
  });
});

describe('GB/T 7714 references', () => {
  it('writes Latin names as SURNAME and initials, Chinese names as written, three then et al / 等', () => {
    expect(author('John A. Smith')).toBe('SMITH J A');
    expect(author('Smith, John')).toBe('SMITH J');
    expect(author('张三')).toBe('张三');
    expect(authorList(['A B', 'C D', 'E F', 'G H'], 'Deep decoding')).toBe('B A, D C, F E, et al');
    expect(authorList(['张三', '李四', '王五', '赵六'], '脑机接口解码')).toBe('张三, 李四, 王五, 等');
  });
  it('a journal and a conference line, leaving out what is missing', () => {
    expect(gbt7714({ type: 'J', authors: ['Wei Zhang', 'Li Na'], title: 'Hybrid EEG-fNIRS decoding', source: 'Journal of Neural Engineering',
      year: '2024', volume: '21', issue: '3', pages: '036012–036020', doi: '10.1088/1741-2552/ad0001' }))
      .toBe('ZHANG W, NA L. Hybrid EEG-fNIRS decoding[J]. Journal of Neural Engineering, 2024, 21(3): 036012-036020. DOI: 10.1088/1741-2552/ad0001.');
    expect(gbt7714({ type: 'C', authors: [], title: '一种解码方法', source: '中国生物医学工程大会论文集', year: '2023' }))
      .toBe('一种解码方法[C]//中国生物医学工程大会论文集, 2023.');
  });
  it('guesses only the DOI and year from the paper, and needs title, source and year to export', async () => {
    const g = guessRef('decoding.pdf', ['Published 2025. https://doi.org/10.1000/xyz123.', 'more']);
    expect(g).toMatchObject({ title: 'decoding', year: '2025', doi: '10.1000/xyz123', source: '' });
    expect(complete(g)).toBe(false);
    const kv = memoryKV();
    await saveRef(kv, 'v1', { ...g, source: 'J' });
    expect((await allRefs(kv)).v1.source).toBe('J');
  });
});

describe('meeting minutes to questions', () => {
  it('turns decisions, tasks and claims into questions, in order, at most eight', () => {
    const items = minuteItems('1. 滤波统一改成 0.5–40 Hz。\n- 下周重跑被试 3 的数据\n今天天气不错\n结果说明 fNIRS 加进来准确率提高了 6%；好');
    expect(items.map(i => i.kind)).toEqual(['decision', 'todo', 'claim']);
    expect(items[0].question).toBe('组会定了「滤波统一改成 0.5–40 Hz」：为什么这么定？换别的做法会怎样？');
    expect(minuteItems(Array.from({ length: 20 }, (_, i) => `需要检查第 ${i} 组数据`).join('\n'))).toHaveLength(MINUTES_MAX);
  });
});

describe('experiment data files', () => {
  it('stores safe names and lists files on a record', async () => {
    expect(safeName('../a/b<c>.csv')).toBe('b_c_.csv');
    expect(safeName(`${'x'.repeat(100)}.edf`)).toHaveLength(80);
    expect(fmtSize(2_500_000)).toBe('2.4 MB');
    const q = new LogQueue(memoryKV());
    const e = await q.add({ kind: 'data', note: '被试 3' });
    await q.setFiles(e.id, [{ name: 's3.csv', path: 'experiments/x/s3.csv', size: 10 }]);
    expect((await q.all())[0].files).toHaveLength(1);
    await q.setFiles(e.id, []);
    expect((await q.all())[0].files).toBeUndefined();
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

describe('组会纪要 on the record screen', () => {
  it('books only the questions the user ticks, as 科研 debts', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(LogScreen)); }); await flush();
    const area = host.querySelector<HTMLTextAreaElement>('[data-testid=minutes] textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '滤波统一改成 0.5–40 Hz。下周重跑被试 3 的数据。'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    const btn = (t: string) => [...host!.querySelectorAll('button')].find(b => b.textContent === t)!;
    await act(async () => { btn('找出要核对的').click(); }); await flush();
    const boxes = host.querySelectorAll<HTMLInputElement>('[data-testid=minutes] input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    await act(async () => { boxes[1].click(); }); await flush();
    await act(async () => { btn('记进科研账本（1 笔）').click(); }); await flush();
    const es = await book.all();
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ board: '科研', answer: '下周重跑被试 3 的数据' });
    expect(es[0].topic).toMatch(/^组会 \d\d-\d\d$/);
  });
});
