// 文献 in 科研: the code and data links hung on a paper's debts, kept on this phone.
import { useState } from 'react';
import { tr } from '../i18n';
import { copyText } from '../ledger/book';
import type { LinkKind, PaperLink } from '../local/paperExtras';

const KIND: Record<LinkKind, string> = { code: '代码', dataset: '数据集' };

/** The links already hung on a paper's debts, shown where its debts are explained. */
export function LinkList({ links, onDrop }: { links: PaperLink[]; onDrop?: (l: PaperLink) => void }) {
  const [copied, setCopied] = useState('');
  return (
    <ul className="plain links" data-testid="paper-links">{links.map(l => (
      <li key={l.url} className="row">
        <span className="link-kind">{tr(KIND[l.kind])}</span>
        <span className="link-url">{l.url}</span>
        <button className="ghost small" onClick={() => void copyText(l.url).then(() => setCopied(l.url))}>{copied === l.url ? tr('已复制') : tr('复制')}</button>
        {onDrop && <button className="ghost small" aria-label={tr('取下 {0}', l.url)} onClick={() => onDrop(l)}>×</button>}
      </li>
    ))}</ul>
  );
}
