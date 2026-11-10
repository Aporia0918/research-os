// Golden tests ported 1:1 from the Research OS backend test cases (master 3f4e791):
//   tests/test_mobile_number_gate.py, test_mobile_plan_actions.py, test_mobile_hypothesis.py,
//   tests/test_mobile_guidance.py, test_mobile_api.py (compare).
// Same inputs, same expected outputs. HTTP status codes map to RuleError.status here.
// 非真机 / 无模型 / 电脑可关机. Wording is always 辅助定位原文、由你判断, never "verified".
import { describe, expect, it } from 'vitest';
import { findSpan } from '../src/rules/text';
import { citationCheck, claims, content, paperSentences, support, VERDICT_LABEL } from '../src/rules/citation';
import { names, tableLike } from '../src/rules/citationRules';
import { decideNumber, missingNumbers, openNumberItems, requireNumbersClosed, tagItem, numbers, RuleError, type RuleItem } from '../src/rules/numberGate';
import { compareLog, extractParams, distance, rank, clauseWords, mismatchCount, type Chunk } from '../src/rules/compare';
import { decideAction, detect, requireConfirmable, tagAction } from '../src/rules/planActions';
import { compareHypothesis, newHypothesis, numberCheck, setStatus, type HypItemInput } from '../src/rules/hypothesis';
import { ideaWords, keepSentence, methodSegments, questions, specific } from '../src/rules/questions';

// Same paper as backend tests/test_mobile_api.py::_paper() after parsing (2 pages).
const METHOD_SENTENCE = 'EEG was band-pass filtered at 1-40 Hz before epoching.';
const PAGES = [
  'Demo EEG methods paper\n\nAbstract\nWe study a demo task with wearable EEG recordings.\n',
  `2. Methods\nTwenty participants took part in the demo recording session.\n${METHOD_SENTENCE}\nEpochs lasted 2 s and were baseline corrected.\nSamples were stored at 4 °C overnight.\n`,
];
const CHUNKS: Chunk[] = [
  { page_index: 0, seq: 0, text: PAGES[0], section_role: 'abstract' },
  { page_index: 1, seq: 0, text: PAGES[1], section_role: 'methods' },
];
const err = (f: () => unknown): RuleError => { try { f(); } catch (e) { return e as RuleError; } throw new Error('did not throw'); };

describe('number gate (test_mobile_number_gate.py)', () => {
  const quote = 'Signals were band-pass filtered between 1 and 40 Hz and sampled at 128 Hz.';
  const modelItem: RuleItem = { id: 'x', text: 'Band-pass 1-40 Hz, sampled at 256 Hz', citation: { quote } };
  it('a model-written value that is not on the cited page is needs_confirmation', () => {
    const tagged = tagItem(modelItem);
    expect(tagged.number_gate?.state).toBe('needs_confirmation');
    expect(tagged.number_gate?.missing).toEqual(['256']);
    expect(tagged.number_gate?.label).toBe('需确认');
    expect(tagItem({ ...modelItem, text: '1-40 Hz at 128 Hz' }).number_gate?.state).toBe('ok');
    expect(tagItem({ id: 'y', text: 'baseline correction', citation: null }).number_gate).toBeUndefined();
    expect(missingNumbers('0.5 s', 'epochs of 0.5 s')).toEqual([]);
    expect(missingNumbers('5 s', 'epochs of 0.5 s')).toEqual(['5']);
  });
  it('an edited number (999 trials) opens the gate; confirm/reject closes it; gate blocks confirm', () => {
    const good = tagItem({ id: 'a', text: 'Band-pass 1-40 Hz, sampled at 128 Hz', citation: { quote } });
    const bad = tagItem({ id: 'b', text: 'Rest for 999 trials', citation: { quote } });
    const items = [good, bad];
    expect(openNumberItems(items)).toEqual(['b']);
    expect(err(() => requireNumbersClosed(items)).code).toBe('citation_gate_open');
    expect(err(() => requireNumbersClosed(items)).status).toBe(409);
    expect(err(() => decideNumber(bad, 'adopt', 't', 'd')).status).toBe(422);
    expect(err(() => decideNumber(good, 'confirm_match', 't', 'd')).status).toBe(422);
    const decided = decideNumber(bad, 'reject_match', '2026-11-06T00:00:00Z', 'dev1');
    expect(decided.number_gate?.state).toBe('reject_match');
    expect(decided.number_gate?.decided_at).toBe('2026-11-06T00:00:00Z');
    expect(() => requireNumbersClosed([good, decided])).not.toThrow();
    // re-tagging an unchanged text keeps the decision; a changed text reopens it
    expect(tagItem(decided, decided).number_gate?.state).toBe('reject_match');
    expect(tagItem({ ...decided, text: 'Rest for 1000 trials' }, decided).number_gate?.state).toBe('needs_confirmation');
  });
  it('numbers() read decimals and ranges exactly like _NUM', () => {
    expect(numbers('Band-pass 1-40 Hz, sampled at 256 Hz')).toEqual(['1', '40', '256']);
    expect(numbers('version 2.1 of the protocol')).toEqual(['2.1']);
  });
});

