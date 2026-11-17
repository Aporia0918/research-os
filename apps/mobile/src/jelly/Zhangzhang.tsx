// 账账, the mascot (owner's 16 pictures, used unchanged). All motion is code: breathing from the feet, random blinks,
// a squash-and-spring tap, a jelly boing on every state change (squash, the picture swaps at the bottom of it, stretch
// up, settle) and one motion per state (jelly.css). The boing runs as a Web Animation on scale and translate only, so the
// GPU plays it even while the page is busy re-rendering for a board switch; all 16 pictures are decoded up front, so a
// new look never waits for its file.
// The shadow and the mint light under the feet are drawn here, not in the pictures. Feet sit at y 481 of 512 in every
// picture, so every transform is anchored at 50% 94%.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { tr } from '../i18n';
import { STIFFNESS_MEDIUM, useSquash } from './spring';
import hero from './zhangzhang/zhangzhang_hero.png';
import heroBlink from './zhangzhang/zhangzhang_hero_blink.png';
import wave from './zhangzhang/zhangzhang_wave.png';
import waveBlink from './zhangzhang/zhangzhang_wave_blink.png';
import waveSmile from './zhangzhang/zhangzhang_wave_smile.png';
import write from './zhangzhang/zhangzhang_write.png';
import dun from './zhangzhang/zhangzhang_dun.png';
import paid from './zhangzhang/zhangzhang_paid.png';
import think from './zhangzhang/zhangzhang_think.png';
import confused from './zhangzhang/zhangzhang_confused.png';
import sleepy from './zhangzhang/zhangzhang_sleepy.png';
import hug from './zhangzhang/zhangzhang_hug.png';
import life from './zhangzhang/zhangzhang_life.png';
import study from './zhangzhang/zhangzhang_study.png';
import research from './zhangzhang/zhangzhang_research.png';
import lens from './zhangzhang/zhangzhang_research_lens.png';

export type ZzState = 'idle' | 'wave' | 'smile' | 'write' | 'dun' | 'paid' | 'think' | 'confused' | 'sleepy' | 'hug'
  | 'life' | 'study' | 'research' | 'lens';

/** Picture, closed-eye frame (if any) and what the state means, from the owner's spec. */
export const ZZ: Record<ZzState, { img: string; blink?: string; name: string; when: string }> = {
  idle: { img: hero, blink: heroBlink, name: '待机', when: '平时就这样站着，会呼吸、会眨眼' },
  wave: { img: wave, blink: waveBlink, name: '打招呼', when: '打开 App 时跟你挥手' },
  smile: { img: waveSmile, name: '笑眯眼', when: '打招呼的笑眯眼版本' },
  write: { img: write, name: '写欠条', when: 'AI 帮你做了一步，记一笔欠条' },
  dun: { img: dun, name: '催债', when: '该做一次不用 AI 的小测了' },
  paid: { img: paid, name: '还清', when: '小测通过，这笔账还清了' },
  think: { img: think, name: '思考中', when: '在等 AI 回复' },
  confused: { img: confused, name: '疑惑', when: '出错了，或者没听懂' },
  sleepy: { img: sleepy, name: '打瞌睡', when: '还没有内容，或者夜深了' },
  hug: { img: hug, name: '抱抱', when: '生活里安慰你' },
  life: { img: life, name: '生活', when: '生活板块的常驻形象' },
  study: { img: study, name: '学习', when: '学习板块的常驻形象' },
  research: { img: research, name: '科研', when: '科研板块的常驻形象' },
  lens: { img: lens, name: '压力测试', when: '科研压力测试时拿着放大镜' },
};

const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.3;
  const r = 70 + (i * 23) % 50;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r * 0.7 - 70), rot: (i * 67) % 360, tone: i % 5, w: 6 + (i % 3) * 2 };
});

/** Random blink every 4–6 s, closed for 130 ms, only for pictures that have a closed-eye frame. */
function useBlink(on: boolean): boolean {
  const [shut, setShut] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { setShut(true); t = setTimeout(() => { setShut(false); next(); }, 130); }, 4000 + Math.random() * 2000); };
    next();
    return () => { clearTimeout(t); setShut(false); };
  }, [on]);
  return shut;
}

