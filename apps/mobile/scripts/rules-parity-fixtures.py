import json, sys
sys.path.insert(0, '/workspace/Code/项目/20261011-ResearchOS/services/api')
from researchos.services.mobile import number_gate, compare, plan_actions, guidance, hypothesis
from researchos.services.mobile import idea_terms
from researchos.services.mobile.citation_rules import _names, _table_like
from researchos.services.knowledge.text import find_span

PAGES = [
  'Demo EEG methods paper\n\nAbstract\nWe study a demo task with wearable EEG recordings.\n',
  '2. Methods\nTwenty participants took part in the demo recording session.\nEEG was band-pass filtered at 1-40 Hz before epoching.\nEpochs lasted 2 s and were baseline corrected.\nSamples were stored at 4 °C overnight.\n',
]
CHUNKS = [{'page_index': 0, 'seq': 0, 'text': PAGES[0], 'section_role': 'abstract'},
          {'page_index': 1, 'seq': 0, 'text': PAGES[1], 'section_role': 'methods'}]
quote = 'Signals were band-pass filtered between 1 and 40 Hz and sampled at 128 Hz.'
out = {}
out['tag_model'] = number_gate.tag({'id': 'x', 'text': 'Band-pass 1-40 Hz, sampled at 256 Hz', 'citation': {'quote': quote}})
out['missing_05'] = number_gate.missing_numbers('0.5 s', 'epochs of 0.5 s')
out['missing_5'] = number_gate.missing_numbers('5 s', 'epochs of 0.5 s')
out['extract'] = [{'low': p.low, 'high': p.high, 'unit': p.unit, 'raw': p.raw} for p in compare.extract_params('Filtered 0.5–40 Hz, epochs of 2 s, stored at 4 °C, 30 min rest, 2 kHz sampling.')]
out['detect'] = [plan_actions.detect(t) for t in ['Upload the raw EEG to the lab server', 'Ask a cloud model (LLM) to label artifacts', 'baseline window 200 ms', 'band-pass 1-40 Hz', '结果分享给合作者']]
out['tag_action'] = plan_actions.tag({'id': 'a', 'text': 'upload data'})
class FakeConn:
    def __init__(self): self.quotes=None
class FakeEv:
    pass
# _cite uses the DB; monkeypatch it to the same find_span anchoring as the TS port
def fake_cite(conn, version_id, page_index, sentence, actor):
    if find_span(PAGES[page_index], sentence[:600]) is None:
        return None
    return {'page_index': page_index, 'page_number': page_index + 1, 'quote': sentence[:600]}
compare._cite = fake_cite
guidance._cite = fake_cite
def method_passages(conn, version_id):
    ms=[c for c in CHUNKS if c['section_role']=='methods']; rest=[c for c in CHUNKS if c['section_role'] not in ('methods','references')]; return ms+rest
compare._method_passages = method_passages
out['compare'] = compare.compare_deterministic(None, log_text='I used band-pass 0.5-40 Hz, epochs 2 s, stored at 20 °C. Ran 3 trials.', version_id='v', actor='a')
guidance._paper_sentences = lambda conn, vid: [(c['page_index'], s) for c in CHUNKS for s in compare._sentences(c['text'])]
guidance.plan_svc._ordered_chunks = lambda conn, vid: CHUNKS
out['claims'] = guidance._claims('A learning rate of 0.001 was used. Then 2.5 s epochs were cut.')
text = ('EEG was band-pass filtered at 1-40 Hz before epoching. EEG was band-pass filtered at 1-30 Hz before epoching. '
        'All participants always took part in every demo recording session. The moon is made of cheese.')
out['citation'] = guidance.citation_check(None, version_id='v', text=text, actor='a')
out['names'] = sorted(_names('The PhC-U373 set has 512x512 images from a Drosophila larva.'))
out['table'] = [_table_like('5 convolution 2D 8 8 * 64 + 8 (1, 64) (1, 1) (C, T, 8) Relu same 6 maxpooling 2D (1, 16)'),
                _table_like('The training data is a set of 30 images (512x512 pixels) from serial section microscopy.')]
out['hyp_numbers'] = hypothesis.number_check('Accuracy rises above 97531', [{'citation': {'quote': 'EEG was band-pass filtered at 1-40 Hz before epoching.'}}])
out['hyp_row'] = hypothesis._row_for({'id': 'c1', 'text': 'Band-pass 1-40 Hz', 'citation': {'quote': 'EEG was band-pass filtered at 1-40 Hz before epoching.', 'page_number': 2}}, [{'id': 'l1',  'text': '[SAMPLE] nothing measured today'}])
out['hyp_row2'] = hypothesis._row_for({'id': 'u1', 'text': 'Use a quiet room'}, [])
out['questions'] = guidance.questions_deterministic(None, version_id='v', idea='I will filter our EEG and compare with a baseline', actor='a')
out['questions2'] = guidance.questions_deterministic(None, version_id='v', idea='We will band-pass filter at 0.5-45 Hz', actor='a')
out['questions_none'] = guidance.questions_deterministic(None, version_id='v', idea='my idea', actor='a')
out['specific'] = idea_terms.specific('We will band-pass filter at 0.5-45 Hz','EEG was band-pass filtered at 1-40 Hz before epoching.',1)
print(json.dumps(out, ensure_ascii=False, default=str))
