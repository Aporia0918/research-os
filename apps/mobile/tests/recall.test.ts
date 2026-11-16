// 知识召回 (演示第三段, phone half): the opposition rules, the scores on the developers' own pairs, and the book's
// recall notice → accept reopens a repaid debt → dismiss only with evidence found in the paper.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { backs, flips, grams, opposing, split, stance, type Source } from '../src/rules/recall';
import { Book } from '../src/ledger/ledger';
import { memoryKV } from '../src/storage/kv';

const FX = JSON.parse(readFileSync(new URL('./fixtures/recall/pairs.json', import.meta.url), 'utf8')) as
  Record<'dev' | 'heldout', { claim: string; source: string; expected: 'opposes' | 'no' }[]>;

describe('opposition rules', () => {
  it('splits Chinese and English sentences', () => {
    expect(split('空间滤波很重要。它放在分类之前！Then classify. Done')).toEqual(['空间滤波很重要。', '它放在分类之前！', 'Then classify.', 'Done']);
  });
  it('topic grams leave out polarity, direction and hedge words', () => {
    expect(grams('空间滤波应放在分类之前')).toEqual(grams('空间滤波应放在分类之后'));
    expect(grams('X may not increase Y')).toEqual(grams('X decreases Y'));
  });
  it('counts flips: negation, direction, and two flips cancel', () => {
    expect(flips('共平均参考提高信噪比', '共平均参考降低信噪比')).toBe(1);
    expect(flips('共平均参考提高信噪比', '共平均参考不提高信噪比')).toBe(1);
    expect(flips('小波去噪不会增加失真', '小波去噪降低失真')).toBe(2);
    expect(flips('不同受试者差异很大', '不同受试者差异很大')).toBe(0);
  });
  it('a hedged source is weaker, never a recall; a contrast is judged clause by clause', () => {
    expect(stance('空间滤波应放在分类之前。', '空间滤波可能需要放在分类之后。')).toBeNull();
    expect(stance('Dropout reduces overfitting.', 'Dropout reduces overfitting, but it does not fix label noise.')).toBe('agrees');
  });

  // dev: first run caught 9/10 with 2 false alarms out of 10; then 相关 and correlated stopped counting as hedges, a
  // contrast splits clauses and the topic bar went from 0.6 to 0.75. heldout was written with dev and only scored after.
  it.each([['dev', 10, 0], ['heldout', 8, 0]] as const)('%s pairs: caught and false alarms are pinned', (set, caught, alarms) => {
    const got = FX[set].map(p => ({ ...p, hit: stance(p.claim, p.source) === 'opposes' }));
    expect(got.filter(p => p.expected === 'opposes').length).toBe(10);
    expect(got.filter(p => p.expected === 'opposes' && p.hit).length).toBe(caught);
    expect(got.filter(p => p.expected === 'no' && p.hit).length).toBe(alarms);
  });
  it('heldout misses are the two known gaps: two direction words in one claim, and must → need not', () => {
    const missed = FX.heldout.filter(p => p.expected === 'opposes' && stance(p.claim, p.source) !== 'opposes').map(p => p.claim);
    expect(missed).toEqual(['Increasing the window length improves classification accuracy.', 'Cross-validation folds must be split by subject.']);
  });

  it('finds the opposing sentence and its page in an imported paper', () => {
    const paper: Source = { name: '综述.pdf', pages: ['引言。脑机接口发展很快。', '方法部分。综述指出，空间滤波应在分类之后进行。其余步骤不变。'] };
    expect(opposing('空间滤波应放在分类之前。这样能提高准确率。', paper)).toEqual(
      { claim: '空间滤波应放在分类之前。', quote: '综述指出，空间滤波应在分类之后进行。', page: 2, coverage: 0.75 });
    expect(opposing('采样率越高越好。', paper)).toBeNull();
  });
  it('counter-evidence must be in the paper word for word and agree with the claim', () => {
    const paper: Source = { name: 'p', pages: ['空间滤波应放在分类之前，这一点已有共识。'] };
    expect(backs('空间滤波应放在分类之前。', '空间滤波应放在分类之前，这一点已有共识。', [paper])).toBe(true);
    expect(backs('空间滤波应放在分类之前。', '空间滤波应放在分类之前。我很确定。', [paper])).toBe(false);
    expect(backs('空间滤波应放在分类之前。', '', [paper])).toBe(false);
  });
});

