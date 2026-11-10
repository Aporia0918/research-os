// Emits the same JSON shapes as /tmp/parity/py.py (the backend's own Python rule functions),
// minus py-generated ids/timestamps. Diffed by scripts/rules-parity.mjs via scripts/parity-py.sh.
import { writeFileSync } from 'node:fs';
import { extractParams, compareLog, methodPassages, sentences, type Chunk } from '../src/rules/compare';
import { missingNumbers, tagItem } from '../src/rules/numberGate';
import { detect, tagAction } from '../src/rules/planActions';
import { claims, citationCheck } from '../src/rules/citation';
import { numberCheck, rowFor } from '../src/rules/hypothesis';
import { names, tableLike } from '../src/rules/citationRules';
import { questions, specific } from '../src/rules/questions';

const PAGES = [
  'Demo EEG methods paper\n\nAbstract\nWe study a demo task with wearable EEG recordings.\n',
  '2. Methods\nTwenty participants took part in the demo recording session.\nEEG was band-pass filtered at 1-40 Hz before epoching.\nEpochs lasted 2 s and were baseline corrected.\nSamples were stored at 4 °C overnight.\n',
];
const CHUNKS: Chunk[] = [
  { page_index: 0, seq: 0, text: PAGES[0], section_role: 'abstract' },
  { page_index: 1, seq: 0, text: PAGES[1], section_role: 'methods' },
];
const quote = 'Signals were band-pass filtered between 1 and 40 Hz and sampled at 128 Hz.';
const out: Record<string, unknown> = {};
out.tag_model = tagItem({ id: 'x', text: 'Band-pass 1-40 Hz, sampled at 256 Hz', citation: { quote } });
out.missing_05 = missingNumbers('0.5 s', 'epochs of 0.5 s');
out.missing_5 = missingNumbers('5 s', 'epochs of 0.5 s');
out.extract = extractParams('Filtered 0.5–40 Hz, epochs of 2 s, stored at 4 °C, 30 min rest, 2 kHz sampling.');
out.detect = ['Upload the raw EEG to the lab server', 'Ask a cloud model (LLM) to label artifacts', 'baseline window 200 ms', 'band-pass 1-40 Hz', '结果分享给合作者'].map(detect);
out.tag_action = tagAction({ id: 'a', text: 'upload data' });
out.compare = compareLog('I used band-pass 0.5-40 Hz, epochs 2 s, stored at 20 °C. Ran 3 trials.', CHUNKS, PAGES);
out.claims = claims('A learning rate of 0.001 was used. Then 2.5 s epochs were cut.');
const text = 'EEG was band-pass filtered at 1-40 Hz before epoching. EEG was band-pass filtered at 1-30 Hz before epoching. ' +
  'All participants always took part in every demo recording session. The moon is made of cheese.';
// python harness replaced _paper_sentences without its whitespace join; mirror that shape exactly
const rawSents = CHUNKS.flatMap(c => sentences(c.text).map(s => ({ page: c.page_index, text: s })));
out.citation = citationCheck(text, rawSents, PAGES).map(i => ({ ...i, user_text: null }));
out.names = [...names('The PhC-U373 set has 512x512 images from a Drosophila larva.')].sort();
out.table = [tableLike('5 convolution 2D 8 8 * 64 + 8 (1, 64) (1, 1) (C, T, 8) Relu same 6 maxpooling 2D (1, 16)'),
  tableLike('The training data is a set of 30 images (512x512 pixels) from serial section microscopy.')];
out.questions = tuple(questions(CHUNKS, 'I will filter our EEG and compare with a baseline', PAGES));
out.questions2 = tuple(questions(CHUNKS, 'We will band-pass filter at 0.5-45 Hz', PAGES));
out.questions_none = tuple(questions(CHUNKS, 'my idea', PAGES));
out.hyp_numbers = numberCheck('Accuracy rises above 97531', [{ id: 'c1', text: 'x', citation: { quote: 'EEG was band-pass filtered at 1-40 Hz before epoching.' } }]);
out.hyp_row = rowFor({ id: 'c1', text: 'Band-pass 1-40 Hz', citation: { quote: 'EEG was band-pass filtered at 1-40 Hz before epoching.', page_number: 2 } }, [{ id: 'l1', text: '[SAMPLE] nothing measured today' }]);
out.hyp_row2 = rowFor({ id: 'u1', text: 'Use a quiet room' }, []);
out.specific = specific('We will band-pass filter at 0.5-45 Hz', 'EEG was band-pass filtered at 1-40 Hz before epoching.', 1);
void methodPassages; void extractParams;
function tuple(q: { status: string; items: unknown[] }) { return [q.status, q.items]; }
writeFileSync(process.argv[2] ?? '/tmp/parity/ts.json', JSON.stringify(out, null, 0));
console.log('wrote', process.argv[2] ?? '/tmp/parity/ts.json');
