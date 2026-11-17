/**
 * 讲后即时回报: right after a debt is explained well, the user's own words come back as a 60-second listen and a
 * one-screen map. Built from what the user said and the points they covered; no model call, nothing leaves the phone.
 */
export interface Recap { question: string; said: string; points: string[]; hits: number[] }

/** About 60 seconds of Chinese speech (roughly 4 to 5 characters a second). */
export const SPOKEN_CHARS = 270;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The script read aloud: the question, the points they covered, then their own words, cut to about a minute. */
export function script(r: Recap, words: { covered: string; inYourWords: string }): string {
  const covered = r.hits.map(i => r.points[i]).filter(Boolean);
  const parts = [clean(r.question) + '。'];
  if (covered.length) parts.push(`${words.covered}${covered.map(clean).join('；')}。`);
  const head = parts.join('');
  const room = SPOKEN_CHARS - head.length - words.inYourWords.length;
  const own = clean(r.said);
  return room > 20 && own ? `${head}${words.inYourWords}${clip(own, room)}` : clip(head, SPOKEN_CHARS);
}

export interface MapNode { text: string; ok: boolean; x: number; y: number }
export interface MindMap { center: string; nodes: MapNode[] }

/** One centre (the question) and one branch per key point, covered or not, spread evenly around it. */
export const MAP_W = 380, MAP_H = 280;
export function mindMap(r: Recap, w = MAP_W, h = MAP_H): MindMap {
  const points = r.points.length ? r.points : [clean(r.said)];
  const n = points.length, cx = w / 2, cy = h / 2, rx = w / 2 - 60, ry = h * 0.36; // side nodes clear the centre pill, all nodes stay inside the frame
  const nodes = points.map((p, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { text: clip(clean(p), 8), ok: !r.points.length || r.hits.includes(i), x: Math.round(cx + rx * Math.cos(a)), y: Math.round(cy + ry * Math.sin(a)) };
  });
  return { center: clip(clean(r.question), 8), nodes };
}
