// Demo page for the owner to check the jelly look and 账账's motion before any real page uses them: switch 生活 / 学习 /
// 科研 at the bottom, tap any of 账账's states, press cards and buttons. Sample numbers are made up for the look only.
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Icon, type IconName } from '../icons';
import { JellySurface } from './JellySurface';
import { BOARDS, THEMES, themeVars, type Board } from './theme';
import { ZZ, Zhangzhang, type ZzState } from './Zhangzhang';
import './jelly.css';

const RESIDENT: Record<Board, ZzState> = { 生活: 'life', 学习: 'study', 科研: 'research' };
const STATES: ZzState[] = ['idle', 'wave', 'smile', 'write', 'dun', 'paid', 'think', 'confused', 'sleepy', 'hug', 'lens'];
const TAB_ICON: Record<Board, IconName> = { 生活: 'guide', 学习: 'ledger', 科研: 'research' };

/** Below Android 12 the blur is dropped for a plain white 30% (spec ①). */
function oldAndroid(): boolean {
  const m = /Android (\d+)/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return !!m && Number(m[1]) < 12;
}

function Sample({ board }: { board: Board }) {
  if (board === '生活') return (
    <JellySurface n={2} className="jl-sample">
      <p className="jl-bubble">{tr('今天过得怎么样？大事小事都可以跟我说说。')}</p>
      <div className="jl-tiles">
        {(['guide', 'log', 'plus'] as IconName[]).map((ic, i) => <JellySurface key={ic} as="button" type="button" n={5 + i} className="jl-tile"><Icon name={ic} size={26} /></JellySurface>)}
      </div>
      <Toggle label={tr('每周复盘')} />
    </JellySurface>
  );
  if (board === '学习') return (
    <JellySurface n={2} className="jl-sample">
      <div className="jl-ring-row">
        <svg className="jl-ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" className="jl-ring-bg" /><circle cx="32" cy="32" r="26" className="jl-ring-fg" pathLength="100" strokeDasharray="62 100" />
        </svg>
        <div><strong>{tr('这周还了 5 笔')}</strong><p className="jl-muted">{tr('还欠 3 笔，考前要还清')}</p></div>
      </div>
      {[tr('极限的定义'), tr('链式法则'), tr('洛必达什么时候能用')].map((t, i) => (
        <JellySurface key={t} as="button" type="button" shape="pill" n={8 + i} className="jl-row"><span className="jl-x">×</span>{t}<span className="jl-chev">›</span></JellySurface>
      ))}
    </JellySurface>
  );
  return (
    <JellySurface n={2} className="jl-sample">
      <div className="jl-ring-row">
        <svg className="jl-radar" viewBox="0 0 64 64" aria-hidden="true">
          <polygon points="32,6 57,24 47,55 17,55 7,24" className="jl-radar-bg" />
          <polygon points="32,16 49,27 42,48 21,46 15,26" className="jl-radar-fg" />
        </svg>
        <div><strong>{tr('结论体检 4 项')}</strong><p className="jl-muted">{tr('1 项要重做，组会前处理')}</p></div>
      </div>
      <div className="jl-tiles">
        {(['research', 'exam', 'recall'] as IconName[]).map((ic, i) => <JellySurface key={ic} as="button" type="button" n={5 + i} className="jl-tile"><Icon name={ic} size={26} /></JellySurface>)}
      </div>
    </JellySurface>
  );
}

function Toggle({ label }: { label: string }) {
  const [on, setOn] = useState(true);
  return (
    <JellySurface as="button" type="button" shape="pill" n={11} className="jl-toggle-row" aria-pressed={on} onClick={() => setOn(!on)}>
      <span>{label}</span>
      <span className={on ? 'jl-toggle on' : 'jl-toggle'}><span className="jl-pearl" /></span>
    </JellySurface>
  );
}

export function JellyDemo({ onExit }: { onExit?: () => void }) {
  const [board, setBoard] = useState<Board>('学习');
  const [state, setState] = useState<ZzState>('wave');
  const [noBlur] = useState(oldAndroid);
  useEffect(() => { const t = setTimeout(() => setState(s => (s === 'wave' ? 'idle' : s)), 2600); return () => clearTimeout(t); }, []);
  const pickBoard = (b: Board) => { setBoard(b); setState(s => (s === 'life' || s === 'study' || s === 'research' ? RESIDENT[b] : s)); };
  const shown = ZZ[state];
  return (
    <div className={noBlur ? 'jl no-blur' : 'jl'} style={themeVars(THEMES[board])} data-board={board} data-testid="jelly-demo">
      <div className="jl-bg" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="band" /></div>
      <header className="jl-top">
        <div><h1>{tr('账账和果冻')}</h1><p className="jl-muted">{tr('界面演示：按一按卡片和按钮，点一点账账')}</p></div>
        {onExit && <JellySurface as="button" type="button" shape="pill" n={1} className="jl-btn" onClick={onExit}>{tr('回到 App')}</JellySurface>}
      </header>

      <div className="jl-stage-wrap">
        <div className="jl-peek"><Zhangzhang state={state} size={196} /></div>
        <JellySurface n={0} className="jl-stage">
          <strong className="jl-state-name">{tr(shown.name)}</strong>
          <p className="jl-muted">{tr(shown.when)}</p>
        </JellySurface>
      </div>

      <h2 className="jl-h2">{tr('账账的状态')}</h2>
      <div className="jl-states" role="group" aria-label={tr('账账的状态')}>
        {[...STATES, RESIDENT[board]].map((s, i) => (
          <JellySurface key={s} as="button" type="button" shape="pill" n={20 + i} aria-pressed={state === s}
            className={state === s ? 'jl-chip on' : 'jl-chip'} onClick={() => setState(s)}>
            {s === RESIDENT[board] ? tr('{0}板块形象', board) : tr(ZZ[s].name)}
          </JellySurface>
        ))}
      </div>

      <h2 className="jl-h2">{tr('{0}板块的样子', board)}</h2>
      <Sample board={board} />
      <JellySurface n={3} className="jl-note">
        <strong>{tr('果冻手感')}</strong>
        <p className="jl-muted">{tr('按住卡片会被压扁，松手弹回来晃几下；手指移动时，亮光跟着手指走。卡片平时会轻轻浮动，四个角慢慢变圆。')}</p>
      </JellySurface>

      <JellySurface as="nav" shape="pill" n={4} className="jl-tabbar" role="tablist" aria-label={tr('板块')}>
        {BOARDS.map(b => (
          <button key={b} type="button" role="tab" aria-selected={board === b} className={board === b ? 'jl-tab on' : 'jl-tab'} onClick={() => pickBoard(b)}>
            <Icon name={TAB_ICON[b]} size={22} /><span>{b}</span>
          </button>
        ))}
      </JellySurface>
    </div>
  );
}
