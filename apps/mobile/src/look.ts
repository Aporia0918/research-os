// The board's colours (src/jelly/theme.ts) go on <html>, so every page and every jelly surface takes them. The colours
// are registered as <color> in jelly.css, so switching board fades them over 400 ms.
import { THEMES, themeVars, type Board } from './jelly/theme';

export function setBoardTheme(board: Board): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.board = board;
  for (const [k, v] of Object.entries(themeVars(THEMES[board]))) root.style.setProperty(k, String(v));
}
