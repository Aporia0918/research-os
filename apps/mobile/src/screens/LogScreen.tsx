import { tr, trObj, fmtDate } from '../i18n';
import { useEffect, useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { LogQueue, type LogEntry } from '../storage/queue';
import { preferencesKV } from '../storage/kv';
import { pageLabel, type CompareResult } from '../logic/types';
import type { Finding as CompareItem } from '../rules/compare';
import type { Choice, ItemFeedback } from '../logic/comparison';
import { compareLog } from '../rules/compare';
import { loadPaper } from '../local/paperStore';
import { DEMO_LABEL, demoCompare, demoLog, demoPaper } from '../demo/demo';
import { METHOD_LABEL } from '../logic/papers';

const KIND_LABEL: Record<string, string> = trObj({ text: '文字', photo: '照片', voice: '语音' });
const CHOICE_LABEL: Record<Choice, string> = trObj({ accepted: '采纳', ignored: '忽略', edited: '改写' });

const queue = new LogQueue(preferencesKV);

export function LogScreen({ demo = false }: { demo?: boolean }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
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

  async function toggleVoice() {
    setMsg('');
    try {
      if (!recording) {
        const perm = await VoiceRecorder.requestAudioRecordingPermission();
        if (!perm.value) { setMsg(tr('没有麦克风权限。')); return; }
        await VoiceRecorder.startRecording(); setRecording(true);
      } else {
        const r = await VoiceRecorder.stopRecording(); setRecording(false);
        await queue.add({ kind: 'voice', note, media: r.value.recordDataBase64, mimeType: r.value.mimeType, durationMs: r.value.msDuration });
        setNote(''); await refresh(); setMsg(tr('语音已保存在这台手机上。'));
      }
    } catch (e) { setRecording(false); setMsg(tr('录音出错:{0}', (e as Error).message)); }
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

  async function saveText() {
    if (!note.trim()) return;
    await queue.add({ kind: 'text', note: note.trim() }); setNote(''); await refresh();
  }

  if (demo) return (
    <section>
      <h1>{tr('实验记录')}</h1>
      <div className="demo-banner" role="note">{tr(DEMO_LABEL)}</div>
      <div className="card muted">{tr('演示:一条示例日志与')} {tr(demoPaper.name)} {tr('的对照。演示模式下不能录制。')}</div>
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
          <button className={recording ? 'primary danger' : 'primary'} onClick={toggleVoice}>{recording ? tr('停止') : tr('录音')}</button>
          <button className="ghost" onClick={saveText}>{tr('保存文字')}</button>
          <div className="muted">{tr('记录只保存在这台手机上,可以与已导入论文在本机对照。')}</div>
        </div>
      </div>
      {msg && <div className="card muted">{msg}</div>}
      <h2>{tr('已保存(')}{entries.length} {tr('条)')}</h2>
      {entries.map(e => (
        <div className="card entry" key={e.id}>
          <div className="entry-kind">{KIND_LABEL[e.kind] ?? e.kind}</div>
          <div><div>{e.note || <span className="muted">{tr('(没有文字)')}</span>}</div>
            <div className="muted">{fmtDate(e.createdAt)} · {tr('已保存在本机')}</div>
            {e.note && <button className="ghost small" onClick={() => compare(e)}>{tr('与论文对照')}</button>}
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
