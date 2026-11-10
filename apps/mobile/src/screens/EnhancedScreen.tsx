import { useState } from 'react';
import { tr } from '../i18n';
import { ResearchOsClient } from '../api/computer';
import { loadComputerSettings } from '../settings';
import { preferencesKV } from '../storage/kv';
import { LogQueue } from '../storage/queue';
export function EnhancedScreen() {
  const [status, setStatus] = useState('');
  const [ideas, setIdeas] = useState<{ title: string; why: string }[]>([]);
  const [paper, setPaper] = useState('');
  const [busy, setBusy] = useState(false);
  async function recommendPapers() {
    setStatus(''); setIdeas([]); setBusy(true);
    const s = await loadComputerSettings(preferencesKV); if (!s.enabled) { setStatus(tr('请先在设置里开启电脑增强功能。')); setBusy(false); return; }
    try {
      const client = new ResearchOsClient(s.url, undefined, 5000);
      const records = await client.listLogs(10);
      setIdeas(records.slice(0, 5).map(x => ({ title: x.text.slice(0, 120), why: tr('来自你在电脑上的实验记录;是否值得阅读由你判断。') })));
    } catch {
      // Fallback on this phone: the same view built from the experiment records saved on the phone.
      const local = (await new LogQueue(preferencesKV).all()).filter(x => x.note.trim()).slice(0, 5);
      setIdeas(local.map(x => ({ title: x.note.slice(0, 120), why: tr('来自这台手机上的实验记录;是否值得阅读由你判断。') })));
      setStatus(tr('电脑未连接，已用手机处理'));
    }
    finally { setBusy(false); }
  }
  return <section><h1>{tr('电脑增强')}</h1>
    <div className="card"><p>{tr('仅在电脑增强开启时出现。每次请求最多等待 5 秒,失败不会影响本机功能。')}</p>
      <textarea aria-label={tr('研究方向')} value={paper} onChange={e => setPaper(e.target.value)} placeholder={tr('研究方向')} />
      <button className="primary" disabled={busy} onClick={recommendPapers}>{busy ? tr('正在等待电脑回复,最多 5 秒…') : tr('获取更多论文线索')}</button>
      {status && <div className="card warn" role="status" data-testid="enhanced-notice">{status}</div>}
      {ideas.map((x, i) => <div className="card" key={i}><b>{x.title}</b><div className="muted">{x.why}</div><div className="muted">{tr('仅供参考,是否需要读原文由你判断。')}</div></div>)}
      {!ideas.length && !status && <div className="muted">{tr('本地提问、引用检查、规则计划和指导不需要电脑。')}</div>}
    </div></section>;
}
