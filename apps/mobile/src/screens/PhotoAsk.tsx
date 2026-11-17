// 拍一页问一句: take a photo of one page, ask one question, and the explanation is booked as a 理解债 with no extra tap.
import { useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { tr } from '../i18n';
import { preferencesKV } from '../storage/kv';
import { forJob, loadKey, loadModelSettings } from '../model/settings';
import { describeModelError } from '../model/direct';
import { askPhoto, photoDebt, type PhotoBoard } from '../logic/photoAsk';
import { book, today } from '../ledger/book';
import type { Entry } from '../ledger/ledger';
import { newId } from '../local/store';

const BOARDS: PhotoBoard[] = ['学习', '科研'];

export function PhotoAsk() {
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [board, setBoard] = useState<PhotoBoard>('学习');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [booked, setBooked] = useState<Entry | null>(null);

  async function shoot() {
    setError(''); setAnswer(''); setBooked(null);
    try {
      const p = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Prompt, quality: 60, width: 1600, saveToGallery: false });
      if (p.dataUrl) setPhoto({ id: newId(), url: p.dataUrl });
    } catch { /* the user closed the camera: nothing to say */ }
  }
  async function ask() {
    if (!photo) return;
    setBusy(true); setError(''); setAnswer(''); setBooked(null);
    try {
      const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
      const text = await askPhoto(q, photo.url, s, key);
      setAnswer(text);
      const n = photoDebt({ question: q, answer: text, board, photoId: photo.id, ai: forJob(s, 'photo').model });
      if (n) setBooked(await book.add(n, today()));
    } catch (e) { setError(describeModelError(e)); } finally { setBusy(false); }
  }
  async function unbook() {
    if (!booked) return;
    await book.remove([booked.id]); setBooked(null);
  }

  return <>
    <div className="card">
      <div className="seg" role="radiogroup" aria-label={tr('这一页是')}>
        {BOARDS.map(b => <button key={b} type="button" role="radio" aria-checked={board === b} onClick={() => setBoard(b)}>{b === '学习' ? tr('课本或讲义') : tr('论文')}</button>)}
      </div>
      {photo ? <img className="photo" src={photo.url} alt={tr('拍的一页')} /> : <div className="muted">{tr('拍一页课本、讲义或论文，问一句。照片只发给你自己填的模型，不存相册，不发给电脑。')}</div>}
      <button className={photo ? 'ghost' : 'primary'} onClick={() => void shoot()} data-testid="take-photo">{photo ? tr('重拍') : tr('拍一页')}</button>
    </div>
    {photo && <div className="card">
      <textarea value={q} onChange={e => setQ(e.target.value)} rows={3} placeholder={tr('例如：这一步为什么要这样推？')} aria-label={tr('问题')} />
      <button className="primary" disabled={busy || q.trim().length < 3} onClick={() => void ask()}>{busy ? tr('处理中…') : tr('提问')}</button>
      <div className="muted">{tr('要用能读图的模型。没填密钥或模型读不了图时，会直接告诉你原因。')}</div>
    </div>}
    {error && <div className="card error" role="alert">{error}</div>}
    {answer && <div className="card" data-testid="photo-answer"><p className="prewrap">{answer}</p></div>}
    {booked && <div className="card" data-testid="photo-booked">
      <h2>{tr('记了 1 笔理解债')}</h2>
      <div>{booked.question}</div>
      <div className="muted">{tr('AI 替你读懂的这一页记下了，之后讲给我听，讲顺就还清。')}</div>
      <button className="ghost" onClick={() => void unbook()}>{tr('这次不记')}</button>
    </div>}
  </>;
}
