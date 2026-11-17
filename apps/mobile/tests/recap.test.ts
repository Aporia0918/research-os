import { expect, it } from 'vitest';
import { SPOKEN_CHARS, mindMap, script } from '../src/recap/recap';

const r = { question: '什么是导数', said: '导数就是瞬时变化率，几何上是切线的斜率，我会先写差商再取极限。', points: ['瞬时变化率', '切线斜率', '差商取极限'], hits: [0, 1] };
const words = { covered: '你讲到了：', inYourWords: '用你自己的话说：' };

it('reads the question, the covered points and then the user own words', () => {
  expect(script(r, words)).toBe('什么是导数。你讲到了：瞬时变化率；切线斜率。用你自己的话说：导数就是瞬时变化率，几何上是切线的斜率，我会先写差商再取极限。');
});

it('stays about a minute long however much was said', () => {
  const long = script({ ...r, said: '很长的讲解'.repeat(200) }, words);
  expect(long.length).toBeLessThanOrEqual(SPOKEN_CHARS);
  expect(long.endsWith('…')).toBe(true);
});

it('maps one branch per point, covered or not, inside the frame', () => {
  const m = mindMap(r);
  expect(m.center).toBe('什么是导数');
  expect(m.nodes.map(n => [n.text, n.ok])).toEqual([['瞬时变化率', true], ['切线斜率', true], ['差商取极限', false]]);
  for (const k of [3, 4, 5, 6]) {
    const nodes = mindMap({ ...r, points: Array.from({ length: k }, (_, i) => `要点${i}`), hits: [] }).nodes;
    expect(nodes.every(n => n.x - 56 >= 0 && n.x + 56 <= 380 && n.y - 15 >= 0 && n.y + 15 <= 280)).toBe(true);
    // no node box overlaps the centre pill (120 x 36 at the middle)
    expect(nodes.every(n => Math.abs(n.x - 190) >= 116 || Math.abs(n.y - 140) >= 33)).toBe(true);
  }
  expect(mindMap({ ...r, points: [], hits: [] }).nodes).toHaveLength(1);
});
