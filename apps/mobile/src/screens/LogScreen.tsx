import { tr, trObj, fmtDate } from '../i18n';
import { useEffect, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { LogQueue, type LogEntry } from '../storage/queue';
import { preferencesKV } from '../storage/kv';
import { pageLabel, type CompareResult } from '../logic/types';
import type { Finding as CompareItem } from '../rules/compare';
import type { Choice, ItemFeedback } from '../logic/comparison';
import { compareLog } from '../rules/compare';
import { loadPaper } from '../local/paperStore';
import { DEMO_LABEL, demoCompare, demoLog, demoPaper } from '../demo/demo';
import { METHOD_LABEL } from '../logic/papers';
import { archiveFiles, deleteDataFile, fmtSize, MAX_FILE_MB, shareDataFile } from '../local/expFiles';
import { newId } from '../local/store';
import type { DataFile } from '../storage/queue';
import { minuteItems, type MinuteItem } from '../rules/minutes';
import { book, today } from '../ledger/book';
import { risk } from '../rules/care';
import { CareNote } from './CareNote';

const KIND_LABEL: Record<string, string> = trObj({ text: '文字', photo: '照片', voice: '语音', data: '数据' });
const CHOICE_LABEL: Record<Choice, string> = trObj({ accepted: '采纳', ignored: '忽略', edited: '改写' });

const queue = new LogQueue(preferencesKV);

export function LogScreen({ demo = false }: { demo?: boolean }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const refresh = async () => setEntries(await queue.all());
  useEffect(() => { void refresh(); }, []);

  async function takePhoto() {
    setMsg('');
    try {
      const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Camera, quality: 70, saveToGallery: false });
      await queue.add({ kind: 'photo', note, media: photo.webPath ?? photo.path, mimeType: `image/${photo.format}` });
      setNote(''); await refresh(); setMsg(tr('照片已保存在这台手机上。'));
    } catch (e) { setMsg(tr('相机出错:{0}', (e as Error).message)); }
  }

  // Only this screen's feedback is held; the document and every calculation stay on the phone.
  const [cmp, setCmp] = useState<{ entryId: string; result: CompareResult } | null>(null);
  const [fb, setFb] = useState<Record<number, ItemFeedback>>({});
  async function compare(e: LogEntry) {
    setMsg(''); setCmp(null); setFb({});
    const p = await loadPaper(preferencesKV);
    if (!p) { setMsg(tr('请先在「提问」页导入论文。')); return; }
    const items = compareLog(e.note, p.chunks, p.doc.pages.map(x => x.text)) as CompareItem[];
    setCmp({ entryId: e.id, result: { log_id: e.id, version_id: p.ref.versionId, method: 'deterministic', items, mismatches: items.filter(i => i.status === 'mismatch').length } });
  }
  const choose = (i: number, choice: Choice, editedText?: string) =>
    setFb(f => ({ ...f, [i]: { choice, editedText: editedText ?? f[i]?.editedText } }));

  /** 实验数据归档: pick data files and keep them with this record (a new one when `e` is null), on this phone only. */
  async function attach(e: LogEntry | null) {
    setMsg('');
    try {
      const got = await archiveFiles(e?.id ?? newId());
      if (got.tooBig.length) setMsg(tr('超过 {0} MB 的文件没有存：{1}', MAX_FILE_MB, got.tooBig.join('、')));
      if (!got.files.length) return;
      if (e) await queue.setFiles(e.id, [...(e.files ?? []), ...got.files]);
      else { await queue.add({ kind: 'data', note: note.trim(), files: got.files }); setNote(''); }
      await refresh();
      if (!got.tooBig.length) setMsg(tr('{0} 个数据文件存在这台手机上了。', got.files.length));
    } catch (x) { if (!/cancel/i.test((x as Error).message)) setMsg(tr('没能存下文件：{0}', (x as Error).message)); }
  }
  async function dropFile(e: LogEntry, f: DataFile) {
    await deleteDataFile(f); await queue.setFiles(e.id, (e.files ?? []).filter(x => x.path !== f.path)); await refresh();
  }

  async function saveText() {
    if (!note.trim()) return;
    await queue.add({ kind: 'text', note: note.trim() }); setNote(''); await refresh();
  }

  if (demo) return (
    <section>
      <h1>{tr('实验记录')}</h1>
      <div className="demo-banner" role="note">{tr(DEMO_LABEL)}</div>
      <div className="card muted">{tr('演示:一条示例日志与')} {tr(demoPaper.name)} {tr('的对照。演示模式下不能新增记录。')}</div>
      <div className="card entry">
        <div className="entry-kind">{tr('文字')}</div>
        <div><div>{demoLog.text}</div><div className="muted">{fmtDate(demoLog.captured_at)} {tr('· 示例')}</div>
          <div className="compare" data-testid="compare">
            <div className="muted">{demoCompare.mismatches} {tr('处不同 ·')} {METHOD_LABEL(demoCompare.method)}</div>
            {demoCompare.items.map((it, i) => (
              <div className={`cmp-item ${it.status}`} key={i}>
                <div><b>{it.status === 'mismatch' ? tr('不同') : it.status === 'match' ? tr('相同') : tr('论文里没有')}</b>{tr(':你写的是')} {it.parameter}
                  {it.paper_text ? tr(',论文写的是 {0}', it.paper_text) : ''}</div>
                {it.citation && <div className="quote"><span className="cite">{pageLabel(it.citation.page_index ?? ((it.citation as { pageNumber?: number }).pageNumber ?? (it.citation.page_number - 1)))}</span> “{it.citation.quote}”</div>}
              </div>))}
          </div></div>
      </div>
    </section>
  );
  return (
    <section>
      <h1>{tr('实验记录')}</h1>
      <div className="card">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={tr('你做了什么?例如:带通滤波 0.5–40 Hz')} aria-label={tr('记录内容')} />
        <div className="row">
          <button className="primary" onClick={takePhoto}>{tr('拍照')}</button>
          <button className="ghost" onClick={saveText}>{tr('保存文字')}</button>
          <button className="ghost" onClick={() => void attach(null)}>{tr('附数据文件')}</button>
          <div className="muted">{tr('记录和数据文件只保存在这台手机上，可以与已导入论文在本机对照。数据文件不在备份里，要留底请用「发送」存到电脑或网盘。')}</div>
        </div>
      </div>
      {msg && <div className="card muted">{msg}</div>}
      <Minutes />
      <h2>{tr('已保存(')}{entries.length} {tr('条)')}</h2>
      {entries.map(e => (
        <div className="card entry" key={e.id}>
          <div className="entry-kind">{KIND_LABEL[e.kind] ?? e.kind}</div>
          <div><div>{e.note || <span className="muted">{tr('(没有文字)')}</span>}</div>
            <div className="muted">{fmtDate(e.createdAt)} · {tr('已保存在本机')}</div>
            {(e.files ?? []).length > 0 && (
              <ul className="plain data-files" data-testid="data-files">{e.files!.map(f => (
                <li key={f.path} className="row"><span className="file-name">{f.name}<span className="muted"> · {fmtSize(f.size)}</span></span>
                  <button className="ghost small" onClick={() => void shareDataFile(f, tr('发送数据文件'))}>{tr('发送')}</button>
                  <button className="ghost small" aria-label={tr('删掉 {0}', f.name)} onClick={() => void dropFile(e, f)}>×</button></li>
              ))}</ul>)}
            <div className="row">
              {e.note && <button className="ghost small" onClick={() => compare(e)}>{tr('与论文对照')}</button>}
              <button className="ghost small" onClick={() => void attach(e)}>{tr('加数据文件')}</button>
            </div>
            {cmp?.entryId === e.id && (
              <div className="compare" data-testid="compare">
                <div className="muted">{cmp.result.mismatches} {tr('处不同 ·')} {METHOD_LABEL(cmp.result.method)}</div>
                {cmp.result.items.length === 0 && <div className="muted">{tr('这条记录里没有找到数值参数。')}</div>}
                {cmp.result.items.map((it, i) => (
                  <div className={`cmp-item ${it.status}`} key={i}>
                    <div><b>{it.status === 'mismatch' ? tr('不同') : it.status === 'match' ? tr('相同') : tr('论文里没有')}</b>{tr(':你写的是')} {it.parameter}
                      {it.paper_text ? tr(',论文写的是 {0}', it.paper_text) : ''}</div>
                    {it.citation && <div className="quote"><span className="cite">{pageLabel(it.citation.page_index ?? ((it.citation as { pageNumber?: number }).pageNumber ?? (it.citation.page_number - 1)))}</span> “{it.citation.quote}”</div>}
                    {it.status === 'mismatch' && (
                      <div className="row">
                        <button className="ghost small" aria-pressed={fb[i]?.choice === 'accepted'} onClick={() => choose(i, 'accepted')}>{tr('采纳')}</button>
                        <button className="ghost small" aria-pressed={fb[i]?.choice === 'ignored'} onClick={() => choose(i, 'ignored')}>{tr('忽略')}</button>
                        <button className="ghost small" aria-pressed={fb[i]?.choice === 'edited'} onClick={() => choose(i, 'edited', fb[i]?.editedText ?? it.parameter)}>{tr('改写')}</button>
                      </div>)}
                    {fb[i]?.choice === 'edited' && <input aria-label={tr('改写内容')} value={fb[i]?.editedText ?? ''} onChange={ev => choose(i, 'edited', ev.target.value)} />}
                    {fb[i]?.choice && <div className="muted">{tr('你的选择:')}{CHOICE_LABEL[fb[i]!.choice]}{tr('(只针对这条,不保存)')}</div>}
                  </div>
                ))}
              </div>)}
            </div>
        </div>
      ))}
    </section>
  );
}