describe('key-action approval (test_mobile_plan_actions.py)', () => {
  const raw: RuleItem[] = [
    { id: 'i0', category: 'materials', text: 'Upload the raw EEG to the lab server' },
    { id: 'i1', category: 'materials', text: 'Ask a cloud model (LLM) to label artifacts' },
    { id: 'i2', category: 'controls', text: 'baseline window 200 ms' },
    { id: 'i3', category: 'materials', text: 'notebook' },
  ];
  it('kinds detected, needs_approval, approve/reject, locked after confirm', () => {
    const items = raw.map((i, n) => tagAction(i, n === 3 ? 'share' : null));
    expect(items.map(i => i.key_action ?? null)).toEqual(['send_data_out', 'run_model_call', null, 'share']);
    for (const i of items.filter(x => x.key_action)) expect((i.approval as { state: string }).state).toBe('needs_approval');
    expect(err(() => requireConfirmable(items)).code).toBe('plan_action_unapproved');
    expect(err(() => decideAction(items[2], 'approve', 't', 'd')).status).toBe(422);
    expect(err(() => decideAction(items[0], 'maybe', 't', 'd')).status).toBe(422);
    const decided = items.map((i, n) => [0, 1, 3].includes(n) ? decideAction(i, n === 1 ? 'reject' : 'approve', '2026-11-06T00:00:00Z', 'dev1') : i);
    expect((decided[1].approval as { state: string }).state).toBe('rejected');
    const gated = decided.map(i => tagItem(i)); // item 2: 200 ms with no quote also opens the number gate
    expect(err(() => requireConfirmable(gated)).code).toBe('citation_gate_open');
    const closed = gated.map(i => i.id === 'i2' ? decideNumber(i, 'confirm_match', 't', 'd') : i);
    expect(() => requireConfirmable(closed)).not.toThrow();
  });
  it('editing resets the approval; detection passes the same strings', () => {
    const first = tagAction<RuleItem>({ id: 'a', text: 'upload data' });
    const done = { ...first, approval: { state: 'approved' as const, decided_at: 't', device_id: 'd' } };
    expect((tagAction<RuleItem>({ id: 'a', text: 'upload data' }, null, done).approval as { state: string }).state).toBe('approved');
    expect((tagAction<RuleItem>({ id: 'a', text: 'upload all data' }, null, done).approval as { state: string }).state).toBe('needs_approval');
    expect(detect('band-pass 1-40 Hz')).toBeNull();
    expect(detect('结果分享给合作者')).toBe('share');
  });
});

