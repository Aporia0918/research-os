// JellySurface: the clear fruit-jelly material that cards, buttons and the tab bar share (owner's spec ①–⑥, 2026-11-17).
// ① backdrop blur 5px + saturate 150% (white 30% below Android 12) ② c1 14% with a c2 pool at the bottom ③ top gloss
// ④ thick rim: white edge, white inner glow, lilac left / pink right, plus a faint iridescent ring ⑤ a wet highlight that
// follows the finger (screen blend) ⑥ a c2 light spot cast under the bottom edge. Cards drift their corners and float;
// a press squashes from the bottom edge to 1.06 / 0.9 and the release springs back (dampingRatio 0.32, stiffness 380).
import { useRef, type CSSProperties, type HTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import { PRESS_RELEASE, PRESS_SHAPE, useSquash } from '@jelly/spring';

/** Idle beat for the n-th card: 6–9 s periods that never line up between neighbours. */
export function beat(n: number): { dur: number; delay: number } {
  const dur = 6 + ((n * 37) % 31) / 10;
  return { dur, delay: (n * 1.9) % dur };
}

type Tag = 'div' | 'button' | 'nav' | 'section';
interface Props extends HTMLAttributes<HTMLElement> {
  as?: Tag; shape?: 'card' | 'pill'; n?: number; pressable?: boolean; children?: ReactNode;
  type?: 'button'; disabled?: boolean; 'aria-pressed'?: boolean;
}

export function JellySurface({ as = 'div', shape = 'card', n = 0, pressable = as === 'button', className = '', style, children, ...rest }: Props) {
  const squash = useSquash<HTMLElement>(PRESS_SHAPE, PRESS_RELEASE);
  const wet = useRef<HTMLSpanElement | null>(null);
  const b = beat(n);
  const follow = (e: PointerEvent<HTMLElement>, down: boolean) => {
    const el = wet.current; if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - 45, y = e.clientY - r.top - 23; // centre the 90×46 highlight on the finger
    el.style.setProperty('--wx', `${x}px`);
    el.style.setProperty('--wy', `${y}px`);
    el.dataset.on = down ? '1' : '';
  };
  const up = () => { if (wet.current) wet.current.dataset.on = ''; if (pressable) squash.release(); };
  const Tag = as as 'div';
  return (
    <Tag
      ref={squash.ref as never}
      className={`jelly jelly-${shape} ${className}`}
      style={{ ...style, '--beat': `${b.dur}s`, '--beat-at': `-${b.delay}s` } as CSSProperties}
      onPointerDown={(e: PointerEvent<HTMLElement>) => { follow(e, true); if (pressable) squash.press(); }}
      onPointerMove={(e: PointerEvent<HTMLElement>) => { if (wet.current?.dataset.on) follow(e, true); }}
      onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
      {...rest}
    >
      <span className="jelly-spot" aria-hidden="true" />
      <span className="jelly-body" aria-hidden="true">
        <span className="jelly-wet" ref={wet} />
      </span>
      <span className="jelly-in">{children}</span>
    </Tag>
  );
}
