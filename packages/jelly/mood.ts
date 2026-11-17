// Which 账账 the ledger home shows. A fresh event (just booked, just repaid, a miss) wins for a moment; otherwise the
// state of the book decides: nothing booked or late at night → 打瞌睡, an end-of-trial quiz or a red debt due → 催债,
// else the board's own look.
import type { ZzState } from './Zhangzhang';
import type { Board } from './theme';

export const RESIDENT: Record<Board, ZzState> = { 生活: 'life', 学习: 'study', 科研: 'research' };
export type Moment = 'hello' | 'booked' | 'paid' | 'missed' | null;
const MOMENT: Record<Exclude<Moment, null>, ZzState> = { hello: 'wave', booked: 'write', paid: 'paid', missed: 'confused' };

export function homeMood(o: { board: Board; moment: Moment; total: number; redDue: number; quiz: number; hour: number }): ZzState {
  if (o.moment) return MOMENT[o.moment];
  if (o.total === 0 || o.hour >= 23 || o.hour < 6) return 'sleepy';
  if (o.quiz > 0 || o.redDue > 0) return 'dun';
  return RESIDENT[o.board];
}
