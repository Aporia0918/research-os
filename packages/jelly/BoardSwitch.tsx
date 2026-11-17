// 生活 / 学习 / 科研: one pill slides under the picked board (translate only, a small jelly overshoot). Each app passes its
// own words for the boards and its own surface class.
import type { CSSProperties } from 'react';
import { BOARDS, type Board } from './theme';

export function BoardSwitch({ board, onPick, name, className = '' }:
  { board: Board; onPick: (b: Board) => void; name: (b: Board) => string; className?: string }) {
  return (
    <div role="tablist" className={`board-switch ${className}`.trim()} data-testid="board-switch">
      <span className="seg-pill" aria-hidden="true" style={{ '--i': BOARDS.indexOf(board) } as CSSProperties} />
      {BOARDS.map(b => <button key={b} type="button" role="tab" aria-selected={board === b} onClick={() => onPick(b)}>{name(b)}</button>)}
    </div>
  );
}
