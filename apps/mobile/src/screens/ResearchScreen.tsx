import { useState } from 'react';
import { tr } from '../i18n';
import { Icon, type IconName } from '../icons';
import { PlanScreen } from './PlanScreen';
import { LogScreen } from './LogScreen';
import { ExamScreen } from './ExamScreen';
import { GuideScreen } from './GuideScreen';
import { PapersScreen } from './PapersScreen';
import { Drops } from './Drops';

/** Research tools sit behind one tab, each one tap away. Each is a place a debt comes from or gets repaid. */
type Part = 'plan' | 'log' | 'exam' | 'guide' | 'papers';
/** Each entry is its own jelly bubble (owner's reference 2026-11-17): drops tells how many water drops rest on it. */
const PARTS: { id: Part; label: string; note: string; icon: IconName; drops: number }[] = [
  { id: 'exam', label: '零世界', note: '高分是真的，还是脚本偷看了答案', icon: 'exam', drops: 2 },
  { id: 'plan', label: '计划', note: '从论文方法生成实验步骤', icon: 'plan', drops: 1 },
  { id: 'log', label: '记录', note: '实验过程、数据文件和组会纪要', icon: 'log', drops: 0 },
  { id: 'guide', label: '指导', note: '下一步做什么', icon: 'guide', drops: 3 },
  { id: 'papers', label: '文献', note: '代码和数据链接、参考文献、查重、说法相反', icon: 'list', drops: 1 },
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
      {part === 'papers' && <PapersScreen />}
    </>
  );
  return (
    <section className="research">
      <h1>{tr('科研')}</h1>
      <div className="tiles" data-testid="research-switch">
        {PARTS.map(p => (
          <button key={p.id} className={`tile bubble b-${p.id}`} onClick={() => setPart(p.id)}>
            <Drops n={p.drops} />
            <span className="orb"><Icon name={p.icon} /></span>
            <b>{tr(p.label)}</b>
            <span className="muted">{tr(p.note)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
