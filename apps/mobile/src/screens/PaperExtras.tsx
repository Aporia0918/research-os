// 文献 in 科研: each paper's code and data links (hung on its debts) and its GB/T 7714 reference, kept on this phone.
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { copyText } from '../ledger/book';
import type { Shelved } from '../local/shelf';
import { allRefs, linksFor, saveRef, setLinks } from '../local/paperExtras';
import { cleanLink, findLinks, kindOf, type LinkKind, type PaperLink } from '../rules/paperLinks';
import { complete, gbt7714, guessRef, type Ref, type RefType } from '../rules/gbt7714';
import { shareFile } from '../backup/native';
import { preferencesKV } from '../storage/kv';

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

/** Links found in the paper wait for 挂上; any http(s) link can be added by hand. */
export function PaperLinks({ paper }: { paper: Shelved }) {
  const [saved, setSaved] = useState<PaperLink[]>([]);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<LinkKind>('code');
  useEffect(() => { void linksFor(preferencesKV, paper.name).then(setSaved); }, [paper.name]);
  const keep = async (ls: PaperLink[]) => setSaved(await setLinks(preferencesKV, paper.name, ls));
  const found = findLinks(paper.pages).filter(f => !saved.some(s => s.url.toLowerCase() === f.url.toLowerCase()));
  const typed = cleanLink(url);
  return (
    <div className="paper-part">
      <b>{tr('代码和数据链接')}</b>
      {saved.length > 0 ? <LinkList links={saved} onDrop={l => void keep(saved.filter(x => x.url !== l.url))} />
        : <p className="muted">{tr('还没有挂上的链接。挂上后，讲这篇论文的账时能直接看到。')}</p>}
      {found.length > 0 && (
        <ul className="plain" data-testid="found-links">{found.map(f => (
          <li key={f.url} className="row">
            <span className="link-kind">{tr(KIND[f.kind])}</span>
            <span className="link-url">{f.url}<span className="muted"> · {tr('第 {0} 页', f.page ?? 0)}</span></span>
            <button className="ghost small" onClick={() => void keep([...saved, f])}>{tr('挂上')}</button>
          </li>
        ))}</ul>)}
      <div className="row">
        <input value={url} placeholder={tr('自己加一个链接')} aria-label={tr('链接')} onChange={e => { setUrl(e.target.value); const k = cleanLink(e.target.value); if (k && kindOf(k)) setKind(kindOf(k)!); }} />
        <select value={kind} aria-label={tr('链接类型')} onChange={e => setKind(e.target.value as LinkKind)}>
          <option value="code">{tr('代码')}</option><option value="dataset">{tr('数据集')}</option>
        </select>
        <button className="ghost small" disabled={!typed} onClick={() => { void keep([...saved, { kind, url: typed! }]); setUrl(''); }}>{tr('加上')}</button>
      </div>
    </div>
  );
}

const splitAuthors = (s: string) => s.split(/[\n;；、]+|,(?=\s*[㐀-鿿])/).map(x => x.trim()).filter(Boolean);

/** One paper's reference fields, guessed where the rules can and checked by the user. */
export function RefEditor({ paper, value, onSave }: { paper: Shelved; value?: Ref; onSave: (r: Ref) => void }) {
  const [r, setR] = useState<Ref>(value ?? guessRef(paper.name, paper.pages));
  const [who, setWho] = useState((value?.authors ?? []).join('\n'));
  const cur = { ...r, authors: splitAuthors(who) };
  const set = (k: keyof Ref) => (e: { target: { value: string } }) => setR({ ...r, [k]: e.target.value });
  return (
    <div className="paper-part form" data-testid="ref-editor">
      <b>{tr('参考文献（GB/T 7714）')}</b>
      <select value={r.type} aria-label={tr('文献类型')} onChange={e => setR({ ...r, type: e.target.value as RefType })}>
        <option value="J">{tr('期刊论文')}</option><option value="C">{tr('会议论文')}</option>
      </select>
      <textarea value={who} rows={2} aria-label={tr('作者')} placeholder={tr('作者，一行一位，或用分号隔开')} onChange={e => setWho(e.target.value)} />
      <input value={r.title} aria-label={tr('题名')} placeholder={tr('题名')} onChange={set('title')} />
      <input value={r.source} aria-label={r.type === 'C' ? tr('会议录名') : tr('刊名')} placeholder={r.type === 'C' ? tr('会议录名') : tr('刊名')} onChange={set('source')} />
      <div className="row">
        <input value={r.year} inputMode="numeric" aria-label={tr('年')} placeholder={tr('年')} onChange={set('year')} />
        <input value={r.volume ?? ''} aria-label={tr('卷')} placeholder={tr('卷')} onChange={set('volume')} />
        <input value={r.issue ?? ''} aria-label={tr('期')} placeholder={tr('期')} onChange={set('issue')} />
        <input value={r.pages ?? ''} aria-label={tr('页码')} placeholder={tr('页码')} onChange={set('pages')} />
      </div>
      <input value={r.doi ?? ''} aria-label="DOI" placeholder="DOI" onChange={set('doi')} />
      <p className="quote ref-line" data-testid="ref-line">{gbt7714(cur)}</p>
      <button className="ghost" disabled={!complete(cur)} onClick={() => onSave(cur)}>{complete(cur) ? tr('存下这条') : tr('还缺题名、刊名或年份')}</button>
    </div>
  );
}

/** All saved references, numbered in shelf order, as a text file through the share sheet (copied off the phone). */
export function RefExport({ shelf }: { shelf: Shelved[] }) {
  const [refs, setRefs] = useState<Record<string, Ref>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { void allRefs(preferencesKV).then(setRefs); }, []);
  const ready = shelf.filter(p => refs[p.versionId] && complete(refs[p.versionId]));
  async function save(p: Shelved, r: Ref) { await saveRef(preferencesKV, p.versionId, r); setRefs(await allRefs(preferencesKV)); setOpen(null); setMsg(tr('存下了。')); }
  async function exportAll() {
    const text = ready.map((p, i) => `[${i + 1}] ${gbt7714(refs[p.versionId])}`).join('\n');
    const how = await shareFile('references-gbt7714.txt', `${text}\n`, tr('导出参考文献'));
    setMsg(how === 'copied' ? tr('已复制 {0} 条参考文献。', ready.length) : tr('已导出 {0} 条参考文献。', ready.length));
  }
  return (
    <div className="card" data-testid="refs">
      <h2>{tr('参考文献')}</h2>
      <p className="muted">{tr('按 GB/T 7714-2015 生成。DOI 和年份从论文里找，其余请自己核对填好。')}</p>
      <ul className="plain">{shelf.map(p => (
        <li key={p.versionId}>
          <div className="row"><span className="file-name">{tr('《{0}》', p.name)}{refs[p.versionId] && complete(refs[p.versionId]) ? ' ✓' : ''}</span>
            <button className="ghost small" onClick={() => setOpen(open === p.versionId ? null : p.versionId)}>{open === p.versionId ? tr('收起') : tr('填写')}</button></div>
          {open === p.versionId && <RefEditor paper={p} value={refs[p.versionId]} onSave={r => void save(p, r)} />}
        </li>
      ))}</ul>
      <button className="primary" disabled={!ready.length} onClick={() => void exportAll()}>{tr('导出参考文献（{0} 条）', ready.length)}</button>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}
