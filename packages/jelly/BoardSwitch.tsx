// 生活 / 学习 / 科研: one pill slides under the picked board (translate only, a small jelly overshoot). Each app passes its
// own words for the boards, its own surface class and, if it shows fewer, which boards.
import type { CSSProperties } from 'react';
import { BOARDS, type Board } from './theme';

export function BoardSwitch({ board, onPick, name, className = '', boards = BOARDS }:
  { board: Board; onPick: (b: Board) => void; name: (b: Board) => string; className?: string; boards?: Board[] }) {
  return (
    <div role="tablist" className={`board-switch ${className}`.trim()} data-testid="board-switch">
      <span className="seg-pill" aria-hidden="true" style={{ '--i': Math.max(0, boards.indexOf(board)), '--n': boards.length } as CSSProperties} />
      {boards.map(b => <button key={b} type="button" role="tab" aria-selected={board === b} onClick={() => onPick(b)}>{name(b)}</button>)}
    </div>
  );
}