describe('log number comparison (test_mobile_api.py compare cases)', () => {
  it('extract_params: ranges and units, longest unit wins; no unitless numbers', () => {
    const ps = extractParams('Filtered 0.5–40 Hz, epochs of 2 s, stored at 4 °C, 30 min rest, 2 kHz sampling.');
    expect(ps.map(p => [p.low, p.high, p.unit])).toEqual([[0.5, 40, 'Hz'], [2, 2, 's'], [4, 4, '°C'], [30, 30, 'min'], [2, 2, 'kHz']]);
    expect(extractParams('version 2.1 of the protocol')).toEqual([]);
  });
  it('mismatch with a page citation; trials not found; same golden log line', () => {
    const items = compareLog('I used band-pass 0.5-40 Hz, epochs 2 s, stored at 20 °C. Ran 3 trials.', CHUNKS, PAGES);
    const by = Object.fromEntries(items.map(i => [i.unit, i]));
    expect(by.Hz.status).toBe('mismatch'); expect(by.Hz.paper_value).toEqual([1, 40]);
    expect(by.Hz.citation?.page_number).toBe(2); expect(by.Hz.citation?.quote).toContain('1-40 Hz');
    expect(by.s.status).toBe('match'); expect(by.s.citation?.page_number).toBe(2);
    expect(by['°C'].status).toBe('mismatch');
    expect(by.trials.status).toBe('not_found'); expect(by.trials.citation).toBeNull();
    expect(mismatchCount(items)).toBe(2);
    expect(compareLog('Subject felt tired today.', CHUNKS, PAGES)).toEqual([]);
  });
  it('closest same shape wins; body sentence beats a table row; words come from the parameter clause', () => {
    const P = (low: number, high: number, raw: string) => ({ low, high, unit: 'Hz', raw });
    const log = P(500, 500, '500 Hz');
    const cands = [P(1, 40, '1-40 Hz'), P(512, 512, '512 Hz'), P(128, 128, '128 Hz')];
    expect(cands.reduce((b, c) => compare(distance(log, c), distance(log, b)) < 0 ? c : b).raw).toBe('512 Hz');
    function compare(a: number[], b: number[]) { return a[0] - b[0] || a[1] - b[1]; }
    const logText = 'Band-pass filtered 0.5-40 Hz, downsampled to 128 Hz, sampled at 500 Hz.';
    const lp = extractParams(logText)[0];
    const words = new Set([...logText.toLowerCase().matchAll(/[a-z]{4,}/g)].map(m => m[0]));
    const table = 'P300 ERP 1-40Hz 15 2000 ERN ERP 1-40Hz 26 340 MRCP ERP 0.1-40Hz 13 1100';
    const body = 'Data were digitally bandpass filtered to 1-40 Hz and downsampled to 128 Hz.';
    const rangeCands = [table, body].flatMap(s => extractParams(s).filter(p => p.low !== p.high).map(p => [p, {} as Chunk, s] as [ReturnType<typeof extractParams>[number], Chunk, string]));
    expect(rangeCands.reduce((b, c) => rank(lp, words, c) < rank(lp, words, b) ? c : b, rangeCands[0])[2]).toBe(body);
    const lp3 = extractParams(logText)[2];
    expect([...clauseWords(logText, lp3.raw)]).toEqual(['sampled']);
    const a = 'Data were band-pass filtered to 1-40 Hz and down-sampled to 128 Hz.';
    const b = 'EEG recordings were digitally sampled at 512 Hz from 64 scalp electrodes.';
    const single = [a, b].flatMap(s => extractParams(s).filter(p => p.low === p.high).map(p => [p, {} as Chunk, s] as [ReturnType<typeof extractParams>[number], Chunk, string]));
    const best = single.reduce((best2, c) => (cmp(rank(lp3, clauseWords(logText, lp3.raw), c), rank(lp3, clauseWords(logText, lp3.raw), best2)) < 0 ? c : best2));
    expect(best[0].raw).toBe('512 Hz');
    function cmp(x: number[], y: number[]) { for (let i = 0; i < 4; i++) { if (x[i] !== y[i]) return x[i] - y[i]; } return 0; }
  });
});

