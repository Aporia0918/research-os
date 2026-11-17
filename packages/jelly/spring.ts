// A damped spring (mass 1), the same model as Compose's spring(dampingRatio, stiffness), so the numbers in the spec mean
// what they mean there. Values are written straight to the element's style each frame: no React render per frame.
import { useCallback, useEffect, useRef } from 'react';

export interface SpringSpec { dampingRatio: number; stiffness: number }
/** Compose's Spring.StiffnessMedium: used where the spec gives only a damping ratio. */
export const STIFFNESS_MEDIUM = 1500;
/** The quick, no-bounce move into a squash (pressing down). */
export const QUICK: SpringSpec = { dampingRatio: 1, stiffness: 2200 };

/** One step of the spring toward `target`. Semi-implicit Euler; callers keep `dt` at a few milliseconds. */
export function springStep(x: number, v: number, target: number, s: SpringSpec, dt: number): [number, number] {
  const a = -s.stiffness * (x - target) - 2 * s.dampingRatio * Math.sqrt(s.stiffness) * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

const frame = (cb: (t: number) => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(() => cb(performance.now()), 16) as unknown as number);
const cancel = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

/** Runs the spring from `from` to `to`, calling `onFrame` every animation frame until it rests. Returns a stop function. */
export function runSpring(from: number, to: number, s: SpringSpec, onFrame: (x: number, v: number) => void, v0 = 0): () => void {
  let x = from, v = v0, last = performance.now(), id = 0;
  const tick = (now: number) => {
    let dt = Math.min(0.064, Math.max(0, (now - last) / 1000)); last = now;
    while (dt > 0) { const h = Math.min(0.004, dt); [x, v] = springStep(x, v, to, s, h); dt -= h; }
    const rest = Math.abs(x - to) < 1e-4 && Math.abs(v) < 1e-3;
    if (rest) { x = to; v = 0; }
    onFrame(x, v);
    if (!rest) id = frame(tick);
  };
  id = frame(tick);
  return () => cancel(id);
}

interface Squash { u: number; v: number; stop: () => void }
/** Moves `el` toward squash `target` (0 rest, 1 = `shape`) on spring `spec`, carrying the current speed over. */
function squashTo(el: () => HTMLElement | null, st: Squash, shape: [number, number], target: number, spec: SpringSpec) {
  st.stop();
  st.stop = runSpring(st.u, target, spec, (x, v) => {
    st.u = x; st.v = v;
    const e = el(); if (e) e.style.scale = `${1 + (shape[0] - 1) * x} ${1 + (shape[1] - 1) * x}`;
  }, st.v);
}

/**
 * Squash and spring back, anchored where the element's transform-origin is. `amount` 0 is at rest, 1 is fully squashed
 * to `shape` [scaleX, scaleY]; overshoot past 0 is the wobble. Uses the individual `scale` property, so it adds to any
 * CSS transform or translate the element already has. Returns a ref for the element and press / release / pop.
 */
export function useSquash<T extends HTMLElement>(shape: [number, number], release: SpringSpec) {
  const ref = useRef<T | null>(null);
  const st = useRef<Squash & { pop: ReturnType<typeof setTimeout> | 0 }>({ u: 0, v: 0, stop: () => {}, pop: 0 });
  const [sx, sy] = shape;
  const go = useCallback((target: number, spec: SpringSpec) => squashTo(() => ref.current, st.current, [sx, sy], target, spec), [sx, sy]);
  const press = useCallback(() => go(1, QUICK), [go]);
  const letGo = useCallback(() => go(0, release), [go, release]);
  /** Squash by `amount` and spring back on its own: a tap, or the squeeze when the mascot changes state. */
  const pop = useCallback((amount = 1) => {
    const s = st.current; if (s.pop) clearTimeout(s.pop);
    go(amount, QUICK);
    s.pop = setTimeout(() => go(0, release), 90);
  }, [go, release]);
  useEffect(() => () => { st.current.stop(); if (st.current.pop) clearTimeout(st.current.pop); }, []);
  return { ref, press, release: letGo, pop };
}

/** The jelly press for plain buttons anywhere on the page: 1.06 / 0.9 from the bottom edge, released on 0.32 / 380. */
export const PRESS_SHAPE: [number, number] = [1.06, 0.9];
export const PRESS_RELEASE: SpringSpec = { dampingRatio: 0.32, stiffness: 380 };

/**
 * One pair of listeners gives every element matching `selector` the jelly press, so existing screens need no change.
 * Returns the function that removes the listeners.
 */
export function jellyPress(selector: string): () => void {
  const live = new WeakMap<HTMLElement, Squash>();
  let held: HTMLElement | null = null;
  const state = (el: HTMLElement) => { let s = live.get(el); if (!s) { s = { u: 0, v: 0, stop: () => {} }; live.set(el, s); } return s; };
  const down = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.(selector) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    held = el; squashTo(() => el, state(el), PRESS_SHAPE, 1, QUICK);
  };
  const up = () => { const el = held; held = null; if (el) squashTo(() => el, state(el), PRESS_SHAPE, 0, PRESS_RELEASE); };
  document.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  return () => { document.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
}
