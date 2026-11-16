// @vitest-environment jsdom
// 零世界考试 on the phone: wording and strip from the report, the approval call, and the whole screen flow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ResearchOsClient, type FetchLike } from '../src/api/computer';
import { analysisKey, debtLine, describeVerdict, examPayload, phase, retake, strip, vouch, type ExamReport, type Task } from '../src/logic/nullworld';
import { book } from '../src/ledger/book';
import { ExamScreen } from '../src/screens/ExamScreen';
import { saveComputerSettings } from '../src/settings';
import { preferencesKV } from '../src/storage/kv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (outcome: 'pass' | 'fail', real: number, nulls: number[]): ExamReport => ({
  verdict: { outcome, reason: outcome === 'pass' ? 'real_beats_null' : 'null_above_chance', chance: 0.5, p: 0.05, null_mean: 0.5, null_low: 0.45 },
  real, nulls, naive: [], layout: { mode: 'between', groups: 60, fixed_groups: 0 }, seed: 0, data_sha256: 'a'.repeat(64), script_sha256: 'b'.repeat(64), errors: [],
});
const task = (state: string, extra: Partial<Task> = {}): Task =>
  ({ id: 't1', kind: 'nullworld.exam', state, stage: null, progress: {}, payload: { script: '/p/s.py', data: '/p/d.csv', group: 'subject', label: 'af' }, result: null, error_code: null, ...extra });

describe('null-world logic', () => {
  it('words the verdict by its reason and tone', () => {
    expect(describeVerdict(report('fail', 0.95, [0.9]).verdict)).toMatchObject({ tone: 'bad', title: expect.stringContaining('没通过') });
    expect(describeVerdict(report('pass', 0.8, [0.5]).verdict).tone).toBe('ok');
    expect(describeVerdict({ ...report('pass', 0.8, []).verdict, outcome: 'unsure', reason: 'new_code' }).tone).toBe('warn');
  });
  it('puts nulls, chance and the real score on one 0-100 axis', () => {
    const s = strip(report('pass', 0.9, [0.4, 0.5, 0.6]));
    expect(s.real).toBeGreaterThan(Math.max(...s.nulls));
    expect([...s.nulls, s.chance, s.real!].every(x => x > 0 && x < 100)).toBe(true);
    expect(strip({ ...report('pass', 0.5, [0.5]), real: null }).real).toBeNull();
  });
  it('maps task states to phases and a retake only changes the seed', () => {
    expect(['awaiting_approval', 'queued', 'cancelling', 'interrupted', 'cancelled'].map(s => phase(task(s)))).toEqual(['approve', 'running', 'running', 'failed', 'cancelled']);
    expect(phase(task('succeeded'))).toBe('failed'); // succeeded without a report is not a result
    const i = { script: ' /p/s.py ', data: '/p/d.csv', group: 'subject', label: 'af', runs: 19, seed: 3 };
    expect(retake(i)).toEqual({ ...i, seed: 4 });
    expect(examPayload(i)).toEqual({ script: '/p/s.py', data: '/p/d.csv', group: 'subject', label: 'af', runs: 19, seed: 3 });
  });
  it('names the column that copies the label and keeps one 结论债 per analysis', () => {
    const v = { ...report('fail', 1, [0.5]).verdict, reason: 'feature_copies_label' };
    expect(describeVerdict(v)).toMatchObject({ tone: 'bad', title: '没通过：有一列已经藏着答案' });
    const i = { script: '/p/s.py', data: '/p/d.csv', group: 'subject', label: 'af', runs: 19, seed: 3 };
    expect(analysisKey(retake(i))).toBe(analysisKey(i)); // a retake lands on the same debt
    expect(analysisKey({ ...i, label: 'other' })).not.toBe(analysisKey(i));
    expect(debtLine('fail')).toBe('这个高分还站不住，改好再考一次就还清。');
  });
  it('vouching for a column is a retake that sends it once, on the same debt', () => {
    const i = { script: '/p/s.py', data: '/p/d.csv', group: 'subject', label: 'af', runs: 19, seed: 3 };
    const v = vouch(vouch(i, 'morph'), 'morph');
    expect(v).toMatchObject({ seed: 5, allow: ['morph'] });
    expect(examPayload(v).allow).toEqual(['morph']);
    expect('allow' in examPayload(i)).toBe(false);
    expect(analysisKey(v)).toBe(analysisKey(i));
  });
  it('approves the exact hash the server showed', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body as string | undefined });
      return new Response(JSON.stringify(url.includes('subject-hash') ? { hash: 'h1' } : {}), { status: url.endsWith('/approvals') ? 201 : 200 });
    };
    await new ResearchOsClient('http://computer:1', f).approveTask('t1');
    expect(calls[0].url).toContain('subject_type=task&subject_id=t1');
    expect(JSON.parse(calls[1].body!)).toEqual({ subject_type: 'task', subject_id: 't1', expected_hash: 'h1' });
  });
});

