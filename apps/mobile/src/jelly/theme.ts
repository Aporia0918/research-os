// The three light themes of 思维账本 (owner's spec, 2026-11-17). Switching board changes only these colours; the
// components stay the same. The colours are CSS custom properties registered as <color> in jelly.css, so a switch fades
// over 400 ms instead of jumping.
import type { CSSProperties } from 'react';

export type Board = '生活' | '学习' | '科研';
export const BOARDS: Board[] = ['生活', '学习', '科研'];

export interface Theme { bgA: string; bgB: string; c1: string; c2: string; deep: string; accent: string; ink: string }

export const THEMES: Record<Board, Theme> = {
  生活: { bgA: '#f2fbf5', bgB: '#fff2ea', c1: '#d6f7ea', c2: '#8ce2c4', deep: '#46aa8c', accent: '#ff9f7a', ink: '#1e3b36' },
  学习: { bgA: '#eefaf5', bgB: '#e2f5f3', c1: '#d2f8ec', c2: '#5fd6be', deep: '#28968c', accent: '#13a898', ink: '#173a36' },
  科研: { bgA: '#ecf7f8', bgB: '#e6eefa', c1: '#d2f4f6', c2: '#5ac8d7', deep: '#287896', accent: '#3d7bff', ink: '#18374a' },
};

/** The theme as CSS variables, set once on the page root; every jelly reads them. */
export function themeVars(t: Theme): CSSProperties {
  return { '--bg-a': t.bgA, '--bg-b': t.bgB, '--c1': t.c1, '--c2': t.c2, '--deep': t.deep, '--accent': t.accent, '--ink': t.ink } as CSSProperties;
}
