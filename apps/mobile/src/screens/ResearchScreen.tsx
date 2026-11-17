import { useState } from 'react';
import { tr } from '../i18n';
import { Icon, type IconName } from '../icons';
import { PlanScreen } from './PlanScreen';
import { LogScreen } from './LogScreen';
import { ExamScreen } from './ExamScreen';
import { GuideScreen } from './GuideScreen';

/** Research tools sit behind one tab, each one tap away. Each is a place a debt comes from or gets repaid. */
type Part = 'plan' | 'log' | 'exam' | 'guide';
const PARTS: { id: Part; label: string; note: string; icon: IconName }[] = [
  { id: 'exam', label: '零世界', note: '高分是真的，还是脚本偷看了答案', icon: 'exam' },
  { id: 'plan', label: '计划', note: '从论文方法生成实验步骤', icon: 'plan' },
  { id: 'log', label: '记录', note: '拍照、录音、记下实验过程', icon: 'log' },
  { id: 'guide', label: '指导', note: '下一步做什么', icon: 'guide' },
];

export function ResearchScreen({ demo, start = null }: { demo: boolean; start?: Part | null }) {
  const [part, setPart] = useState<Part | null>(start);
  if (part) return (
    <>
      <button className="back" onClick={() => setPart(null)}>{tr('‹ 科研')}</button>
      {part === 'plan' && <PlanScreen demo={demo} />}
      {part === 'log' && <LogScreen demo={demo} />}
      {part === 'exam' && <ExamScreen />}
      {part === 'guide' && <GuideScreen demo={demo} />}
    </>
  );
  return (
    <section>
      <h1>{tr('科研')}</h1>
      <div className="tiles" data-testid="research-switch">
        {PARTS.map(p => (
          <button key={p.id} className="tile" onClick={() => setPart(p.id)}>
            <span className="orb"><Icon name={p.icon} /></span>
            <b>{tr(p.label)}</b>
            <span className="muted">{tr(p.note)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
