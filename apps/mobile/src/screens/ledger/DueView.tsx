// 讲给我听 (plan 2.2): you explain, it only listens. A good explanation is praised by name; one that falls short is not
// scored or called a failure: 「一起捋一遍？」 walks the missed points and the debt comes back tomorrow. When the free
// grader is 拿不准 it asks for the explanation again in other words, once, without counting it. 改天再聊 and 这个不用了 are
// always one tap away. 结论债 is repaid by the null-world exam, 引用债 by pasting the original sentence.
import { useState, type ReactNode } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { tr } from '../../i18n';
import { book, today } from '../../ledger/book';
import { unsureGrade, type Entry } from '../../ledger/ledger';
import { loadKey, loadModelSettings } from '../../model/settings';
import { describeModelError } from '../../model/direct';
import { readHandwriting } from '../../logic/photoAsk';
import { preferencesKV } from '../../storage/kv';
import type { Moment } from '@jelly/mood';
import { importedPaper, missed, modelAsk, praise, redTag } from './shared';

interface Props {
  entries: Entry[]; exam?: string; title: string; head?: ReactNode;
  /** After any change: 账账's reaction, and the book to read again. */
  done: (moment: Moment) => Promise<void>;
}

export function DueView({ entries, exam, title, head, done }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [askedAgain, setAskedAgain] = useState<string | null>(null); // 拿不准 asked once for this entry
  const [walk, setWalk] = useState<{ q: string; points: string[]; i: number } | null>(null);
  const after = async (line: string, m: Moment) => { setNote(line); await done(m); };

  async function pick(id: string) {
    setNote(''); setWalk(null);
    if (open === id) { setOpen(null); return; }
    setSaid(await book.draftOf(id)); setOpen(id);
  }
  const type = (id: string, t: string) => { setSaid(t); void book.saveDraft(id, t); };

  async function finish(e: Entry) {
    setBusy(true);
    try {
      const ask = await modelAsk();
      if (askedAgain !== e.id && unsureGrade(await book.preview(e.id, said, ask))) {
        setAskedAgain(e.id); setNote(tr('没太听清，能换个说法再讲一次吗？这次不算。')); return;
      }
      const g = await book.repay(e.id, said, today(), exam, ask);
      setSaid(''); setOpen(null); setAskedAgain(null);
      if (g.passed) { await after(praise(g), 'paid'); return; }
      setWalk({ q: e.question, points: missed(g), i: 0 });
      await after('', 'missed');
    } finally { setBusy(false); }
  }
  /** 拍手写: the photo model copies the handwriting into the box, where the user can still correct it before grading. */
  async function photo(e: Entry) {
    setNote('');
    try {
      const p = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Prompt, quality: 60, width: 1600, saveToGallery: false });
      if (!p.dataUrl) return;
      setBusy(true);
      const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
      const text = await readHandwriting(p.dataUrl, s, key);
      if (!text) { setNote(tr('照片里的字看不清，再拍一次或者直接打字。')); return; }
      type(e.id, text); setNote(tr('抄好了，看一眼有没有抄错，再点「讲完了」。'));
    } catch (x) {
      if (x instanceof Error && /cancel/i.test(x.message)) return;
      setNote(describeModelError(x));
    } finally { setBusy(false); }
  }
  async function later(e: Entry) { await book.snooze(e.id, today()); setOpen(null); await after(tr('好，明天再聊这一笔。'), null); }
  async function letGo(e: Entry) { await book.drop(e.id, today()); setOpen(null); await after(tr('这一笔不用了，不算进结余。'), null); }
  async function origin(e: Entry) {
    const paper = await importedPaper();
    if (!paper) { setNote(tr('还没导入论文。先在「提问」里导入那篇，再贴原文。')); return; }
    if (await book.findOrigin(e.id, said, [paper], today())) { setSaid(''); setOpen(null); await after(tr('找到原文了，这笔引用债还清。'), 'paid'); }
    else setNote(tr('在《{0}》里没找到这句原话，或者它和 AI 给的数字、说法对不上。', paper.name));
  }

  const ways = (e: Entry) => (
    <div className="row">
      <button className="ghost" onClick={() => void later(e)}>{tr('改天再聊')}</button>
      <button className="ghost" onClick={() => void letGo(e)}>{tr('这个不用了')}</button>
    </div>
  );
  const used = (e: Entry) => e.usedIn && <div className="muted">{tr('用在：{0}', e.usedIn)}</div>;

  return (
    <>
      <h1>{title}</h1>
      {note && <p className="note" role="status">{note}</p>}
      {head}
      {walk && (
        <div className="card" data-testid="walk-through">
          <h2>{tr('这块还有点模糊，我们一起捋一遍？')}</h2>
          <p className="muted">{walk.q}</p>
          <ol className="walk">{walk.points.slice(0, walk.i + 1).map(p => <li key={p}>{p}</li>)}</ol>
          {walk.i + 1 < walk.points.length
            ? <button className="primary" onClick={() => setWalk({ ...walk, i: walk.i + 1 })}>{tr('懂了，下一条')}</button>
            : <button className="primary" onClick={() => { setWalk(null); setNote(tr('捋完了。这一笔明天再聊，到时候再讲给我听。')); }}>{tr('捋完了')}</button>}
        </div>
      )}
      {entries.length === 0 && !walk && <div className="card"><p>{tr('今天没有要还的。')}</p></div>}
      {entries.map(e => e.kind === 'conclusion' ? (
        <div key={e.id} className={`card${e.red ? ' red-mark' : ''}`} data-testid="conclusion-due">
          <b>{e.question}</b>{e.red && <span className="pill bad">{redTag(e)}</span>}
          <div className="muted">{tr('结论债靠零世界考试还：改好后到「科研 → 零世界」再考一次。')}</div>
        </div>
      ) : e.kind === 'citation' ? (
        <div key={e.id} className="card" data-testid="citation-due">
          <button className="item" onClick={() => void pick(e.id)}><span>{e.question}</span><span className="pill">{tr('引用债')}</span></button>
          {used(e)}
          {open === e.id && (
            <>
              <p className="muted">{tr('AI 给的引用和数字，找到原文才算还清。从导入的论文里复制那一句贴进来。')}</p>
              <textarea value={said} placeholder={tr('贴一句原文')} onChange={x => setSaid(x.target.value)} />
              <button className="primary" disabled={!said.trim()} onClick={() => void origin(e)}>{tr('找到原文')}</button>
              {ways(e)}
            </>
          )}
        </div>
      ) : (
        <div key={e.id} className={`card${e.red ? ' red-mark' : ''}`}>
          <button className="item" onClick={() => void pick(e.id)}>
            <span>{e.question}{e.fromComputer ? tr('（电脑上记的）') : ''}</span>
            <span className="pill">{tr(e.board)}</span>
          </button>
          {used(e)}
          {open === e.id && (
            <>
              <textarea value={said} placeholder={tr('不看答案，讲给我听。可以用输入法的语音随口讲')} onChange={x => type(e.id, x.target.value)} />
              <div className="row">
                <button className="primary" disabled={busy || !said.trim()} onClick={() => void finish(e)}>{busy ? tr('处理中…') : tr('讲完了')}</button>
                <button className="ghost" disabled={busy} onClick={() => void photo(e)}>{tr('拍手写')}</button>
              </div>
              {ways(e)}
            </>
          )}
        </div>
      ))}
    </>
  );
}
