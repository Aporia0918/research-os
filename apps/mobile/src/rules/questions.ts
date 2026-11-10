// Port of researchos/services/mobile/guidance.py counter-questions + idea_terms.py + plan.py sentence/section rules.
// Content-aware: only topics the idea itself mentions; every question cites a page; no topic -> no question.
// Method-section detection is a faithful port of plan.py; citable sentences require the quote to sit on that page.
import { extractParams, sentences, type Chunk } from './compare';
import { findSpan } from './text';

export const MAX_QUESTIONS = 5;
export const METHOD_FOUND = 'ok';
export const METHOD_NOT_FOUND = 'method_section_not_found';

const MATERIAL = /\b(amplifiers?|electrodes?|sensors?|EEG cap|headset|monitor|software|toolbox|EEGLAB|MNE|MATLAB|Python|PyTorch|TensorFlow|Theano|Keras|Lasagne|scikit-learn|GPU|NVIDIA|BioSemi|Brain ?Products|BrainAmp|g\.tec|g\.USBamp|Neuroscan|ActiCap|Ag\/AgCl|recording system|acquisition system|scanner|camera|microscope|reagents?|kit|instrument|recorded (?:using|with)|acquired (?:using|with)|(?:public|publicly available) dataset|BCI Competition [IVX]+[- ]?\w*)\b/i;

export interface Template { topic: string; idea: RegExp; paper: RegExp; question: string }
export const TEMPLATES: Template[] = [
  { topic: 'sampling', idea: /sampl|hz|record|采样/i,
    paper: /\b(?:sampl\w*|recorded|digiti[sz]ed|down-?sampl\w*)\b[^.]*\d|\d[^.]*\b(?:sampl\w*|down-?sampl\w*)/i,
    question: '你的采样率(和下采样)和论文一致吗?不一致时结果还能直接比较吗?' },
  { topic: 'filtering', idea: /filt|band|noise|artifact|滤波|预处理/i,
    paper: /\b(?:band-?pass\w*|high-?pass\w*|low-?pass\w*|notch|filter(?:ed|ing)?|standardi[sz]\w*|normali[sz]\w*|pre-?process\w*)\b/i,
    question: '你的滤波 / 预处理步骤是什么?和论文写的一样吗?' },
  { topic: 'split', idea: /split|cross|valid|test|generali|subject|划分|验证|被试/i,
    paper: /\b(?:cross-validat\w*|training set|test set|validation set|held[- ]out|leave-one-\w+|train(?:ing)?\/test|within-subject|cross-subject|folds?)\b/i,
    question: '你打算怎么划分训练 / 验证 / 测试数据?按被试还是被试内?' },
  { topic: 'controls', idea: /compar|baseline|control|benchmark|对照|比较|基线/i,
    paper: /\b(?:baselines?|control (?:group|condition)|compared? (?:with|to|against)|comparison|benchmark\w*|sham|placebo)\b/i,
    question: '你的对照(基线模型或对照组)是什么?和论文用的一样吗?' },
  { topic: 'equipment', idea: /device|amplif|electrode|scanner|microscop|gpu|software|设备|仪器/i,
    paper: MATERIAL, question: '你用的设备 / 软件和论文一样吗?不一样时哪些参数要重新确认?' },
  { topic: 'sample_size', idea: /subject|participant|patient|sample|cells?|images?|data|被试|样本|数据/i,
    paper: /\b\d+\s+(?:subjects|participants|patients|volunteers|mice|rats|samples|cells|images|datasets|trials|sessions|classes)\b/i,
    question: '你的样本量(被试 / 样本 / 试次)有多少?够不够和论文比较?' },
  { topic: 'training', idea: /train|model|network|epoch|learn|训练|模型|网络/i,
    paper: /\b(?:learning rate|epochs?|optimi[sz]er|Adam|batch size|early stopping|dropout|iterations)\b/i,
    question: '你的训练设置(轮数、学习率、停止条件)打算怎么定?照论文还是自己调?' },
];

