// The board (学习 / 科研 / 生活) the desktop app wears: its colours go on <html> (packages/jelly/theme.ts), and the
// choice is remembered on this computer. 科研 is the default here, since the desktop app is where research happens.
import { useEffect, useSyncExternalStore } from "react";
import { applyBoard, BOARDS, type Board } from "@jelly/theme";

const KEY = "ros-board";
const subs = new Set<() => void>();
let current: Board = read();

function read(): Board {
  try { const v = localStorage.getItem(KEY); return BOARDS.includes(v as Board) ? (v as Board) : "科研"; } catch { return "科研"; }
}

export function setBoard(b: Board): void {
  current = b;
  try { localStorage.setItem(KEY, b); } catch { /* private window: the choice lasts this session */ }
  applyBoard(b);
  subs.forEach((f) => f());
}

export function useBoard(): [Board, (b: Board) => void] {
  const board = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current);
  useEffect(() => applyBoard(current), []);
  return [board, setBoard];
}
