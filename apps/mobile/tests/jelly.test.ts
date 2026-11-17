// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { springStep, type SpringSpec } from '@jelly/spring';
import { beat } from '../src/jelly/JellySurface';
import { JellyDemo } from '../src/jelly/JellyDemo';
import { ZZ, ZZ_FILES, Zhangzhang, type ZzState } from '../src/jelly/Zhangzhang';
import { THEMES } from '@jelly/theme';

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
    const files = readdirSync(join(__dirname, '../../../packages/jelly/zhangzhang'));
    expect(files).toHaveLength(16);
    for (const f of files) expect(ZZ_FILES.some(u => u.includes(f.replace('.png', '')))).toBe(true);
  });
  it('only the standing and hello pictures blink', () => {
    expect(Object.entries(ZZ).filter(([, z]) => z.blink).map(([k]) => k).sort()).toEqual(['idle', 'wave']);
  });
});

describe('smooth switching', () => {
  it('a state change swaps the picture in the same render and plays one GPU boing', () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    vi.useFakeTimers();
    try {
      host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
      const show = (state: ZzState) => act(() => { root!.render(createElement(Zhangzhang, { state })); });
      show('study');
      expect(animate).not.toHaveBeenCalled(); // no boing on first show
      show('research');
      const zz = host.querySelector('[data-testid=zhangzhang]')!;
      expect(zz.getAttribute('data-state')).toBe('research');
      expect(zz.querySelector('img.zz-in')!.getAttribute('src')).toBe(ZZ.research.img);
      expect(zz.querySelector('img.zz-out')!.getAttribute('src')).toBe(ZZ.study.img);
      expect(animate).toHaveBeenCalledTimes(1);
      const frames = animate.mock.calls[0][0] as Keyframe[];
      for (const f of frames) for (const k of Object.keys(f)) expect(['scale', 'translate', 'offset', 'easing']).toContain(k);
      act(() => { vi.advanceTimersByTime(250); });
      expect(zz.querySelector('img.zz-out')).toBeNull();
    } finally { vi.useRealTimers(); delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate; }
  });
  it('board colours are not faded across the whole page, only on the background field', () => {
    const page = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
    const jelly = readFileSync(join(__dirname, '../../../packages/jelly/jelly.css'), 'utf8');
    expect(page).not.toMatch(/transition:\s*--/);
    expect(page).not.toMatch(/\)\s*fixed;/); // no fixed body background, which repaints on every scroll
    const fades = [...jelly.matchAll(/^([^{\n]*)\{[^}]*transition:\s*--/gm)].map(m => m[1].trim());
    expect(fades).toEqual(['.jl-bg, .jl-bg i']);
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