describe('citation tri-state (test_mobile_guidance.py)', () => {
  const sents = paperSentences(CHUNKS);
  it('exact / near with changed number / absolute words / cannot_check — same text as backend', () => {
    const text = 'EEG was band-pass filtered at 1-40 Hz before epoching. EEG was band-pass filtered at 1-30 Hz before ' +
      'epoching. All participants always took part in every demo recording session. The moon is made of cheese.';
    const items = citationCheck(text, sents, PAGES);
    expect(items[0].verdict).toBe('exact_match');
    expect(items[0].citation?.page_number).toBe(2);
    expect(items[0].needs_confirmation).toBe(false);
    const near = items[1];
    expect(near.verdict).toBe('near_match'); expect(near.citation).toBeNull(); expect(near.needs_confirmation).toBe(true);
    expect(near.candidate?.page_number).toBe(2); expect(near.candidate?.quote).toContain('1-40 Hz');
    expect(near.reason).toContain('30');
    expect(items[3].verdict).toBe('cannot_check'); expect(items[3].reason).toContain('not mean');
    for (const i of items) expect(['exact_match', 'near_match', 'cannot_check']).toContain(i.verdict);
    // Chinese wording is locate-aid only, never "verified"
    expect(VERDICT_LABEL.exact_match).toBe('找到原句');
    expect(VERDICT_LABEL.cannot_check).toContain('无法核对');
    expect(JSON.stringify(VERDICT_LABEL)).not.toMatch(/核验|已核实/);
  });
  it('paraphrase and reversed count are never exact (ECG 336/328 case)', () => {
    const pages = ['ECG arrhythmia detection\n\n2 Methods\nWe collect a test set of 336 records from 328 unique patients.\nEach record was annotated by a committee of three board-certified cardiologists.\n'];
    const items = citationCheck('Each of the 336 test records was drawn from a different patient.\nThree heart specialists jointly labelled every recording in the evaluation data.',
      paperSentences([{ page_index: 0, text: pages[0], section_role: 'methods' }]), pages);
    const [fake, para] = items;
    expect(fake.verdict).not.toBe('exact_match'); expect(fake.citation).toBeNull();
    expect(fake.verdict).toBe('near_match'); expect(fake.needs_confirmation).toBe(true);
    expect(fake.reason).toContain('328');
    expect(['near_match', 'cannot_check']).toContain(para.verdict);
    expect(items.map(i => i.verdict)).not.toContain('not_found');
  });
  it('a number bound to another entity is never exact (PhC-U373 / DIC-HeLa)', () => {
    const p = 'Cell tracking results\n\n3 Experiments\nThe first data set PhC-U373 contains glioblastoma cells recorded by phase contrast microscopy.\nIt contains 35 partially annotated training images.\nThe second data set DIC-HeLa are HeLa cells on a flat glass recorded by DIC microscopy.\nIt contains 20 partially annotated training images.';
    const [item] = citationCheck('The PhC-U373 dataset contains 20 partially annotated training images.',
      paperSentences([{ page_index: 0, text: p }]), [p]);
    expect(item.verdict).not.toBe('exact_match'); expect(item.citation).toBeNull();
    expect(item.verdict).toBe('near_match'); expect(item.reason).toContain('phc-u373');
  });
  it('names, negation and table rules; claim split keeps decimals; ligature anchor', () => {
    expect([...names('The PhC-U373 set has 512x512 images from a Drosophila larva.')].sort()).toEqual(['drosophila', 'phc-u373']);
    expect(support('The model does not use dropout layers.', 'The model uses dropout layers.').why.some(w => w.includes('negation'))).toBe(true);
    expect(support('Pixels near the image border are predicted by mirroring the input image.',
      'To predict the pixels in the border region, the input image is mirrored.').why).toEqual([]);
    expect(claims('A learning rate of 0.001 was used. Then 2.5 s epochs were cut.')).toEqual([
      'A learning rate of 0.001 was used.', 'Then 2.5 s epochs were cut.']);
    expect(findSpan('of the Drosophila ﬁrst instar larva ventral nerve cord', 'Drosophila first instar larva')).not.toBeNull();
    expect(tableLike('5 convolution 2D 8 8 * 64 + 8 (1, 64) (1, 1) (C, T, 8) Relu same 6 maxpooling 2D (1, 16)')).toBe(true);
    expect(tableLike('The training data is a set of 30 images (512x512 pixels) from serial section microscopy.')).toBe(false);
    expect(content('EEG was band-pass filtered at 1-40 Hz before epoching.').size).toBeGreaterThan(2);
  });
});

