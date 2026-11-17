import { useMemo, useState } from 'react';
import { tr } from '../../i18n';
import type { Entry } from '../../ledger/ledger';
import { searchEntries } from '../../ledger/search';
import { redTag } from './shared';

/** 搜索账本: find a debt by any word, see what you said and what AI said, and repay it from here. */
export function SearchView({ all, onRepay }: { all: Entry[]; onRepay: (e: Entry) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const hits = useMemo(() => searchEntries(all, q), [all, q]);
  return (
    <>
      <h1>{tr('搜索账本')}</h1>
      <input type="search" autoFocus value={q} placeholder={tr('问题、你的想法、AI 的回答、课程都能搜')}
        aria-label={tr('搜索账本')} onChange={e => { setQ(e.target.value); setOpen(null); }} data-testid="search-input" />
      {q.trim() && !hits.length && <p className="muted">{tr('没有找到含「{0}」的账。', q.trim())}</p>}
      {hits.length > 0 && <p className="muted" role="status">{tr('找到 {0} 笔', hits.length)}</p>}
      <div className="search-hits">
        {hits.map(({ entry: e, snippet, where }) => (
          <div key={e.id} className="card search-hit" data-testid="search-hit">
            <button type="button" className="course-row" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="course-name">
                <span className="tag">{tr(e.board)}{e.topic ? ` · ${e.topic}` : ''}</span>
                {e.question}{e.red && <span className="red-tag">{redTag(e)}</span>}
                {where !== 'question' && <span className="muted">{snippet}</span>}
              </span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
            {open === e.id && (
              <div className="hit-detail">
                {e.ownIdea && <p><b>{tr('你当时的想法')}</b> {e.ownIdea}</p>}
                <p><b>{tr('AI 的回答')}</b> {e.answer}</p>
                {e.usedIn && <p><b>{tr('用在哪里')}</b> {e.usedIn}</p>}
                <p className="muted">{e.dueOn ? tr('还没还清，下次 {0}', e.dueOn) : tr('已经还清')}</p>
                {e.dueOn && e.board !== '生活' && <button className="primary" onClick={() => onRepay(e)}>{tr('现在讲给我听')}</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
