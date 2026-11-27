// What the ledger's sub-pages share: the model as examiner, the imported paper as the recall and citation source.
import { tr } from '../../i18n';
import type { Ask, Entry, Grade } from '../../ledger/ledger';
import { chat } from '../../model/direct';
import { forJob, loadKey, loadModelSettings } from '../../model/settings';
import { preferencesKV } from '../../storage/kv';
import type { Source } from '../../rules/recall';
import { SPLIT_SYSTEM } from '../../ledger/growth';

const GRADE_SYSTEM = '根据参考答案列出正确回答必须包含的 2 到 6 个要点，再按从 0 开始的序号列出作答在实质上讲到了哪些。不要判断通过与否。只回复 JSON：' + '{"points":[],"hits":[]}';

/** The user's own model as examiner (it only reports which points were hit), or undefined with no key. */
export async function modelAsk(): Promise<Ask | undefined> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return undefined;
  return (q, ref, attempt) => chat(forJob(s, 'grade'), key, [{ role: 'system', content: GRADE_SYSTEM },
    { role: 'user', content: `问题：\n${q}\n\n参考答案：\n${ref}\n\n不看 AI 写的作答：\n${attempt}` }]);
}

/** The paper an earlier version imported on this phone, as the recall and citation rules read it; null when there is none. */
export async function importedPaper(): Promise<Source | null> {
  try {
    const p = JSON.parse((await preferencesKV.get('paper.localDocument.v2')) ?? 'null') as { ref?: { name?: string }; doc?: { pages?: { text: string }[] } } | null;
    return p?.ref?.name && Array.isArray(p.doc?.pages) ? { name: p.ref.name, pages: p.doc.pages.map(x => x.text) } : null;
  } catch { return null; }
}

export const missed = (g: Grade): string[] => g.points.filter((_, i) => !g.hits.includes(i));
export const missedOf = (g: Grade): string => missed(g).join('；');
export const redTag = (e: Entry): string => (e.kind === 'conclusion' ? tr('崩分') : tr('讲不出来'));
const clip = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Praise that names what was said well, never a score. */
export const praise = (g: Grade): string =>
  g.hits.length ? tr('讲顺了。你把「{0}」讲出来了，这笔还上了。', clip(g.points[g.hits[0]])) : tr('讲顺了，这笔还上了。');

const FIRST_SYSTEM = '用户第一次用思维账本，刚刚不看资料讲了一段自己在学的东西。用一两句中文，先具体说出讲得清楚的一处，再说一处可以再想想的地方。语气像朋友，不打分，不说对错，不给完整答案。';
/** The first explanation on first open: the user's own model says what was clear and what to think over; none without a key. */
export async function firstFeedback(said: string): Promise<string | null> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return null;
  try { return (await chat(forJob(s, 'grade'), key, [{ role: 'system', content: FIRST_SYSTEM }, { role: 'user', content: said }])).trim() || null; }
  catch { return null; }
}

/** What a board is called on screen: the 生活 board shows as 成长空间 (owner 2026-11-17); stored data keeps 生活. */
export const boardName = (b: Entry['board']): string => tr(b === '生活' ? '成长空间' : b);

/** 任务拆解: the user's own model suggests small steps for one deadline; '' without a key or on failure (the user writes them). */
export async function splitSteps(task: string): Promise<string> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return '';
  try { return (await chat(forJob(s, 'grade'), key, [{ role: 'system', content: SPLIT_SYSTEM }, { role: 'user', content: task }])).trim(); }
  catch { return ''; }
}
