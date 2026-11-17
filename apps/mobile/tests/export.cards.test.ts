import { expect, it } from 'vitest';
import { cardsOf, toAnki, toCsv } from '../src/ledger/exportCards';
import type { Entry } from '../src/ledger/ledger';

const e = (id: string, over: Partial<Entry>): Entry => ({ id, clientId: id, board: '学习', topic: '', question: '', answer: '', ownIdea: '',
  helpLevel: 'hint', weight: null, passes: 0, attempts: 0, dueOn: null, createdOn: '2026-11-01', ...over });

const es = [
  e('a', { question: '为什么 <x> 收敛', answer: '单调\n有界', ownIdea: '画图看', topic: '高数 3', red: true }),
  e('b', { question: '旧题', dropped: '2026-11-02' }),
  e('c', { question: '心情', board: '生活' }),
  e('d', { question: 'EEG 预处理', answer: '滤波, "去伪迹"', board: '科研', ai: 'Kimi', dueOn: '2026-11-20' }),
];

it('leaves out dropped and life entries and can keep one board', () => {
  expect(cardsOf(es).map(x => x.id)).toEqual(['a', 'd']);
  expect(cardsOf(es, '科研').map(x => x.id)).toEqual(['d']);
});

it('writes Anki text: escaped HTML, own idea on the back, tags', () => {
  const lines = toAnki(cardsOf(es, '学习'), { idea: '你当时的想法' }).trim().split('\n');
  expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3']);
  expect(lines[3].split('\t')).toEqual(['为什么 &lt;x&gt; 收敛', '单调<br>有界<br><br><i>你当时的想法</i> 画图看', '思维账本 学习 高数_3 讲不出来']);
});

it('writes a CSV Excel opens: BOM, quoted commas and quotes', () => {
  const csv = toCsv(cardsOf(es, '科研'), ['板块', '课程', '问题', '想法', '回答', 'AI', '日期', '下次', '红']);
  expect(csv.startsWith('﻿板块,')).toBe(true);
  expect(csv.split('\r\n')[1]).toBe('科研,,EEG 预处理,,"滤波, ""去伪迹""",Kimi,2026-11-01,2026-11-20,');
});

it('还账连击 counts only days a debt was repaid', async () => {
  const { streak } = await import('../src/ledger/insight');
  const booked = e('x', { createdOn: '2026-11-17', ownIdea: '自己想的' });
  expect(streak([booked], '2026-11-17')).toBe(0);
  const paid = e('y', { tries: [{ on: '2026-11-16', ok: true }, { on: '2026-11-17', ok: true }] as Entry['tries'] });
  expect(streak([booked, paid], '2026-11-17')).toBe(2);
});