/** 组会纪要 → 待核对的问题: pick the sentences worth explaining and book them as 科研 debts; nothing is booked unchosen. */
function Minutes() {
  const [text, setText] = useState('');
  const [items, setItems] = useState<MinuteItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const [care, setCare] = useState(false);
  function find() { setMsg(''); setCare(risk(text)); if (risk(text)) return; setItems(minuteItems(text)); setPicked(new Set()); }
  const toggle = (i: number) => setPicked(p => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  async function bookPicked() {
    const day = today();
    const topic = tr('组会 {0}', day.slice(5));
    for (const i of [...picked].sort((a, b) => a - b)) {
      const it = items![i];
      await book.add({ clientId: newId(), board: '科研', topic, question: it.question, answer: it.quote, ownIdea: '', helpLevel: 'hint' }, day);
    }
    setMsg(tr('记了 {0} 笔进科研账本，到日子讲给我听。', picked.size)); setItems(null); setPicked(new Set()); setText('');
  }
  return (
    <div className="card" data-testid="minutes">
      <h2>{tr('组会纪要')}</h2>
      <p className="muted">{tr('粘贴或输入组会的文字纪要。结论、决定和布置的任务会变成要核对的问题，你挑哪几条记进账本。')}</p>
      <textarea value={text} rows={4} aria-label={tr('组会纪要')} placeholder={tr('比如：滤波统一改成 0.5–40 Hz。下周重跑被试 3 的数据。')} onChange={e => { setText(e.target.value); setItems(null); }} />
      <button className="ghost" disabled={!text.trim()} onClick={find}>{tr('找出要核对的')}</button>
      {care && <CareNote />}
      {items && (items.length === 0 ? <p className="muted">{tr('没找到结论、决定或任务。规则只认带数字、结论词或任务词的句子。')}</p> : (
        <>
          <ul className="plain">{items.map((it, i) => (
            <li key={i}><label className="row step"><input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />{it.question}</label></li>
          ))}</ul>
          <button className="primary" disabled={!picked.size} onClick={() => void bookPicked()}>{tr('记进科研账本（{0} 笔）', picked.size)}</button>
        </>))}
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}