/** Squash, swap, stretch up, settle: 440 ms, with the picture changing at the bottom of the squash. */
const BOING: Keyframe[] = [
  { scale: '1 1', translate: '0 0', easing: 'cubic-bezier(.3,.7,.4,1)' },
  { offset: 0.2, scale: '1.13 .85', translate: '0 0', easing: 'cubic-bezier(.3,0,.3,1)' },
  { offset: 0.46, scale: '.93 1.09', translate: '0 -12px', easing: 'cubic-bezier(.4,0,.6,1)' },
  { offset: 0.7, scale: '1.04 .97', translate: '0 0' },
  { offset: 0.86, scale: '.99 1.015', translate: '0 0' },
  { scale: '1 1', translate: '0 0' },
];
const BOING_MS = 440;
const SWAP_MS = 200; // the old picture is gone by then (jelly.css .zz-out)

/** Decode every picture once, so switching look never waits on a file or a decode. Kept alive for the whole session. */
const warm: HTMLImageElement[] = [];
function warmUp(): void {
  if (warm.length || typeof Image === 'undefined') return;
  for (const src of ZZ_FILES) {
    const i = new Image(); i.decoding = 'async'; i.src = src; warm.push(i);
    i.decode?.().catch(() => {});
  }
}
const stillPlease = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Zhangzhang({ state, size = 200 }: { state: ZzState; size?: number }) {
  const squash = useSquash<HTMLDivElement>([1.14, 0.82], { dampingRatio: 0.35, stiffness: STIFFNESS_MEDIUM });
  const morph = useRef<HTMLDivElement | null>(null);
  // The previous look stays for one cross-fade. Worked out while rendering, so the new picture is in the same frame.
  const [seen, setSeen] = useState(state);
  const [prev, setPrev] = useState<ZzState | null>(null);
  if (seen !== state) { setSeen(state); setPrev(seen); }
  useEffect(warmUp, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = morph.current;
    if (el && typeof el.animate === 'function' && !stillPlease()) el.animate(BOING, { duration: BOING_MS });
    const t = setTimeout(() => setPrev(null), SWAP_MS);
    return () => clearTimeout(t);
  }, [state]);
  const shown = { cur: state, prev };
  const cur = ZZ[shown.cur];
  const shut = useBlink(!!cur.blink);
  return (
    <div className={`zz zz-${shown.cur}`} style={{ width: size, height: size }} role="img" aria-label={tr('账账：{0}', tr(cur.name))}
      data-testid="zhangzhang" data-state={shown.cur} onPointerDown={() => squash.pop(1)}>
      <span className="zz-shadow" aria-hidden="true" />
      <span className="zz-spot" aria-hidden="true" />
      <div className="zz-act">
        <div className="zz-breath">
          <div className="zz-morph" ref={morph}>
          <div className="zz-tap" ref={squash.ref}>
            {shown.prev && <img key={`p-${shown.prev}`} className="zz-img zz-out" src={ZZ[shown.prev].img} alt="" draggable={false} />}
            <img key={`c-${shown.cur}`} className={`zz-img${shown.prev ? ' zz-in' : ''}`} src={cur.img} alt="" draggable={false} />
            {cur.blink && <img className="zz-img zz-blink" src={cur.blink} alt="" draggable={false} style={{ opacity: shut ? 1 : 0 }} data-testid="zz-blink" />}
          </div>
          </div>
        </div>
      </div>
      {shown.cur === 'paid' && (
        <div className="zz-confetti" aria-hidden="true">
          {CONFETTI.map((c, i) => <i key={i} className={`tone-${c.tone}`}
            style={{ '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, '--rot': `${c.rot}deg`, width: c.w, animationDelay: `${(i % 4) * 0.02}s` } as CSSProperties} />)}
        </div>
      )}
      {shown.cur === 'sleepy' && <div className="zz-zs" aria-hidden="true"><i /><i /><i /></div>}
    </div>
  );
}

/** Every picture file, for the check that none of the 16 is left out. */
export const ZZ_FILES = [hero, heroBlink, wave, waveBlink, waveSmile, write, dun, paid, think, confused, sleepy, hug, life, study, research, lens];
