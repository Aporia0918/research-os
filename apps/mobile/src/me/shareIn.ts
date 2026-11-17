// 分享到思维账本 (plan 2.2): text shared from another app arrives through the native ShareIn plugin
// (android/.../ShareInPlugin.java). It is taken once and opens 记一笔 with the text in place.
import { Capacitor, registerPlugin } from '@capacitor/core';

interface ShareIn { take(): Promise<{ text: string }>; addListener(e: 'shared', f: () => void): Promise<{ remove: () => Promise<void> }> }
const native = registerPlugin<ShareIn>('ShareIn');

/** What was shared: the first sentence (up to 40 characters) reads as the question, the whole text is the AI's answer. */
export function fromShared(text: string): { question: string; answer: string } {
  const t = text.replace(/\r/g, '').trim();
  const first = (t.split(/[\n。！？!?]/)[0] ?? '').trim();
  return { question: first.length > 40 ? `${first.slice(0, 40)}…` : first, answer: t };
}

/** Calls `on` with shared text now (the app was opened by a share) and on every later share. Returns a stop function. */
export function onShared(on: (text: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const pull = () => void native.take().then((r) => { if (r.text.trim()) on(r.text); }).catch(() => {});
  pull();
  const h = native.addListener('shared', pull);
  return () => { void h.then((x) => x.remove()); };
}
