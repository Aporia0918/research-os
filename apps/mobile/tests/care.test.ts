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

const FX: Record<'dev' | 'heldout' | 'heldout2' | 'heldout3', { text: string; risk: boolean }[]> = fixture;

describe('risk word list', () => {
  // v1 was written with dev and scored once on heldout (3/10). v2 was tuned on dev and heldout together; heldout2 was
  // committed before that (v1 on it: 4/30 caught, 2/30 false alarms) and v2 was scored on it once (24/30, 1/30). v3 was
  // tuned on dev, heldout and heldout2; heldout3 was committed before that (v2 on it: 9/40 caught, 3/40 false alarms) and
  // v3 was scored on it once. The same people wrote heldout3 and v3, so 37/40 is optimistic; the plan reports both.
  it.each([['dev', 10, 10, 1], ['heldout', 10, 10, 1], ['heldout2', 30, 30, 0], ['heldout3', 40, 37, 3]] as const)('%s: caught and false alarms are pinned', (set, n, caught, alarms) => {
    const xs = FX[set];
    expect(xs.filter(x => x.risk).length).toBe(n);
    expect(xs.filter(x => x.risk && risk(x.text)).length).toBe(caught);
    expect(xs.filter(x => !x.risk && risk(x.text)).length).toBe(alarms);
  });
  it('everyday idioms are excused, nothing else', () => {
    for (const t of ['累死了', '笑死我了', '电脑死机了', '气死我了', '秒杀']) expect(risk(t)).toBe(false);
    expect(risk('累死了，真的不想活了')).toBe(true);
    for (const t of ['卷死了', '社死了', '我们队杀疯了', '这个药能杀死细菌', '我准备了绳子和挂钩，用来晾衣服']) expect(risk(t)).toBe(false);
    for (const t of ['我想 自 杀', '不想活 了', '想去紫砂']) expect(risk(t)).toBe(true);
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
