// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { around, searchEntries } from '../src/ledger/search';
import type { Entry } from '../src/ledger/ledger';
import { DARK_THEMES, THEMES, applyBoard, setAppearance } from '../../../packages/jelly/theme';

const e = (id: string, over: Partial<Entry>): Entry => ({
  id, clientId: id, board: '学习', topic: '', question: '', answer: '', ownIdea: '', helpLevel: 'hint', weight: null,
  passes: 0, attempts: 0, dueOn: null, createdOn: '2026-11-01', ...over,
});

describe('搜索账本', () => {
  const es = [
    e('a', { question: '傅里叶变换的物理意义', answer: '把信号拆成不同频率', createdOn: '2026-11-02' }),
    e('b', { question: '拉普拉斯变换', answer: '傅里叶的推广', dueOn: '2026-11-20', createdOn: '2026-11-01' }),
    e('c', { question: '傅里叶级数', red: true, dueOn: '2026-11-18', topic: '高数3', createdOn: '2026-10-01' }),
    e('d', { question: '傅里叶旧题', dropped: '2026-11-03' }),
    e('e', { question: 'EEG band power', ownIdea: 'Alpha 波 8-13 Hz', board: '科研' }),
  ];
  it('finds every word in any field, red and owed first, dropped never', () => {
    expect(searchEntries(es, '傅里叶').map(h => h.entry.id)).toEqual(['c', 'b', 'a']);
    expect(searchEntries(es, '傅里叶 高数3').map(h => h.entry.id)).toEqual(['c']);
    expect(searchEntries(es, '   ')).toEqual([]);
  });
  it('ignores case and full-width letters, and says where it matched', () => {
    const [h] = searchEntries(es, 'ＡＬＰＨＡ');
    expect(h.entry.id).toBe('e');
    expect(h.where).toBe('ownIdea');
    expect(searchEntries(es, '推广')[0].snippet).toBe('傅里叶的推广');
  });
  it('clips the snippet around the match', () => {
    expect(around('一二三四五六七八九十甲乙丙丁', '九', 2)).toBe('…七八九十甲…');
  });
});

describe('深色外观', () => {
  afterEach(() => setAppearance('light'));
  it('swaps the board colours for the dark set and back', () => {
    applyBoard('学习');
    setAppearance('dark');
    const root = document.documentElement;
    expect(root.dataset.appearance).toBe('dark');
    expect(root.style.getPropertyValue('--bg-a')).toBe(DARK_THEMES.学习.bgA);
    setAppearance('light');
    expect(root.dataset.appearance).toBeUndefined();
    expect(root.style.getPropertyValue('--bg-a')).toBe(THEMES.学习.bgA);
  });
});
