// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { springStep, type SpringSpec } from '../src/jelly/spring';
import { beat } from '../src/jelly/JellySurface';
import { JellyDemo } from '../src/jelly/JellyDemo';
import { ZZ, ZZ_FILES } from '../src/jelly/Zhangzhang';
import { THEMES } from '../src/jelly/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLElement | null = null;
function mount() {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(JellyDemo, { onExit: () => {} })); });
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const click = (el: Element | undefined) => { if (!el) throw new Error('missing'); act(() => { (el as HTMLElement).click(); }); };
const byText = (h: HTMLElement, sel: string, text: string) => [...h.querySelectorAll(sel)].find(e => e.textContent?.includes(text));

/** Releases from full squash (1) toward rest (0) and counts the visible swings (turning points over 1% of the squash). */
function swings(s: SpringSpec): { swings: number; settle: number } {
  let x = 1, v = 0, t = 0, n = 0, settle = 0;
  while (t < 3) {
    const pv = v;
    [x, v] = springStep(x, v, 0, s, 0.002); t += 0.002;
    if (Math.sign(v) !== Math.sign(pv) && pv !== 0 && Math.abs(x) > 0.01) n++; // a turning point past rest = one swing
    if (Math.abs(x) > 0.01) settle = t;
  }
  return { swings: n, settle };
}

describe('jelly spring', () => {
  it('a card released from a press wobbles back and forth 3–4 times, then stops within a second and a half', () => {
    const r = swings({ dampingRatio: 0.32, stiffness: 380 });
    expect(r.swings).toBeGreaterThanOrEqual(3); expect(r.swings).toBeLessThanOrEqual(4);
    expect(r.settle).toBeLessThan(1.5);
  });
  it('idle beats are 6–9 s and neighbouring cards are out of step', () => {
    const b = [0, 1, 2, 3, 4].map(beat);
    for (const x of b) { expect(x.dur).toBeGreaterThanOrEqual(6); expect(x.dur).toBeLessThanOrEqual(9.1); }
    expect(new Set(b.map(x => x.dur)).size).toBe(5);
  });
});

describe('账账', () => {
  it('uses all 16 pictures, none left out', () => {
    const files = readdirSync(join(__dirname, '../src/jelly/zhangzhang'));
    expect(files).toHaveLength(16);
    for (const f of files) expect(ZZ_FILES.some(u => u.includes(f.replace('.png', '')))).toBe(true);
  });
  it('only the standing and hello pictures blink', () => {
    expect(Object.entries(ZZ).filter(([, z]) => z.blink).map(([k]) => k).sort()).toEqual(['idle', 'wave']);
  });
});

describe('jelly demo page', () => {
  it('shows every state on tap and the board switch changes the theme and the resident look', () => {
    const h = mount();
    const zz = () => h.querySelector('[data-testid=zhangzhang]')!;
    expect(zz().getAttribute('data-state')).toBe('wave');
    for (const [k, z] of Object.entries(ZZ)) {
      if (k === 'life' || k === 'research') continue; // residents of the other boards
      click(byText(h, '.jl-chip', k === 'study' ? '学习板块形象' : z.name));
      expect(zz().getAttribute('data-state')).toBe(k);
      expect(zz().querySelector('img:not(.zz-blink):not(.zz-out)')!.getAttribute('src')).toBe(z.img);
    }
    click(byText(h, '.jl-chip', '学习板块形象'));
    click(byText(h, '.jl-tab', '科研'));
    const page = h.querySelector('[data-testid=jelly-demo]') as HTMLElement;
    expect(page.dataset.board).toBe('科研');
    expect(page.style.getPropertyValue('--accent')).toBe(THEMES.科研.accent);
    expect(zz().getAttribute('data-state')).toBe('research'); // the study resident followed the board
    click(byText(h, '.jl-tab', '生活'));
    expect(zz().getAttribute('data-state')).toBe('life');
    expect(h.querySelector('.zz-confetti')).toBeNull();
    click(byText(h, '.jl-chip', '还清'));
    expect(h.querySelectorAll('.zz-confetti i').length).toBeGreaterThan(10);
  });
});
