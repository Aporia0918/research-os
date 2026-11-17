// Two looks: 学习 and 科研 are a dark sci-fi console (cold blue light, thin lines); 生活 is warm and soft.
// The look is a data attribute on <html>; styles.css redefines the colour tokens under it.
export type Look = 'scifi' | 'warm';
export function setLook(look: Look): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.look = look;
}
