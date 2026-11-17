// 思考结余 (plan 2.2 账本): ideas of your own minus debts not yet repaid, with its curve and the days that counted, the
// 今天 card, the 每周账单 (numbers only, so it can be shared) and the 想法本 (every idea in your own words, by course).
import { tr } from '../../i18n';
import { addDays, type Entry } from '../../ledger/ledger';
import { balanceCurve, balanceOn, ideaBook, streak, todayCard, weekBill, type WeekBill } from '../../ledger/insight';
import { NO_TOPIC } from '../../ledger/courses';

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The weekly bill as text to share: counts and shares, never a question or an answer. */
export function billText(b: WeekBill): string {
  const ideas = b.lastWithIdea === null ? tr('这周带着想法问的比例 {0}', pct(b.withIdea))
    : tr('带着想法问的比例从 {0} 到 {1}', pct(b.lastWithIdea), pct(b.withIdea));
  return tr('思维账本每周账单 {0} 至 {1}：{2}；讲顺了 {3} 笔；还欠 {4} 笔。', b.from, b.to, ideas, b.explained, b.owed);
}

function Curve({ points }: { points: number[] }) {
  const lo = Math.min(0, ...points), hi = Math.max(1, ...points), w = 280, h = 64;
  const xy = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * w},${h - ((p - lo) / (hi - lo)) * (h - 8) - 4}`).join(' ');
  const zero = h - ((0 - lo) / (hi - lo)) * (h - 8) - 4;
  return (
    <svg className="curve" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr('最近两周的思考结余')}>
      <line x1="0" x2={w} y1={zero} y2={zero} className="curve-zero" />
      <polyline points={xy} className="curve-line" />
    </svg>
  );
}

export function BalanceView({ all, board, day, onCopy }: { all: Entry[]; board: Entry['board']; day: string; onCopy: (t: string, done: string) => void }) {
  const mine = all.filter(e => e.board === board);
  const t = todayCard(mine, day), bill = weekBill(mine, day), days = streak(mine, day), groups = ideaBook(mine, board, NO_TOPIC);
  return (
    <>
      <h1>{tr('思考结余')}</h1>
      <div className="card" data-testid="balance">
        <div className="kpis">
          <div><span className="big">{signed(balanceOn(mine, day))}</span><span className="kpi-label">{tr('自己想出的，减去还没讲清的')}</span></div>
          <div><span className="big">{days}</span><span className="kpi-label">{tr('天连续记账')}</span></div>
        </div>
        <Curve points={balanceCurve(mine, day)} />
        <p className="muted">{tr('只有说出想法或讲顺一笔的日子才算，不看用了多久。{0} 到今天。', addDays(day, -13))}</p>
      </div>
      <div className="card" data-testid="today-card">
        <h2>{tr('今天')}</h2>
        <div className="two-col">
          <div><b>{tr('今天我自己想的')}</b>{t.ideas.length ? <ul>{t.ideas.map(e => <li key={e.id}>{e.ownIdea || e.question}</li>)}</ul> : <p className="muted">{tr('还没有')}</p>}</div>
          <div><b>{tr('今天请 AI 帮的')}</b>{t.asked.length ? <ul>{t.asked.map(e => <li key={e.id}>{e.question}</li>)}</ul> : <p className="muted">{tr('还没有')}</p>}</div>
        </div>
        <p className="muted">{tr('讲顺了 {0} 个，还有 {1} 个想再聊。', t.explained, t.again)}</p>
      </div>
      <div className="card" data-testid="week-bill">
        <h2>{tr('每周账单')}</h2>
        <p>{billText(bill)}</p>
        <button className="ghost" onClick={() => onCopy(billText(bill), tr('每周账单已复制，只有数字，没有题目内容。'))}>{tr('复制去分享')}</button>
      </div>
      <div className="card" data-testid="idea-book">
        <h2>{tr('想法本')}</h2>
        {groups.length === 0 && <p className="muted">{tr('记一笔时先写下自己的想法，就会出现在这里，考前能翻到当时的思路。')}</p>}
        {groups.map(g => (
          <details key={g.topic}>
            <summary>{tr('{0} · {1} 条', g.topic, g.ideas.length)}</summary>
            <ul>{g.ideas.map(i => <li key={i.on + i.text}><b>{i.text}</b><span className="muted">{tr('{0} · 问的是：{1}', i.on, i.question)}</span></li>)}</ul>
          </details>
        ))}
      </div>
    </>
  );
}
