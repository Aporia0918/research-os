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

/**
 * Squash and spring back, anchored where the element's transform-origin is. `amount` 0 is at rest, 1 is fully squashed
 * to `shape` [scaleX, scaleY]; overshoot past 0 is the wobble. Uses the individual `scale` property, so it adds to any
 * CSS transform or translate the element already has. Returns a ref for the element and press / release / pop.
 */
export function useSquash<T extends HTMLElement>(shape: [number, number], release: SpringSpec) {
  const ref = useRef<T | null>(null);
  const st = useRef({ u: 0, v: 0, stop: () => {}, pop: 0 as ReturnType<typeof setTimeout> | 0 });
  const [sx, sy] = shape;
  const go = useCallback((target: number, spec: SpringSpec) => {
    const s = st.current; s.stop();
    s.stop = runSpring(s.u, target, spec, (x, v) => {
      s.u = x; s.v = v;
      if (ref.current) ref.current.style.scale = `${1 + (sx - 1) * x} ${1 + (sy - 1) * x}`;
    }, s.v);
  }, [sx, sy, release]); // eslint-disable-line react-hooks/exhaustive-deps
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