describe('exam screen', () => {
  let root: Root | null = null; let host: HTMLElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); localStorage.clear(); });
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
  async function mount() {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(ExamScreen)); }); await flush();
    return host;
  }
  const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement;
  const type = (el: HTMLInputElement, v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  it('asks for the computer when the link is off', async () => {
    expect((await mount()).textContent).toContain('需要连接电脑');
  });

  it('detects, waits for approval, then shows the verdict', async () => {
    await saveComputerSettings(preferencesKV, { enabled: true, url: 'http://computer:1' });
    let state = task('awaiting_approval');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      sent.push(`${init?.method} ${url.replace('http://computer:1', '')}`);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.endsWith('/null-world/detect')) return json({ data: '/p/d.csv', rows: 300, columns: ['subject', 'af', 'rr'], groups: [{ column: 'subject', score: 2, reason: '' }], labels: [{ column: 'af', score: 2, reason: '' }], features: ['rr'] });
      if (url.endsWith('/tasks')) return json(state, 202);
      if (url.includes('subject-hash')) return json({ hash: 'h' });
      if (url.endsWith('/approvals')) { state = task('succeeded', { result: report('fail', 0.96, Array(19).fill(0.9)) }); return json({}, 201); }
      return json(state);
    });
    const h = await mount();
    const [script, data] = [...h.querySelectorAll('input')];
    await type(script, '/p/s.py'); await type(data, '/p/d.csv');
    await act(async () => { button(h, '认结构').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-columns] [aria-checked=true]')?.textContent).toBe('subject');
    await act(async () => { button(h, '开始考试').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-approve]')?.textContent).toContain('20 次');
    expect(sent.filter(s => s.includes('/approvals'))).toEqual([]); // nothing approved before the tap
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-verdict]')?.textContent).toContain('没通过');
    expect(button(h, '复考（换一批零世界）')).toBeTruthy();
  });

  it('崩分 books a red 结论债 on the research board; a passing retake repays the same debt (演示第二段)', async () => {
    await saveComputerSettings(preferencesKV, { enabled: true, url: 'http://computer:1' });
    const leak = { ...report('fail', 1, Array(19).fill(0.5)), suspects: [{ column: 'morph', reason: 'separates_label' as const, gap_sd: 25 }] };
    leak.verdict = { ...leak.verdict, reason: 'feature_copies_label' };
    const results = [leak, report('pass', 0.9, Array(19).fill(0.5))];
    let state = task('awaiting_approval');
    vi.stubGlobal('fetch', async (url: string) => {
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.endsWith('/null-world/detect')) return json({ data: '/p/features.csv', rows: 480, columns: ['subject', 'af', 'morph'], groups: [{ column: 'subject', score: 2, reason: '' }], labels: [{ column: 'af', score: 2, reason: '' }], features: ['morph'] });
      if (url.endsWith('/tasks')) { state = task('awaiting_approval', { id: `t${results.length}` }); return json(state, 202); }
      if (url.includes('subject-hash')) return json({ hash: 'h' });
      if (url.endsWith('/approvals')) { state = { ...state, state: 'succeeded', result: results.shift()! }; return json({}, 201); }
      return json(state);
    });
    const h = await mount();
    const [script, data] = [...h.querySelectorAll('input')];
    await type(script, '/p/train.py'); await type(data, '/p/features.csv');
    await act(async () => { button(h, '认结构').click(); }); await flush();
    expect((h.querySelector('[data-testid=exam-columns] input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
    await act(async () => { button(h, '开始考试').click(); }); await flush();
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-suspects]')?.textContent).toContain('morph');
    expect(h.querySelector('[data-testid=exam-debt]')?.textContent).toBe('这个高分还站不住，改好再考一次就还清。');
    const [owed] = await book.all();
    expect(owed).toMatchObject({ board: '科研', kind: 'conclusion', red: true, question: 'train.py 在 features.csv 上跑出的结论' });
    await act(async () => { button(h, '复考（换一批零世界）').click(); }); await flush();
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-debt]')?.textContent).toContain('结论债已还清');
    const all = await book.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ red: false, dueOn: null, attempts: 2 });
  });

  it('这列是真实测量：the retake names the vouched column on the approval card and in what is sent', async () => {
    await saveComputerSettings(preferencesKV, { enabled: true, url: 'http://computer:1' });
    const leak = { ...report('fail', 1, Array(19).fill(0.5)), suspects: [{ column: 'morph', reason: 'separates_label' as const, gap_sd: 25 }] };
    leak.verdict = { ...leak.verdict, reason: 'feature_copies_label' };
    const results = [leak, report('pass', 0.9, Array(19).fill(0.5))];
    const posted: Record<string, unknown>[] = [];
    let state = task('awaiting_approval');
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.endsWith('/null-world/detect')) return json({ data: '/p/features.csv', rows: 480, columns: ['subject', 'af', 'morph'], groups: [{ column: 'subject', score: 2, reason: '' }], labels: [{ column: 'af', score: 2, reason: '' }], features: ['morph'] });
      if (url.endsWith('/tasks')) {
        const { payload } = JSON.parse(init!.body as string) as { payload: Record<string, unknown> };
        posted.push(payload);
        state = task('awaiting_approval', { id: `t${posted.length}`, payload }); return json(state, 202);
      }
      if (url.includes('subject-hash')) return json({ hash: 'h' });
      if (url.endsWith('/approvals')) { state = { ...state, state: 'succeeded', result: results.shift()! }; return json({}, 201); }
      return json(state);
    });
    const h = await mount();
    const [script, data] = [...h.querySelectorAll('input')];
    await type(script, '/p/train.py'); await type(data, '/p/features.csv');
    await act(async () => { button(h, '认结构').click(); }); await flush();
    await act(async () => { button(h, '开始考试').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-allow]')).toBeNull();
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    await act(async () => { button(h, '这列是真实测量，重考').click(); }); await flush();
    expect(posted.map(p => [p.seed, p.allow])).toEqual([[0, undefined], [1, ['morph']]]);
    expect(h.querySelector('[data-testid=exam-allow]')?.textContent).toBe('你确认是真实测量、不查抄标签的列：morph');
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-debt]')?.textContent).toContain('结论债已还清');
    expect(await book.all()).toHaveLength(1);
  });
});
