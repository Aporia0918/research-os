import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { BackupError, entryCount, type Backup } from '../backup/backup';
import { applyBackup, autoSnapshots, pickBackup, readSnapshot, shareBackup } from '../backup/native';

/** 备份与恢复: export to a file the user keeps, restore from one, or roll back to a daily snapshot. */
export function BackupCard({ onRestored = () => location.reload() }: { onRestored?: () => void }) {
  const [snaps, setSnaps] = useState<string[]>([]);
  const [pending, setPending] = useState<Backup | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { void autoSnapshots().then(setSnaps); }, []);

  const fail = (e: unknown) => setNote(e instanceof BackupError ? tr(e.message) : tr('没能读取这份备份。'));
  async function exportNow() {
    try { const how = await shareBackup(tr('思维账本备份')); setNote(how === 'copied' ? tr('备份内容已复制。') : tr('选一个地方把备份文件存好。')); }
    catch { setNote(tr('没能导出备份，请再试一次。')); }
  }
  async function pick() { try { const b = await pickBackup(); if (b) { setPending(b); setNote(''); } } catch (e) { fail(e); } }
  async function pickSnap(name: string) { try { setPending(await readSnapshot(name)); setNote(''); } catch (e) { fail(e); } }
  async function restore() {
    if (!pending) return;
    await applyBackup(pending); setPending(null); setNote(tr('已恢复，正在重新载入。')); onRestored();
  }

  return (
    <div className="card" data-testid="backup-card">
      <div><b>{tr('备份与恢复')}</b></div>
      <div className="muted">{tr('账本、日志和设置存成一个文件，换手机或误删时用。模型密钥不在里面。')}</div>
      <div className="row">
        <button className="primary" onClick={() => void exportNow()}>{tr('导出备份')}</button>
        <button className="ghost" onClick={() => void pick()}>{tr('从文件恢复')}</button>
      </div>
      {snaps.length > 0 && (
        <details>
          <summary>{tr('每天自动存的快照（{0} 份）', snaps.length)}</summary>
          {snaps.map(n => (
            <button key={n} className="ghost" data-testid="snapshot" onClick={() => void pickSnap(n)}>{n.slice(5, 15)}</button>
          ))}
        </details>
      )}
      {pending && (
        <div className="ask-box" role="alertdialog" aria-label={tr('确认恢复')}>
          <p>{tr('这份备份有 {0} 笔账，存于 {1}。恢复后，备份里有的内容会替换现在的。', entryCount(pending), pending.createdAt.slice(0, 10) || '?')}</p>
          <div className="row">
            <button className="primary" data-testid="restore-confirm" onClick={() => void restore()}>{tr('恢复')}</button>
            <button className="ghost" onClick={() => setPending(null)}>{tr('取消')}</button>
          </div>
        </div>
      )}
      {note && <div className="muted" role="status">{note}</div>}
    </div>
  );
}