describe('minimal hypothesis, status chosen by the user (test_mobile_hypothesis.py)', () => {
  const cited: HypItemInput = { id: 'c1', text: 'Band-pass 1-40 Hz', citation: { quote: METHOD_SENTENCE, page_number: 2 } };
  const userItem: HypItemInput = { id: 'u1', text: 'Use a quiet room', citation: null };
  it('starts pending with empty history; only the four statuses; history keeps every change', () => {
    let h = newHypothesis('Filtering changes accuracy', [cited]);
    expect(h.status).toBe('pending'); expect(h.status_label).toBe('待验证'); expect(h.history).toEqual([]);
    expect(() => { setStatus(h, 'proven', 't', 'd'); }).toThrowError(/bad_status/);
    for (const [s, label] of [['supported', '支持'], ['refuted', '不支持'], ['insufficient', '证据不足']] as const) {
      h = setStatus(h, s, '2026-11-06T00:00:00Z', 'dev1');
      expect(h.status_label).toBe(label);
    }
    expect(h.history.map(x => x.to)).toEqual(['supported', 'refuted', 'insufficient']);
    for (const x of h.history) { expect(x.at).toBeTruthy(); expect(x.device_id).toBe('dev1'); }
  });
  it('comparison shows paper value + page next to the log, 日志未记录, 无论文依据; status unchanged', () => {
    const h = newHypothesis('Sampling rate matters', [cited, userItem]);
    const out = compareHypothesis([cited, userItem], [{ id: 'l1', text: '[SAMPLE] nothing measured today' }], 't1');
    expect(out.rows[0].page_number).toBe(2); expect(out.rows[0].paper_value).toBeTruthy();
    expect(out.rows[0].label).toBe('日志未记录');
    expect(out.rows[1].label).toBe('无论文依据'); expect(out.rows[1].page_number).toBeNull();
    const out2 = compareHypothesis([cited, userItem], [{ id: 'l2', text: '[SAMPLE] Recorded at 128 Hz' }], 't2');
    expect(out2.rows[0].log_values[0].value.endsWith('Hz')).toBe(true);
    expect(h.status).toBe('pending'); // comparing never sets a status
  });
  it('a number not on the cited page is 需确认', () => {
    const h = newHypothesis('Accuracy rises above 97531', [cited]);
    expect(h.number_check.state).toBe('needs_confirmation'); expect(h.number_check.label).toBe('需确认');
    expect(h.number_check.missing).toContain('97531');
    expect(numberCheck('Matches 40 Hz', [cited]).state).toBe('ok');
  });
});

describe('content-aware idea questions (test_mobile_guidance.py)', () => {
  it('questions cite method sentences on page 2, idea-mentioned topics first', () => {
    const { status, items } = questions(CHUNKS, 'I will filter our EEG and compare with a baseline', PAGES);
    expect(status).toBe('ok');
    expect(items.length).toBeGreaterThanOrEqual(2); expect(items.length).toBeLessThanOrEqual(5);
    expect(items.slice(0, 2).map(i => i.topic)).toEqual(['filtering', 'controls']);
    for (const i of items) {
      expect(i.citation.page_number).toBe(2); expect(i.question).toBeTruthy(); expect(i.decision).toBeNull();
      expect(findSpan(PAGES[1], i.citation.quote)).not.toBeNull();
    }
  });
  it('no topic in the idea -> no questions; the idea number is quoted against the paper page', () => {
    expect(questions(CHUNKS, 'my idea', PAGES).items).toEqual([]);
    const { items } = questions(CHUNKS, 'We will band-pass filter at 0.5-45 Hz', PAGES);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.citation.page_number).toBeGreaterThanOrEqual(1);
    expect(new Set(items.map(i => i.topic))).toEqual(new Set(items.map(i => i.topic).filter(t => ['filtering', 'sampling', 'sample_size'].includes(t))));
    const f = items.find(i => i.topic === 'filtering')!;
    expect(f.question).toContain('0.5-45 Hz');
    expect(f.question).toContain(`第 ${f.citation.page_number} 页`);
  });
  it('no method section -> method_section_not_found and no items (never a generic template)', () => {
    expect(methodSegments([{ page_index: 0, text: 'Introduction\nWe discuss related work.' }])).toEqual(
      { status: 'method_section_not_found', segments: [] });
    expect(questions([{ page_index: 0, text: 'Introduction\nWe discuss related work.' }], 'filter our EEG').items).toEqual([]);
    expect(keepSentence(METHOD_SENTENCE)).toBe(true);
    expect(keepSentence('Figure 3. The accuracy is 95%.')).toBe(false);
    expect(specific('0.5-45 Hz', METHOD_SENTENCE, 1)).toBe('你的想法写的是 0.5-45 Hz,论文第 2 页写的是 1-40 Hz。');
    expect(ideaWords('We will filter our EEG')[Symbol.iterator]().next().value).toBe('filter');
  });
});
