// 成长空间 (owner 2026-11-17; the 生活 board renamed and narrowed to studying): deadlines that pull a course's debts in
// front of them, a focus session that ends in 讲给我听, the weekly growth report with the 主意账 (own decision vs handed
// to AI), and a debt from a month ago. No chat. Everything leads back to the 认知债 ledger.
import { useEffect, useState, type ReactNode } from 'react';
import { tr } from '../i18n';
import { book, today } from '../ledger/book';
import { LifeBook, TITLE_MAX, type Decision, type Week } from '../ledger/life';
import { DEADLINE_KINDS, FOCUS_MINUTES, GrowthBook, growthWeek, monthAgo, pullDays, upcoming, type DeadlineKind, type Growth } from '../ledger/growth';
import { recentTopics } from '../ledger/courses';
import type { Entry } from '../ledger/ledger';
type Board = Entry['board'];
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';
import { focusAlarm } from '../remind/native';
import { Zhangzhang, type ZzState } from '../jelly/Zhangzhang';

export const growthBook = new GrowthBook(preferencesKV);
export const lifeBook = new LifeBook(preferencesKV);
const hello: ZzState = 'life';

/** Open 讲给我听 on the board with the most debts due. */
export function GrowthScreen({ switcher, onRepay }: { switcher: ReactNode; onRepay: (b: Board) => void }) {
  const day = today();
  const [g, setG] = useState<Growth | null>(null);
  const [all, setAll] = useState<Entry[]>([]);
  const [due, setDue] = useState<Record<'学习' | '科研', number>>({ 学习: 0, 科研: 0 });
  const [week, setWeek] = useState<Week | null>(null);
  const [reviewOn, setReviewOn] = useState(true);
  const [note, setNote] = useState('');
  const [zz, setZz] = useState<ZzState>('wave');
  useEffect(() => { if (zz === hello) return; const t = setTimeout(() => setZz(hello), 2200); return () => clearTimeout(t); }, [zz]);

  async function load() {
    const gr = await growthBook.get();
    const moved: string[] = [];
    for (const [course, on] of pullDays(gr.deadlines, day)) if (await book.pullForward(course, on, day)) moved.push(course);
    if (moved.length) setNote(tr('{0} 快到考试或组会了，这门课的账已经排到那天前面。', moved.join('、')));
    const ds = await book.due(day);
    setG(gr); setAll(await book.all());
    setDue({ 学习: ds.filter(e => e.board === '学习').length, 科研: ds.filter(e => e.board === '科研').length });
    setWeek(await lifeBook.week(day)); setReviewOn(await lifeBook.reviewOn());
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on open

  if (!g || !week) return <section className="home">{switcher}</section>;
  const dls = upcoming(g.deadlines, day);
  const gw = growthWeek(g, all, week, day);
  const past = monthAgo(all, day);
  const owed = due.学习 + due.科研;
  const repay = () => onRepay(due.科研 > due.学习 ? '科研' : '学习');
  const courses = [...new Set([...recentTopics(all, '学习'), ...recentTopics(all, '科研')])];

  return (
    <section className="home growth" data-testid="growth">
      {switcher}
      <div className="hero-wrap">
        <div className="hero-zz"><Zhangzhang state={zz} size={150} /></div>
        <div className="card hero" data-board="生活">
          <p className="eyebrow">{tr('成长空间 · 截止日、专注和每周成长，都连着你的账')}</p>
          <div className="kpis kpis-3">
            <div><span className="big">{dls.length ? dls[0].left : '—'}</span><span className="kpi-label">{dls.length ? tr('天到「{0}」', dls[0].title) : tr('没有截止日')}</span></div>
            <div><span className="big">{owed}</span><span className="kpi-label">{tr('笔今天该讲')}</span></div>
            <div><span className="big">{gw.repaid}</span><span className="kpi-label">{tr('笔这周讲顺')}</span></div>
          </div>
          <button className="primary big-button" onClick={repay} data-testid="growth-repay">{owed ? tr('讲给我听 · 今天 {0} 笔', owed) : tr('讲给我听')}</button>
        </div>
      </div>
      {note && <p className="note" role="status">{note}</p>}
      <FocusCard day={day} onDone={setG} onRepay={async () => { setG(await growthBook.repaidAfterFocus(day)); repay(); }} onMood={setZz} />
      <Deadlines g={g} courses={courses} day={day} onChange={setG} />
      {reviewOn && (
        <div className="card" data-testid="growth-week">
          <h2>{tr('成长周报')}</h2>
          <p>{tr('这周讲顺 {0} 笔，新记 {1} 笔；专注 {2} 次，其中 {3} 次之后去讲了；本周截止的 {4} 项完成 {5} 项。',
            gw.repaid, gw.booked, gw.focus, gw.focusRepaid, gw.due, gw.done)}</p>
          {gw.own + gw.ai > 0 && <p>{tr('这周你自己拿了 {0} 个主意，{1} 个交给了 AI。', gw.own, gw.ai)}{week.named && tr('「{0}」那次是你自己定的。', week.named)}</p>}
          <Decide onBooked={async d => { setZz('smile'); setNote(d.kind === 'own' ? tr('记下了：自己拿的主意。') : tr('记下了：交给 AI 拿的主意。')); setWeek(await lifeBook.week(day)); }} />
        </div>
      )}
      {past && (
        <div className="card" data-testid="month-ago">
          <h2>{tr('那年今日')}</h2>
          <p className="muted">{tr('一个月前的今天，你讲清了这一笔：')}</p>
          <p><b>{past.question}</b></p>
          <details><summary>{tr('还记得吗？看一眼答案')}</summary><p className="prewrap">{past.answer}</p></details>
        </div>
      )}
      <Settings reviewOn={reviewOn} onChange={async msg => { if (msg) setNote(msg); await load(); }} />
    </section>
  );
}

function FocusCard({ day, onDone, onRepay, onMood }: { day: string; onDone: (g: Growth) => void; onRepay: () => void; onMood: (z: ZzState) => void }) {
  const [end, setEnd] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (end === null) return;
    const tick = () => {
      const ms = end - Date.now();
      if (ms <= 0) { setEnd(null); setDone(true); onMood('smile'); void growthBook.focused(day, FOCUS_MINUTES).then(onDone); return; }
      setLeft(Math.ceil(ms / 1000));
    };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [end, day, onDone, onMood]);
  async function start() {
    const at = Date.now() + FOCUS_MINUTES * 60000;
    setDone(false); setEnd(at); onMood('think');
    await focusAlarm(at, tr('专注结束'), tr('讲给账账听一笔，刚学的最好讲。'));
  }
  async function stop() { setEnd(null); await focusAlarm(null, '', ''); }
  return (
    <div className="card" data-testid="focus">
      <h2>{tr('专注一段')}</h2>
      {end !== null ? (
        <>
          <p className="big focus-clock" aria-live="polite">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</p>
          <button className="ghost" onClick={() => void stop()}>{tr('先停下')}</button>
        </>
      ) : done ? (
        <>
          <p>{tr('专注了 {0} 分钟。趁热讲给我听一笔？', FOCUS_MINUTES)}</p>
          <div className="row">
            <button className="primary" onClick={() => { setDone(false); onRepay(); }}>{tr('讲一笔')}</button>
            <button className="ghost" onClick={() => setDone(false)}>{tr('先休息')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{tr('{0} 分钟，结束时讲给我听一笔。不计打卡，停下也没关系。', FOCUS_MINUTES)}</p>
          <button className="primary" onClick={() => void start()}>{tr('开始 {0} 分钟', FOCUS_MINUTES)}</button>
        </>
      )}
    </div>
  );
}

function Deadlines({ g, courses, day, onChange }: { g: Growth; courses: string[]; day: string; onChange: (g: Growth) => void }) {
  const [adding, setAdding] = useState(false);
  const blank = { title: '', course: '', kind: '作业' as DeadlineKind, on: '' };
  const [d, setD] = useState(blank);
  const list = upcoming(g.deadlines, day);
  async function add() { onChange(await growthBook.addDeadline({ id: newId(), ...d })); setD(blank); setAdding(false); }
  return (
    <div className="card" data-testid="deadlines">
      <h2>{tr('截止日')}</h2>
      {list.length === 0 && <p className="muted">{tr('作业、实验报告、考试、组会都可以记在这里。考试和组会一周内到，那门课的账会自动排到前面。')}</p>}
      {list.map(x => (
        <div key={x.id} className="deadline-row">
          <span className={x.left <= 2 ? 'dl-left soon' : 'dl-left'}>{x.left === 0 ? tr('今天') : tr('{0} 天', x.left)}</span>
          <span className="course-name">{x.title}<span className="muted">{tr(x.kind)}{x.course ? ` · ${x.course}` : ''} · {x.on}</span></span>
          <button className="ghost" aria-label={tr('完成：{0}', x.title)} onClick={() => void growthBook.finish(x.id, day).then(onChange)}>✓</button>
        </div>
      ))}
      {adding ? (
        <div className="form">
          <input value={d.title} placeholder={tr('比如：高数第 5 章作业')} aria-label={tr('截止日名称')} onChange={e => setD({ ...d, title: e.target.value })} />
          <input value={d.course} list="growth-courses" placeholder={tr('哪门课或哪个课题（可不填）')} aria-label={tr('哪门课')} onChange={e => setD({ ...d, course: e.target.value })} />
          <datalist id="growth-courses">{courses.map(n => <option key={n} value={n} />)}</datalist>
          <select value={d.kind} aria-label={tr('类型')} onChange={e => setD({ ...d, kind: e.target.value as DeadlineKind })}>
            {DEADLINE_KINDS.map(k => <option key={k} value={k}>{tr(k)}</option>)}
          </select>
          <input type="date" value={d.on} min={day} aria-label={tr('日期')} onChange={e => setD({ ...d, on: e.target.value })} />
          <div className="row">
            <button className="primary" disabled={!d.title.trim() || !d.on} onClick={() => void add()}>{tr('记下')}</button>
            <button className="ghost" onClick={() => setAdding(false)}>{tr('取消')}</button>
          </div>
        </div>
      ) : <button className="ghost" onClick={() => setAdding(true)}>{tr('加一个截止日')}</button>}
    </div>
  );
}

/** 主意账: one line per decision, either the user's own or handed to AI. */
function Decide({ onBooked }: { onBooked: (d: Decision) => void }) {
  const [pending, setPending] = useState<{ kind: Decision['kind']; title: string } | null>(null);
  async function record() {
    if (!pending) return;
    const d = await lifeBook.add(pending.kind, pending.title, today(), newId());
    if (d) { setPending(null); onBooked(d); }
  }
  if (!pending) return (
    <div className="chips" role="group" aria-label={tr('记一次拿主意')}>
      <button type="button" className="chip" onClick={() => setPending({ kind: 'own', title: '' })}>{tr('我自己定了一件事')}</button>
      <button type="button" className="chip" onClick={() => setPending({ kind: 'ai', title: '' })}>{tr('这件事交给了 AI')}</button>
    </div>
  );
  return (
    <div className="form" data-testid="decide">
      <input value={pending.title} maxLength={TITLE_MAX} aria-label={pending.kind === 'own' ? tr('记一笔：自己拿的主意') : tr('记一笔：交给 AI 拿的主意')}
        placeholder={tr('一行标题，比如：选哪个课题方向')} onChange={x => setPending({ ...pending, title: x.target.value })} />
      <div className="row">
        <button className="primary" disabled={!pending.title.trim()} onClick={() => void record()}>{tr('记下')}</button>
        <button className="ghost" onClick={() => setPending(null)}>{tr('不记')}</button>
      </div>
    </div>
  );
}

function Settings({ reviewOn, onChange }: { reviewOn: boolean; onChange: (msg?: string) => void }) {
  const [clearing, setClearing] = useState(false);
  return (
    <details className="card more">
      <summary>{tr('成长空间的设置')}</summary>
      <button className="ghost" onClick={() => void lifeBook.setReview(!reviewOn).then(() => onChange())}>{reviewOn ? tr('不看成长周报') : tr('看成长周报')}</button>
      {clearing ? (
        <div className="row">
          <button className="danger" onClick={() => void lifeBook.clear().then(() => { setClearing(false); onChange(tr('主意账清空了。学习和科研的账没有动。')); })}>{tr('确定清空')}</button>
          <button className="ghost" onClick={() => setClearing(false)}>{tr('先不清')}</button>
        </div>
      ) : <button className="ghost" onClick={() => setClearing(true)}>{tr('一键清空主意账')}</button>}
    </details>
  );
}
