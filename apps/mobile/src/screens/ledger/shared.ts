// What the ledger's sub-pages share: the model as examiner, the imported paper as the recall and citation source.
import { tr } from '../../i18n';
import type { Ask, Entry, Grade } from '../../ledger/ledger';
import { chat } from '../../model/direct';
import { forJob, loadKey, loadModelSettings } from '../../model/settings';
import { preferencesKV } from '../../storage/kv';
import { loadPaper, paperPages } from '../../local/paperStore';
import type { Source } from '../../rules/recall';

const GRADE_SYSTEM = '根据参考答案列出正确回答必须包含的 2 到 6 个要点，再按从 0 开始的序号列出作答在实质上讲到了哪些。不要判断通过与否。只回复 JSON：' + '{"points":[],"hits":[]}';

/** The user's own model as examiner (it only reports which points were hit), or undefined with no key. */
export async function modelAsk(): Promise<Ask | undefined> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return undefined;
  return (q, ref, attempt) => chat(forJob(s, 'grade'), key, [{ role: 'system', content: GRADE_SYSTEM },
    { role: 'user', content: `问题：\n${q}\n\n参考答案：\n${ref}\n\n不看 AI 写的作答：\n${attempt}` }]);
}

/** The paper imported on this phone, as the recall and citation rules read it; null before any import. */
export async function importedPaper(): Promise<Source | null> {
  const p = await loadPaper(preferencesKV);
  return p ? { name: p.ref.name, pages: paperPages(p) } : null;
}

export const missed = (g: Grade): string[] => g.points.filter((_, i) => !g.hits.includes(i));
export const missedOf = (g: Grade): string => missed(g).join('；');
export const redTag = (e: Entry): string => (e.kind === 'conclusion' ? tr('崩分') : tr('讲不出来'));
const clip = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Praise that names what was said well, never a score. */
export const praise = (g: Grade): string =>
  g.hits.length ? tr('讲顺了。你把「{0}」讲出来了，这笔还上了。', clip(g.points[g.hits[0]])) : tr('讲顺了，这笔还上了。');
