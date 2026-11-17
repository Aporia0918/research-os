import { useEffect, useState } from 'react';
import { getLang, tr } from '../../i18n';
import { MAP_H, MAP_W, mindMap, script, type Recap } from '../../recap/recap';
import { speak, stopSpeaking } from '../../recap/speak';

/** 讲后即时回报: the user's own explanation back as a one-minute listen and a map, right after it went well. */
export function RecapCard({ recap, nextDue, onClose }: { recap: Recap; nextDue: string | null; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => () => { void stopSpeaking(); }, []);
  const map = mindMap(recap);
  const text = script(recap, { covered: tr('你讲到了：'), inYourWords: tr('用你自己的话说：') });

  async function listen() {
    if (playing) { await stopSpeaking(); setPlaying(false); return; }
    setPlaying(true); setNote('');
    try { if (await speak(text, getLang() === 'en' ? 'en-US' : 'zh-CN') === 'none') setNote(tr('这台手机没有可用的中文语音，看下面的导图吧。')); }
    catch { setNote(tr('没能播放，看下面的导图吧。')); }
    finally { setPlaying(false); }
  }

  return (
    <div className="card recap" data-testid="recap">
      <h2>{tr('讲顺了，这是你刚才讲的')}</h2>
      {nextDue
        ? <p className="muted" data-testid="fsrs-next">{tr('下次讲：{0}。按记忆曲线（FSRS）算，到那天大约还记得九成。', nextDue)}</p>
        : <p className="muted">{tr('这一笔还清了。')}</p>}
      <button className="primary" onClick={() => void listen()}>{playing ? tr('停止') : tr('听 60 秒摘要')}</button>
      {note && <p className="muted" role="status">{note}</p>}
      <svg className="mindmap" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={tr('导图：{0}', map.center)}>
        {map.nodes.map((n, i) => <line key={`l${i}`} x1={MAP_W / 2} y1={MAP_H / 2} x2={n.x} y2={n.y} className={n.ok ? 'mm-edge' : 'mm-edge mm-miss'} />)}
        <rect x={MAP_W / 2 - 60} y={MAP_H / 2 - 18} width="120" height="36" rx="18" className="mm-center" />
        <text x={MAP_W / 2} y={MAP_H / 2 + 5} textAnchor="middle" className="mm-center-text">{map.center}</text>
        {map.nodes.map((n, i) => (
          <g key={`n${i}`}>
            <rect x={n.x - 56} y={n.y - 15} width="112" height="30" rx="15" className={n.ok ? 'mm-node' : 'mm-node mm-miss'} />
            <text x={n.x} y={n.y + 5} textAnchor="middle" className="mm-text">{n.ok ? '✓ ' : '○ '}{n.text}</text>
          </g>
        ))}
      </svg>
      <details><summary>{tr('摘要全文')}</summary><p className="prewrap">{text}</p></details>
      <button className="ghost" onClick={onClose}>{tr('好的')}</button>
    </div>
  );
}
