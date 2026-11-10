// @vitest-environment jsdom
// 零世界考试 on the phone: wording and strip from the report, the approval call, and the whole screen flow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ResearchOsClient, type FetchLike } from '../src/api/computer';
import { describePower, describeVerdict, examPayload, phase, plannedRuns, powerPayload, retake, strip, type ExamReport, type PowerReport, type Task } from '../src/logic/nullworld';
import { ExamScreen } from '../src/screens/ExamScreen';
import { auditHeadline, describeFinding } from '../src/logic/audit';
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
  it('counts planned runs and words the detection rate from the full-sample rows', () => {
    const i = { script: '/p/s.py', data: '/p/d.csv', group: 'subject', label: 'af', runs: 19, seed: 0 };
    expect(plannedRuns(task('queued', { payload: examPayload(i) }))).toBe(20);
    expect(plannedRuns(task('queued', { kind: 'nullworld.power', payload: powerPayload(i) }))).toBe(2 * 20 * 4);
    const row = (groups: number, effect: number, detected: number) =>
      ({ groups, effect, detected, runs: 20, rate: detected / 20, low: 0, high: 1 });
    const rep = (rows: PowerReport['rows']): PowerReport => ({ rows, features: ['rr'], seed: 0, errors: [] });
    const ok = describePower(rep([row(30, 0.8, 20), row(60, 0.2, 3), row(60, 0.5, 17), row(60, 0.8, 20)]));
    expect(ok).toMatchObject({ tone: 'ok', title: expect.stringContaining('60') });
    expect(ok.title).toContain('0.5');
    expect(describePower(rep([row(60, 0.2, 1), row(60, 0.8, 9)])).title).toContain('只检出 9');
    expect(describePower(rep([{ ...row(60, 0.8, 0), rate: null }])).tone).toBe('warn');
  });
  it('words rule-check findings by code and keeps unknown codes visible', () => {
    expect(describeFinding({ code: 'R1.random_split', rule: 'R1', severity: 'red', line: 11 }).what).toContain('同一个人');
    expect(describeFinding({ code: 'R9.new', rule: 'R9', severity: 'yellow', line: 1 })).toEqual({ what: 'R9.new', fix: '' });
    expect(auditHeadline({ file: 's.py', status: 'green', findings: [] }).tone).toBe('ok');
    expect(auditHeadline({ file: 's.py', status: 'red', findings: [] }).tone).toBe('bad');
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
      if (url.endsWith('/tasks')) { state = { ...state, payload: JSON.parse(init!.body as string).payload }; return json(state, 202); }
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

  it('measures the detection rate before the exam', async () => {
    await saveComputerSettings(preferencesKV, { enabled: true, url: 'http://computer:1' });
    let state = task('awaiting_approval', { kind: 'nullworld.power' });
    const created: unknown[] = [];
    const power: PowerReport = { rows: [{ groups: 60, effect: 0.8, detected: 19, runs: 20, rate: 0.95, low: 0.76, high: 0.99 }], features: ['rr'], seed: 0, errors: [] };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.endsWith('/null-world/detect')) return json({ data: '/p/d.csv', rows: 300, columns: ['subject', 'af', 'rr'], groups: [{ column: 'subject', score: 2, reason: '' }], labels: [{ column: 'af', score: 2, reason: '' }], features: ['rr'] });
      if (url.endsWith('/leak-audit/script')) return json({ file: 's.py', status: 'red', findings: [{ code: 'R1.random_split', rule: 'R1', severity: 'red', line: 11 }] });
      if (url.endsWith('/tasks')) { created.push(JSON.parse(init!.body as string)); state = { ...state, payload: (created[0] as { payload: Record<string, unknown> }).payload }; return json(state, 202); }
      if (url.includes('subject-hash')) return json({ hash: 'h' });
      if (url.endsWith('/approvals')) { state = { ...state, state: 'succeeded', result: power }; return json({}, 201); }
      return json(state);
    });
    const h = await mount();
    const [script, data] = [...h.querySelectorAll('input')];
    await type(script, '/p/s.py'); await type(data, '/p/d.csv');
    await act(async () => { button(h, '认结构').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-audit]')?.textContent).toContain('第 11 行');
    await act(async () => { button(h, '先测检出率').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-audit]')).toBeNull(); // the rule check sits with the set-up, not the run
    expect(created[0]).toMatchObject({ kind: 'nullworld.power', payload: { effects: [0.2, 0.5, 0.8], fractions: [0.5, 1] } });
    expect(h.querySelector('[data-testid=exam-approve]')?.textContent).toContain('160 次');
    await act(async () => { button(h, '批准运行').click(); }); await flush();
    expect(h.querySelector('[data-testid=exam-power]')?.textContent).toContain('19/20');
    expect(button(h, '开始考试')).toBeTruthy();
  });
});
