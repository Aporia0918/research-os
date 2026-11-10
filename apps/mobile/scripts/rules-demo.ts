// 11-08 acceptance: deliberately wrong numbers are blocked; 11-09: plan gate -> approval ->
// hypothesis -> non-empty counter-questions. Pure rules, no model, computer off. 非真机.
import { tagItem, requireNumbersClosed, decideNumber, RuleError } from '../src/rules/numberGate';
import { tagAction, decideAction, requireConfirmable } from '../src/rules/planActions';
import { compareLog, type Chunk } from '../src/rules/compare';
import { newHypothesis, setStatus, compareHypothesis } from '../src/rules/hypothesis';
import { questions } from '../src/rules/questions';
import { citationCheck, paperSentences } from '../src/rules/citation';

const PAGES = ['', '2. Methods\nTwenty participants took part in the demo recording session.\nEEG was band-pass filtered at 1-40 Hz before epoching.\nEpochs lasted 2 s and were baseline corrected.\nSamples were stored at 4 °C overnight.\n'];
const CHUNKS: Chunk[] = [{ page_index: 1, text: PAGES[1], section_role: 'methods' }];
const quote = 'EEG was band-pass filtered at 1-40 Hz before epoching.';
const log = (s: string) => console.log(s);

log('— 故意写错数字 —');
const wrong = tagItem({ id: 'i1', text: 'Band-pass 1-40 Hz, sampled at 256 Hz', citation: { quote } });
log(`状态=${wrong.number_gate?.state} 缺=${wrong.number_gate?.missing?.join(',')} 标签=${wrong.number_gate?.label}`);
try { requireNumbersClosed([wrong]); } catch (e) {
  log(`确认计划被拦: ${(e as RuleError).status} ${(e as RuleError).code}`);
}
const fixed = decideNumber(wrong, 'reject_match', new Date().toISOString(), 'this-phone');
requireNumbersClosed([fixed]);
log(`用户选「不是这句」后闸门关闭,状态=${fixed.number_gate?.state}(用户决定,不是系统说数字对)`);

log('— 日志数字比对 2 s 对 2 s; 20 °C 对 4 °C —');
for (const i of compareLog('epochs 2 s, stored at 20 °C', CHUNKS, PAGES)) {
  log(`${i.parameter} ${i.status} 论文=${i.paper_value ?? '-'} 页=${i.citation?.page_number ?? '-'}`);
}

log('— 关键动作批准 —');
const steps = [
  tagItem(tagAction({ id: 'a1', text: 'Upload the raw EEG to the lab server' })),
  tagItem(tagAction({ id: 'a2', text: 'EEG was band-pass filtered at 1-40 Hz before epoching.', citation: { quote } })),
];
try { requireConfirmable(steps); } catch (e) { log(`未批准被拦: ${(e as RuleError).code}`); }
const approved = steps.map(i => i.id === 'a1' ? decideAction(i, 'approve', new Date().toISOString(), 'this-phone') : i);
requireConfirmable(approved);
log('批准后计划可确认(草稿→确认),关键动作不实际执行');

log('— 假设:状态由你选择 —');
let h = newHypothesis('Filtering changes accuracy', [{ id: 'a2', text: 'x', citation: { quote, page_number: 2 } }]);
log(`新建状态=${h.status_label} history空`);
h = setStatus(h, 'supported', new Date().toISOString(), 'this-phone');
log(`你选「支持」后=${h.status_label},历史=${h.history.length}条`);
const cmp = compareHypothesis([{ id: 'a2', text: 'x', citation: { quote, page_number: 2 } }],
  [{ id: 'l1', text: 'Recorded at 128 Hz' }], new Date().toISOString());
log(`对照行:论文=${cmp.rows[0].paper_value} 页=${cmp.rows[0].page_number} 日志=${cmp.rows[0].log_values[0]?.value}`);

log('— 想法反问(带页码) —');
for (const q of questions(CHUNKS, 'I will filter our EEG at 0.5-45 Hz and compare with a baseline', PAGES).items) {
  log(`[${q.topic}] p.${q.citation.page_number} ${q.question}`);
}
log('— 引用三态 —');
for (const c of citationCheck('EEG was band-pass filtered at 1-40 Hz before epoching. EEG was band-pass filtered at 1-30 Hz before epoching. The moon is made of cheese.', paperSentences(CHUNKS), PAGES)) {
  log(`${c.verdict} 页=${c.citation?.page_number ?? c.candidate?.page_number ?? '-'} 需确认=${c.needs_confirmation}`);
}
log('OK demo done');
