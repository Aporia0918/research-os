// 成长空间 (owner 2026-11-17, 板块修改总结; the 生活 board renamed and narrowed to studying): deadlines that pull a
// course's debts in front of them and break into small steps, a focus session that ends in 讲给我听, the weekly growth
// report, and a debt from a month ago. No chat and no ledger of its own; the old 生活账 stays readable.
import { useEffect, useState, type ReactNode } from 'react';
import { tr } from '../i18n';
import { Drops } from './Drops';
import { book, today } from '../ledger/book';
import { LifeBook, type Decision } from '../ledger/life';
import { DEADLINE_KINDS, FOCUS_MINUTES, GrowthBook, growthWeek, monthAgo, parseSteps, pullDays, STEP_MAX, upcoming,
  type Deadline, type DeadlineKind, type Growth } from '../ledger/growth';
import { recentTopics } from '../ledger/courses';
import type { Entry } from '../ledger/ledger';
import { splitSteps } from './ledger/shared';
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';
import { focusAlarm } from '../remind/native';
import { refreshReminders } from '../remind';
import { Zhangzhang, type ZzState } from '../jelly/Zhangzhang';

export const growthBook = new GrowthBook(preferencesKV);
const lifeBook = new LifeBook(preferencesKV);
type Board = Entry['board'];
const hello: ZzState = 'life';

/** Open 讲给我听 on the board with the most debts due. */
export function GrowthScreen({ switcher, onRepay }: { switcher: ReactNode; onRepay: (b: Board) => void }) {
  const day = today();
  const [g, setG] = useState<Growth | null>(null);
  const [all, setAll] = useState<Entry[]>([]);
  const [due, setDue] = useState<Record<'学习' | '科研', number>>({ 学习: 0, 科研: 0 });
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
    setReviewOn(await lifeBook.reviewOn());
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on open

  if (!g) return <section className="home">{switcher}</section>;
  const dls = upcoming(g.deadlines, day);
  const gw = growthWeek(g, all, day);
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
      <div className="collage">
      <FocusCard day={day} onDone={setG} onRepay={async () => { setG(await growthBook.repaidAfterFocus(day)); repay(); }} onMood={setZz} />
      <div className="card drop-card" aria-label={tr('这周讲顺 {0} 笔', gw.repaid)} data-testid="week-drop">
        <Drops n={2} />
        <span className="drop-num">{gw.repaid}</span>
        <span className="drop-mark" aria-hidden="true">✓</span>
        <span className="drop-sub">{tr('这周讲顺')}</span>
      </div>
      <Deadlines g={g} courses={courses} day={day} onChange={x => { setG(x); void refreshReminders(); }} />
      {reviewOn && (
        <div className="card shape-week" data-testid="growth-week">
          <Drops n={3} />
          <h2>{tr('成长周报')}</h2>
          <p>{tr('这周独立讲清了 {0} 笔，新记 {1} 笔，其中 {2} 笔先写了自己的想法。', gw.repaid, gw.booked, gw.thoughtFirst)}</p>
          <p>{tr('专注 {0} 次，其中 {1} 次之后去讲了；本周截止的 {2} 项完成 {3} 项。', gw.focus, gw.focusRepaid, gw.due, gw.done)}</p>
          <p className="muted">{tr('下周：{0} 个截止日，{1} 笔到期要讲。', gw.nextDeadlines, gw.nextDebts)}</p>
        </div>
      )}
      {past && (
        <div className="card shape-past" data-testid="month-ago">
          <h2>{tr('那年今日')}</h2>
          <p className="muted">{tr('一个月前的今天，你讲清了这一笔：')}</p>
          <p><b>{past.question}</b></p>
          <details><summary>{tr('还记得吗？看一眼答案')}</summary><p className="prewrap">{past.answer}</p></details>
        </div>
      )}
      </div>
      <Settings reviewOn={reviewOn} onChange={() => void load()} />
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
    <div className="card shape-focus" data-testid="focus">
      <Drops n={1} />
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
    <div className="card shape-deadlines" data-testid="deadlines">
      <h2>{tr('截止日')}</h2>
      {list.length === 0 && <p className="muted">{tr('作业、实验报告、考试、组会都可以记在这里。考试和组会一周内到，那门课的账会自动排到前面。')}</p>}
      {list.map(x => (
        <div key={x.id} className="deadline">
          <div className="deadline-row">
            <span className={x.left <= 2 ? 'dl-left soon' : 'dl-left'}>{x.left === 0 ? tr('今天') : tr('{0} 天', x.left)}</span>
            <span className="dl-name">{x.title}<span className="muted">{tr(x.kind)}{x.course ? ` · ${x.course}` : ''} · {x.on}</span></span>
            <button className="ghost dl-done" aria-label={tr('完成：{0}', x.title)} onClick={() => void growthBook.finish(x.id, day).then(onChange)}>✓</button>
          </div>
          <Steps d={x} onChange={onChange} />
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

/** 任务拆解: break a deadline into a few small steps. A model may suggest them; nothing is written until 写进去. */
function Steps({ d, onChange }: { d: Deadline; onChange: (g: Growth) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function suggest() {
    setBusy(true);
    try { setDraft(await splitSteps(`${d.title}${d.course ? `（${d.course}）` : ''}，${d.on} 截止`)); } finally { setBusy(false); }
  }
  const steps = d.steps ?? [];
  return (
    <div className="steps">
      {steps.map((st, i) => (
        <label key={i} className="row step"><input type="checkbox" checked={!!st.done} onChange={() => void growthBook.toggleStep(d.id, i).then(onChange)} />{st.text}</label>
      ))}
      {draft === null ? (
        <button className="ghost small" disabled={busy} onClick={() => void suggest()}>{busy ? tr('处理中…') : steps.length ? tr('重新拆小') : tr('拆成小步')}</button>
      ) : (
        <div className="form">
          <textarea rows={4} value={draft} aria-label={tr('小步骤，一行一个')} placeholder={tr('一行一个小步骤，比如：先读第一篇的摘要和结论')} onChange={e => setDraft(e.target.value)} />
          <p className="muted">{tr('最多 {0} 步。改好再写进去。', STEP_MAX)}</p>
          <div className="row">
            <button className="primary" disabled={!parseSteps(draft).length} onClick={() => void growthBook.setSteps(d.id, parseSteps(draft)).then(g => { onChange(g); setDraft(null); })}>{tr('写进去')}</button>
            <button className="ghost" onClick={() => setDraft(null)}>{tr('取消')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A few still water drops on a card's rim: decoration only, never in the way of a tap. */
function Settings({ reviewOn, onChange }: { reviewOn: boolean; onChange: () => void }) {
  const [old, setOld] = useState<Decision[]>([]);
  useEffect(() => { void lifeBook.all().then(setOld); }, []);
  return (
    <details className="card more">
      <summary>{tr('成长空间的设置')}</summary>
      <button className="ghost" onClick={() => void lifeBook.setReview(!reviewOn).then(onChange)}>{reviewOn ? tr('不看成长周报') : tr('看成长周报')}</button>
      {old.length > 0 && (
        <details data-testid="old-life">
          <summary>{tr('以前的生活账（{0} 条，只读）', old.length)}</summary>
          {old.map(x => <p key={x.id} className="muted">{x.on} · {x.kind === 'own' ? tr('自己拿的主意') : tr('交给 AI 拿的主意')} · {x.title}</p>)}
        </details>
      )}
    </details>
  );
}
