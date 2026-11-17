// The three themes of 思维账本, light and dark (owner's spec, 2026-11-17), shared by the phone and desktop apps. Switching board
// changes only these colours; the components stay the same. They go on <html>, so every page and every jelly surface
// takes them; only the moving field behind fades (jelly.css), everything else switches at once.
import type { CSSProperties } from 'react';

export type Board = '生活' | '学习' | '科研';
export const BOARDS: Board[] = ['学习', '科研', '生活'];

export interface Theme { bgA: string; bgB: string; c1: string; c2: string; deep: string; accent: string; ink: string }

export const THEMES: Record<Board, Theme> = {
  生活: { bgA: '#f2fbf5', bgB: '#fff2ea', c1: '#d6f7ea', c2: '#8ce2c4', deep: '#46aa8c', accent: '#ff9f7a', ink: '#1e3b36' },
  学习: { bgA: '#eefaf5', bgB: '#e2f5f3', c1: '#d2f8ec', c2: '#5fd6be', deep: '#28968c', accent: '#13a898', ink: '#173a36' },
  科研: { bgA: '#ecf7f8', bgB: '#e6eefa', c1: '#d2f4f6', c2: '#5ac8d7', deep: '#287896', accent: '#3d7bff', ink: '#18374a' },
};

/** The same boards for the dark look: deep fields, the board's colour kept, text light. */
export const DARK_THEMES: Record<Board, Theme> = {
  生活: { bgA: '#10201b', bgB: '#231a17', c1: '#1d3a32', c2: '#5cc8a6', deep: '#9ae6cc', accent: '#ff9f7a', ink: '#e6f3ee' },
  学习: { bgA: '#0d1f1d', bgB: '#0f2423', c1: '#1c3b37', c2: '#3fbfa8', deep: '#8ce8d6', accent: '#2fd1bc', ink: '#e3f4f1' },
  科研: { bgA: '#0c1a22', bgB: '#101b2c', c1: '#1a3440', c2: '#3fb0c4', deep: '#93d8ea', accent: '#6d9bff', ink: '#e2eef5' },
};

export type Appearance = 'light' | 'dark' | 'system';
export const APPEARANCES: Appearance[] = ['light', 'dark', 'system'];

/** The theme as CSS variables, set once on the page root; every jelly reads them. */
export function themeVars(t: Theme): CSSProperties {
  return { '--bg-a': t.bgA, '--bg-b': t.bgB, '--c1': t.c1, '--c2': t.c2, '--deep': t.deep, '--accent': t.accent, '--ink': t.ink } as CSSProperties;
}

/** Puts the board's colours on <html> and marks it with data-board. */
export function applyBoard(board: Board): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.board = board;
  const set = root.dataset.appearance === 'dark' ? DARK_THEMES : THEMES;
  for (const [k, v] of Object.entries(themeVars(set[board]))) root.style.setProperty(k, String(v));
}

/** Light, dark, or the phone's own setting; marks <html> with data-appearance and repaints the current board. */
export function setAppearance(mode: Appearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = mode === 'dark' || (mode === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) root.dataset.appearance = 'dark'; else delete root.dataset.appearance;
  const board = root.dataset.board as Board | undefined;
  if (board && board in THEMES) applyBoard(board);
}
