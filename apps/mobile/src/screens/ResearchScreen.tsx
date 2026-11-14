import { useState } from 'react';
import { tr } from '../i18n';
import { PlanScreen } from './PlanScreen';
import { LogScreen } from './LogScreen';
import { ExamScreen } from './ExamScreen';
import { GuideScreen } from './GuideScreen';

/** Research tools sit behind one tab. Each one is a place a debt comes from or gets repaid, not a feature of its own. */
type Part = 'plan' | 'log' | 'exam' | 'guide';
const PARTS: { id: Part; label: string }[] = [
  { id: 'plan', label: '计划' }, { id: 'log', label: '记录' }, { id: 'exam', label: '零世界' }, { id: 'guide', label: '指导' },
];

export function ResearchScreen({ demo }: { demo: boolean }) {
  const [part, setPart] = useState<Part>('plan');
  return (
    <>
      <div className="row" role="radiogroup" aria-label={tr('科研')} data-testid="research-switch">
        {PARTS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={part === p.id} className="ghost" onClick={() => setPart(p.id)}>{tr(p.label)}</button>
        ))}
      </div>
      {part === 'plan' && <PlanScreen demo={demo} />}
      {part === 'log' && <LogScreen demo={demo} />}
      {part === 'exam' && <ExamScreen />}
      {part === 'guide' && <GuideScreen demo={demo} />}
    </>
  );
}