describe('recall on the book', () => {
  const answer = '空间滤波应放在分类之前。这样能提高准确率。';
  const review: Source = { name: '导师发的综述.pdf', pages: ['第一页。', '综述指出，空间滤波应在分类之后进行。'] };
  async function repaid(book: Book) {
    const e = await book.add({ clientId: 'c1', board: '科研', question: '空间滤波为什么放在分类之前', answer, helpLevel: 'answer', ai: '豆包' }, '2026-11-01');
    await book.repay(e.id, answer, '2026-11-02');
    await book.repay(e.id, answer, '2026-11-09');
    expect((await book.all())[0].dueOn).toBeNull(); // 已还清
    return e;
  }

  it('a paper that says the opposite opens a recall notice; accepting reopens the repaid debt with the paper sentence', async () => {
    const book = new Book(memoryKV());
    const e = await repaid(book);
    const hits = await book.recallScan(review, '2026-11-30');
    expect(hits.map(h => h.id)).toEqual([e.id]);
    expect((await book.recalled())[0].recalls).toEqual([{ claim: '空间滤波应放在分类之前。', quote: '综述指出，空间滤波应在分类之后进行。',
      page: 2, paper: '导师发的综述.pdf', on: '2026-11-30', state: 'open' }]);
    expect(await book.recallScan(review, '2026-11-30')).toEqual([]); // one open notice per debt

    const back = await book.acceptRecall(e.id, '2026-11-30');
    expect(back).toMatchObject({ passes: 0, dueOn: '2026-11-30', ai: '豆包', answer: '综述指出，空间滤波应在分类之后进行。这样能提高准确率。' });
    expect(await book.recalled()).toEqual([]);
    expect(await book.recallScan(review, '2026-12-01')).toEqual([]); // the same sentence never recalls it twice
    expect(await book.processRecord('2026-11-30')).toContain('讲到一半（召回后重开）');
  });

  it('dismissing needs a sentence from the paper that backs the AI; without it the notice stays', async () => {
    const book = new Book(memoryKV());
    const e = await repaid(book);
    const both: Source = { name: 'b.pdf', pages: ['综述指出，空间滤波应在分类之后进行。', '另一组实验表明，空间滤波应放在分类之前。'] };
    await book.recallScan(both, '2026-11-30');
    expect(await book.processRecord('2026-11-30')).toContain('被召回，待你看');
    await expect(book.dismissRecall(e.id, '我觉得 AI 是对的。', [both])).rejects.toThrow('no_evidence');
    expect(await book.recalled()).toHaveLength(1);
    const kept = await book.dismissRecall(e.id, '另一组实验表明，空间滤波应放在分类之前。', [both]);
    expect(kept.recalls![0]).toMatchObject({ state: 'dismissed', evidence: '另一组实验表明，空间滤波应放在分类之前。' });
    expect(kept.dueOn).toBeNull(); // still repaid
    expect(await book.recallScan(both, '2026-12-01')).toEqual([]);
  });

  it('skips 结论债, debts with no AI answer and things you thought of yourself', async () => {
    const book = new Book(memoryKV());
    await book.add({ clientId: 'own', board: '科研', question: 'q', answer, helpLevel: 'own' }, '2026-11-01');
    await book.add({ clientId: 'bare', board: '科研', question: '空间滤波应放在分类之前', helpLevel: 'answer' }, '2026-11-01');
    await book.checkup({ key: 'a|b|c', question: '空间滤波应放在分类之前', outcome: 'pass' }, '2026-11-01');
    expect(await book.recallScan(review, '2026-11-30')).toEqual([]);
  });
});
