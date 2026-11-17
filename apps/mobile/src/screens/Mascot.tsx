// 小账: the 生活 board's little companion, a round blue-violet blob with a sprout. It greets you and its face follows the
// chat (listening, thinking, glad, worried). Warm, never clingy: LIFE_SYSTEM still forbids "always with you" and romance.
import { tr } from '../i18n';

export type Mood = 'idle' | 'thinking' | 'happy' | 'worried';

const EYES: Record<Mood, { shift?: string; ry: number }> = {
  idle: { ry: 6 }, thinking: { shift: 'translate(0 -3)', ry: 6 }, happy: { ry: 2.2 }, worried: { shift: 'translate(0 1)', ry: 5 },
};
const MOUTH: Record<Mood, string> = {
  idle: 'M44 64 Q50 69 56 64',
  thinking: 'M46 66 L54 66',
  happy: 'M42 62 Q50 72 58 62',
  worried: 'M44 67 Q50 62 56 67',
};
const UP = 'translate(0 -3)';

export function Mascot({ size = 64, mood = 'idle', id = 'm' }: { size?: number; mood?: Mood; id?: string }) {
  const e = EYES[mood];
  const fill = `url(#${id}-body)`;
  return (
    <svg className={`mascot mood-${mood}`} width={size} height={size} viewBox="0 0 100 100" role="img"
      aria-label={tr('小账')} data-testid="mascot" data-mood={mood}>
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#9DB4FF" />
          <stop offset=".55" stopColor="#6A7CFF" />
          <stop offset="1" stopColor="#5546D8" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="94" rx="24" ry="3.6" fill="#3A2F8F" opacity=".16" />
      <path d="M50 22 C49 14 52 9 58 7" fill="none" stroke="#5546D8" strokeWidth="3" strokeLinecap="round" />
      <path d="M58 7 C64 4 70 7 70 12 C64 14 60 12 58 7 Z" fill="#7BD389" />
      <path d="M50 20 C74 20 86 40 86 60 C86 80 70 90 50 90 C30 90 14 80 14 60 C14 40 26 20 50 20 Z" fill={fill} />
      <ellipse cx="36" cy="34" rx="10" ry="6" fill="#fff" opacity=".35" transform="rotate(-25 36 34)" />
      <g transform={e.shift}>
        {mood === 'happy'
          ? <><path d="M34 52 Q39 46 44 52" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M56 52 Q61 46 66 52" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" /></>
          : <><ellipse cx="39" cy="52" rx="4.6" ry={e.ry} fill="#fff" />
            <ellipse cx="61" cy="52" rx="4.6" ry={e.ry} fill="#fff" /></>}
        {mood === 'worried' && <><path d="M33 42 L43 45" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M67 42 L57 45" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></>}
      </g>
      <ellipse cx="30" cy="62" rx="5" ry="3" fill="#FF9EC4" opacity=".8" />
      <ellipse cx="70" cy="62" rx="5" ry="3" fill="#FF9EC4" opacity=".8" />
      <path d={MOUTH[mood]} fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" transform={mood === 'thinking' ? UP : undefined} />
      {mood === 'thinking' && (
        <g className="mascot-dots" fill="#8A94B8">
          <circle cx="78" cy="16" r="2.6" /><circle cx="86" cy="12" r="2.6" /><circle cx="94" cy="16" r="2.6" />
        </g>
      )}
    </svg>
  );
}
