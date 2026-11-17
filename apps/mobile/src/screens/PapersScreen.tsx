// 文献 (plan 2.4; 板块修改总结 merged 文献管理 in): the papers on this phone's shelf with their code and data links and
// GB/T 7714 references, 查重提醒 for a paragraph of your own draft, and 综述矛盾点 between
// two papers. Rules only, every hit is a sentence found on its page; what to do about it is the user's call. A
// contradiction can go into the 科研 book as a debt to explain: "these two disagree; which holds, and why?"
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { book, today } from '../ledger/book';
import { newId } from '../local/store';
import { loadShelf, unshelve, type Shelved } from '../local/shelf';
import { conflicts, sameAs, type Conflict, type Same } from '../rules/overlap';
import { preferencesKV } from '../storage/kv';
import { PaperLinks, RefExport } from './PaperExtras';

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function PapersScreen() {
  const [shelf, setShelf] = useState<Shelved[]>([]);
  const [draft, setDraft] = useState('');
  const [same, setSame] = useState<Same[] | null>(null);
  const [clash, setClash] = useState<Conflict[] | null>(null);
  const [booked, setBooked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  useEffect(() => { void loadShelf(preferencesKV).then(setShelf); }, []);

  async function remove(id: string) { await unshelve(preferencesKV, id); setShelf(await loadShelf(preferencesKV)); setClash(null); setSame(null); }
  function check() { setSame(sameAs(draft, shelf)); }
  function compare() { setClash(conflicts(shelf)); setBooked(new Set()); }
  async function bookIt(c: Conflict, i: number) {
    await book.add({ clientId: newId(), board: '科研', topic: tr('综述'), helpLevel: 'hint',
      question: tr('《{0}》第 {1} 页和《{2}》第 {3} 页说法相反：哪个成立，为什么？', c.a.paper, c.a.page, c.b.paper, c.b.page),
      answer: `${c.a.quote}\n${c.b.quote}`, ownIdea: '' }, today());
    setBooked(new Set([...booked, i])); setNote(tr('记进科研账本了。到日子讲讲你怎么看，写综述时这一段就有了。'));
  }

  return (
    <section data-testid="papers">
      <h1>{tr('文献')}</h1>
      <div className="card">
        <h2>{tr('手机上的论文')}</h2>
        {shelf.length === 0 && <p className="muted">{tr('还没有导入论文。在「提问」里导入，最多留最近 {0} 篇。', 5)}</p>}
        <ul className="plain">{shelf.map(p => (
          <li key={p.versionId} className="paper-item">
            <div className="row"><span className="file-name">{tr('《{0}》，{1} 页', p.name, p.pages.length)}</span>
              <button className="ghost" onClick={() => void remove(p.versionId)}>{tr('移出')}</button></div>
            <PaperLinks paper={p} />
          </li>
        ))}</ul>
      </div>
      {shelf.length > 0 && <RefExport shelf={shelf} />}

      <div className="card">
        <h2>{tr('查重提醒')}</h2>
        <p className="muted">{tr('粘贴你自己写的一段。和这些论文里几乎一样、又没加引号的句子会被标出来：改成自己的话，或者加上引用。')}</p>
        <textarea value={draft} data-testid="draft" placeholder={tr('粘贴你写的段落')} onChange={x => { setDraft(x.target.value); setSame(null); }} />
        <button className="primary" disabled={!draft.trim() || !shelf.length} onClick={check}>{tr('查一查')}</button>
        {same && (same.length === 0
          ? <p className="note" role="status">{tr('没有和这些论文几乎一样的句子。')}</p>
          : <ul className="plain" data-testid="same">{same.map((s, i) => (
            <li key={i} className="quote">
              <div><b>{tr('你写的')}</b> {clip(s.mine)}</div>
              <div><span className="cite">{tr('《{0}》第 {1} 页', s.paper, s.page)}</span> “{clip(s.quote)}”</div>
              <div className="muted">{tr('{0}% 相同。改成自己的话，或者加上引用。', s.same)}</div>
            </li>
          ))}</ul>)}
      </div>

      <div className="card">
        <h2>{tr('综述矛盾点')}</h2>
        <p className="muted">{tr('找两篇论文对同一件事说法相反的地方，并排放出原文和页码。')}</p>
        <button className="primary" disabled={shelf.length < 2} onClick={compare}>{shelf.length < 2 ? tr('至少要两篇论文') : tr('找一找')}</button>
        {clash && (clash.length === 0
          ? <p className="note" role="status">{tr('这些论文里没找到说法相反的句子。规则只认同一件事上一个说增加、一个说降低这类明说的相反。')}</p>
          : <ul className="plain" data-testid="conflicts">{clash.map((c, i) => (
            <li key={i} className="two-col">
              <div className="quote"><span className="cite">{tr('《{0}》第 {1} 页', c.a.paper, c.a.page)}</span> “{clip(c.a.quote)}”</div>
              <div className="quote"><span className="cite">{tr('《{0}》第 {1} 页', c.b.paper, c.b.page)}</span> “{clip(c.b.quote)}”</div>
              <button className="ghost" disabled={booked.has(i)} onClick={() => void bookIt(c, i)}>{booked.has(i) ? tr('记下了') : tr('记一笔：讲讲哪个对')}</button>
            </li>
          ))}</ul>)}
        {note && <p className="note" role="status">{note}</p>}
      </div>
    </section>
  );
}
