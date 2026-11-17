// 小账: the 生活 board's companion, a little cyan jelly with a sprout. It waves hello, blinks, looks up while it thinks,
// smiles when you made your own call and frowns softly when you sound low. Warm, never clingy: LIFE_SYSTEM still forbids
// "always with you", missing you and romance. (The whole-app mascot is still being decided; this one stays in 生活.)
import { tr } from '../i18n';

export type Mood = 'idle' | 'thinking' | 'happy' | 'worried';

const BODY = 'M50 15 C76 15 90 37 90 60 C90 80 75 90 50 90 C25 90 10 80 10 60 C10 37 24 15 50 15 Z';
const RIM = 'M50 18.5 C73 18.5 86.5 38 86.5 60 C86.5 77.5 73 86.5 50 86.5 C27 86.5 13.5 77.5 13.5 60 C13.5 38 27 18.5 50 18.5 Z';
const MOUTH: Record<Mood, string> = {
  idle: 'M45 65 Q47.5 68.5 50 65 Q52.5 68.5 55 65',
  thinking: 'M47.5 66.5 Q50 64.5 52.5 66.5',
  happy: 'M43 63 Q50 72 57 63 Z',
  worried: 'M45 68 Q47.5 65.5 50 67 Q52.5 68.5 55 66',
};
const LOOK_UP = 'translate(1.5 -2.5)';
const WAVE = 'rotate(-38 86 62)';
const TILT = 'rotate(-28 33 30)';
const INK = '#10304a';

function Eye({ x, mood }: { x: number; mood: Mood }) {
  if (mood === 'happy') return <path d={`M${x - 6} 56 Q${x} 48 ${x + 6} 56`} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />;
  return (
    <g className="eye" transform={mood === 'thinking' ? LOOK_UP : undefined}>
      <ellipse cx={x} cy="55" rx="6.4" ry={mood === 'worried' ? 6.4 : 7.6} fill={INK} />
      <circle cx={x + 2.2} cy="51.6" r="2.5" fill="#fff" />
      <circle cx={x - 2} cy="58.6" r="1.1" fill="#fff" opacity=".85" />
    </g>
  );
}

export function Mascot({ size = 64, mood = 'idle', id = 'm' }: { size?: number; mood?: Mood; id?: string }) {
  const g = (n: string) => `${id}-${n}`;
  const url = (n: string) => `url(#${g(n)})`;
  return (
    <svg className={`mascot mood-${mood}`} width={size} height={size} viewBox="0 0 100 100" role="img"
      aria-label={tr('小账')} data-testid="mascot" data-mood={mood}>
      <defs>
        <radialGradient id={g('body')} cx="40%" cy="32%" r="78%">
          <stop offset="0" stopColor="#effffd" />
          <stop offset=".38" stopColor="#9cf0e8" />
          <stop offset=".78" stopColor="#36c6d3" />
          <stop offset="1" stopColor="#1793b0" />
        </radialGradient>
        <radialGradient id={g('glow')} cx="50%" cy="100%" r="60%">
          <stop offset="0" stopColor="#c9fff6" stopOpacity=".9" />
          <stop offset="1" stopColor="#c9fff6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('leaf')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a8f0b8" />
          <stop offset="1" stopColor="#3fbf86" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="94" rx="27" ry="3.6" fill="#0b4a5a" opacity=".18" />
      <path d="M50 16 C50 12 50 9 51 6" fill="none" stroke="#2aa9a0" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M51 7 C55 1 64 1 66 5 C61 9 55 9 51 7 Z" fill={url('leaf')} />
      <path d="M50 8 C46 3 39 3 37 6 C41 10 46 10 50 8 Z" fill={url('leaf')} opacity=".85" />
      <ellipse cx="12.5" cy="66" rx="6" ry="7.5" fill={url('body')} />
      <g transform={mood === 'happy' ? WAVE : undefined} className={mood === 'happy' ? 'wave' : undefined}>
        <ellipse cx="87.5" cy="66" rx="6" ry="7.5" fill={url('body')} />
      </g>
      <path d={BODY} fill={url('body')} />
      <ellipse cx="50" cy="82" rx="30" ry="9" fill={url('glow')} />
      <path d={RIM} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.4" />
      <ellipse cx="33" cy="30" rx="12" ry="6.5" fill="#fff" opacity=".75" transform={TILT} />
      <circle cx="47" cy="23" r="2.2" fill="#fff" opacity=".85" />
      <Eye x={37} mood={mood} />
      <Eye x={63} mood={mood} />
      {mood === 'worried' && <>
        <path d="M31 44.5 Q36 42 41 44" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M69 44.5 Q64 42 59 44" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      </>}
      <ellipse cx="26" cy="65" rx="6" ry="3.6" fill="#ff8a80" opacity=".55" />
      <ellipse cx="74" cy="65" rx="6" ry="3.6" fill="#ff8a80" opacity=".55" />
      {mood === 'happy'
        ? <path d={MOUTH.happy} fill="#e0606a" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        : <path d={MOUTH[mood]} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
      {mood === 'thinking' && (
        <g className="mascot-dots" fill="#7fb9c6">
          <circle cx="80" cy="18" r="2.6" /><circle cx="88" cy="13" r="3" /><circle cx="96" cy="7" r="3.4" />
        </g>
      )}
    </svg>
  );
}