export function ideaWords(idea: string): Set<string> {
  const STOP = new Set(['will', 'with', 'from', 'that', 'this', 'then', 'into', 'using', 'use', 'our', 'they', 'want', 'plan', 'idea',
    'data', 'paper', 'like', 'same', 'also', 'have', 'what', 'when', 'which', 'would', 'could', 'should']);
  return new Set([...idea.toLowerCase().matchAll(/[a-z]{4,}/g)].map(m => m[0]).filter(w => !STOP.has(w)));
}
/** The idea's own numbers set against the paper's numbers of the same unit on that page. */
export function specific(idea: string, sentence: string, page: number): string {
  const paper = extractParams(sentence);
  for (const a of extractParams(idea)) {
    const b = paper.find(p => p.unit === a.unit);
    if (b) return `你的想法写的是 ${a.raw},论文第 ${page + 1} 页写的是 ${b.raw}。`;
  }
  if (paper.length) return `论文第 ${page + 1} 页写的是 ${paper[0].raw},你的想法里没有写这个数值。`;
  return '';
}

// ---- keep_sentence (plan.py) ---------------------------------------------------------------------------------
const CAPTION = /^(?:fig(?:ure)?\.?\s*\d|figs?\.|table\s+[\dIVX]|tab\.|stars indicate|error bars|\(?[a-h]\)\s)|\b(?:stars indicate|error bars (?:show|indicate|denote))/i;
const POINTER = /can be found in|(?:see|in) (?:the )?(?:supplementary|appendix|section)|supplementary (?:sections?|materials?|tables?|figures?)/i;
const RESULTISH = /\b(?:best[- ]performing|outperform\w*|state[- ]of[- ]the[- ]art|significantly (?:better|worse|higher|lower)|achiev\w* (?:an? )?(?:accuracy|performance)|accuracy of \d)|\d+(?:\.\d+)?\s*%/i;
const MATH = new Set([...'=θ∑∏∈≤≥^_{}|∂∫λσμαβ∗·×√∀∃→←']);
export function isTableRowFast(s: string): boolean { return extractParams(s).length >= 3; }
function looksLikeFormula(s: string): boolean {
  const chars = [...s].filter(c => !/\s/.test(c));
  const letters = chars.filter(c => /[a-zA-Z]/.test(c)).length;
  if (!chars.length || letters / chars.length < 0.7 || [...s].filter(c => MATH.has(c)).length >= 2) return true;
  return /\b(?:exp|log|argmax|softmax)\(|\w\([^)]*;/.test(s);
}
function garbled(s: string): boolean {
  const toks = s.split(/\s+/).filter(Boolean);
  const short = toks.filter(t => t.length === 1 && /[a-zA-Z]/.test(t) && !['a', 'A', 'I'].includes(t)).length;
  return !toks.length || short / toks.length > 0.15;
}
export function keepSentence(s: string): boolean {
  const one = s.split(/\s+/).join(' ');
  if (one.length < 25 || one.length > 600 || one.includes('arXiv')) return false;
  if (!/^[A-Z]/.test(one) || !/[.;!?)]$/.test(one)) return false;
  return !(isTableRowFast(one) || CAPTION.test(one) || POINTER.test(one) || RESULTISH.test(one) || looksLikeFormula(one) || garbled(one));
}

