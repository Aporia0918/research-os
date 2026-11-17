// @vitest-environment jsdom
// The safety floor, app-wide: the risk word list and its scores on the developers' own sentences, the fixed care
// message, and what a hit does where the user types (care shown, nothing booked).
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/care/risk.json';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CARE, HOTLINE, risk } from '../src/rules/care';
import { book } from '../src/ledger/book';
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
let root: Root | null = null; let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

describe('where the user types', () => {
  it('记一笔 with a risk sentence shows the care message and books nothing', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(LedgerScreen, { intent: { kind: 'share', text: '我真的不想活了', at: 1 } })); }); await flush();
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === '记下');
    await act(async () => { save!.click(); }); await flush();
    expect(host.querySelector('[data-testid=care]')!.textContent).toContain('12356');
    expect(await book.all()).toEqual([]);
  });
});