// ---- method section detection (plan.py _heading / method_segments) ----------------------------------------------
const HEAD = /^\s*(?:(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+|([IVX]{1,4})\.\s*|([A-H])\.\s+)?([A-Z][A-Za-z0-9 ,:&/()\-–]{2,70}?)\s*:?\s*$/;
const SMALLCAPS = /\b([A-Z]) ([A-Z]{2,})\b/g;
const START_T = /^(?:materials? and methods?|methods? and materials?|methods?|methodology|patients and methods|experimental (?:setup|settings?|design|procedures?|methods?|protocol)|experiment(?:al)? setup|study design|datasets?\b|data ?sets?\b|data (?:description|acquisition|collection|recording|pre-?processing|and)|implementation(?: details)?|training\b|network architecture|model architecture|architecture|pre-?processing|participants|subjects)/i;
const START_SUB = /^(?:implementation details|experimental (?:setup|settings?)|datasets?\b|data ?sets?\b|data (?:description|acquisition|collection|pre-?processing))/i;
const STOP_T = /^(?:abstract|introduction|background|related works?|prior work|results?\b|experimental results|experiments?$|evaluation|discussion|conclusions?|summary|acknowledge?ments?|acknowlegements?|references|bibliography|appendix|appendices|supplementary|limitations|future work|funding|author contributions)/i;
const KEYWORD_ONLY = /^(?:abstract|references|bibliography|acknowledge?ments?|methods?|materials and methods|methodology|introduction|results|discussion|conclusions?)$/i;
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
type Heading = { level: number; top: number; kind: 'start' | 'stop' | 'other' | 'start_sub' };
export function heading(line: string): Heading | null {
  const one = line.trim().replace(SMALLCAPS, '$1$2');
  const m = one.match(HEAD);
  if (!m || one.split(/\s+/).length > 10) return null;
  const title = m[4].trim();
  let level = 0; let top = 0;
  if (m[1]) {
    const parts = m[1].split('.');
    level = parts.length; top = Number(parts[0]);
    if (top === 0 || top > 20) return null;
  } else if (m[2]) {
    if (!(m[2] in ROMAN)) return null;
    level = 1; top = ROMAN[m[2]];
  } else if (m[3]) { level = 2; top = 0; }
  else { if (!KEYWORD_ONLY.test(title)) return null; level = 0; top = 0; }
  if ([...title].filter(c => /[a-zA-Z]/.test(c)).length < 3) return null;
  let kind: Heading['kind'] = START_T.test(title) ? 'start' : STOP_T.test(title) ? 'stop' : 'other';
  if (kind === 'start' && level >= 2 && START_SUB.test(title)) kind = 'start_sub';
  return { level, top, kind };
}
function closes(kind: string, level: number, top: number, openerLevel: number, openerTop: number): boolean {
  if (kind === 'stop') return level <= 1 || level <= openerLevel;
  if (kind !== 'other') return false;
  if (level === 1) return top > openerTop && openerLevel <= 1;
  return openerLevel >= 2 && level <= openerLevel;
}
export function methodSegments(chunks: Chunk[]): { status: string; segments: Chunk[] } {
  const ordered = [...chunks].sort((a, b) => a.page_index - b.page_index || (a.seq ?? 0) - (b.seq ?? 0));
  let inside = false; let found = false; let openerLevel = 0; let openerTop = 0; let topNow = 0;
  const out: Chunk[] = [];
  for (const c of ordered) {
    const keep: string[] = [];
    for (const line of c.text.split('\n')) {
      const h = heading(line);
      if (!h) { if (inside) keep.push(line); continue; }
      const { level, top, kind } = h;
      if (level === 1) topNow = Math.max(topNow, top);
      const opens = kind === 'start_sub' || (kind === 'start' && (inside || level <= 1));
      if (opens) {
        if (!inside || (level <= 1 && openerLevel <= 1)) { openerLevel = level; openerTop = topNow; }
        inside = true; found = true;
      } else if (inside && closes(kind, level, top, openerLevel, openerTop)) inside = false;
    }
    if (keep.length) out.push({ ...c, text: keep.join('\n') });
  }
  return { status: found ? METHOD_FOUND : METHOD_NOT_FOUND, segments: out };
}

export interface QuestionItem {
  topic: string; question: string; why: string;
  citation: { page_number: number; page_index?: number; quote: string }; source: 'paper';
  decision: null; user_text: null;
}
export function questions(chunks: Chunk[], idea: string, pages: string[] | null = null): { status: string; items: QuestionItem[] } {
  const { status, segments } = methodSegments(chunks);
  if (status !== METHOD_FOUND) return { status, items: [] };
  const sents = segments.flatMap(c => sentences(c.text).filter(keepSentence).map(s => ({ page: c.page_index, s })));
  const words = ideaWords(idea);
  const units = new Set(extractParams(idea).map(p => p.unit));
  const rank = (x: { page: number; s: string }): [number, number, number] => {
    const low = x.s.toLowerCase();
    const shared = extractParams(x.s).filter(p => units.has(p.unit)).length;
    return [-shared, -[...words].filter(w => low.includes(w)).length, /\d/.test(x.s) ? 0 : 1];
  };
  const items: QuestionItem[] = []; const used = new Set<string>();
  for (const t of TEMPLATES) {
    if (!t.idea.test(idea)) continue;
    const sorted = [...sents].sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      for (let i = 0; i < 3; i += 1) { if (ra[i] !== rb[i]) return ra[i] - rb[i]; }
      return 0;
    });
    for (const { page, s } of sorted) {
      if (used.has(s) || !t.paper.test(s)) continue;
      const quote = s.slice(0, 600);
      if (pages && !findSpan(pages[page] ?? '', quote)) continue; // cite only what is on that page
      used.add(s);
      items.push({ topic: t.topic, question: specific(idea, s, page) + t.question,
        why: `你的想法提到了这一点;论文第 ${page + 1} 页写了它(见引文),需要对上或说明不同。`,
        citation: { page_number: page + 1, page_index: page, quote }, source: 'paper', decision: null, user_text: null });
      break;
    }
    if (items.length >= MAX_QUESTIONS) break;
  }
  return { status, items };
}
