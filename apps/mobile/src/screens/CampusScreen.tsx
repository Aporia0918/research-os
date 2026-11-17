// 大学学习生活 (owner 2026-11-17, replaces the old 生活 chat): classes and deadlines, a quick note after class, a focus
// session that ends in 讲给我听, how the day feels, and a debt from a month ago. Everything leads back to the 认知债 ledger.
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { book, today } from '../ledger/book';
import { LifeBook, type Decision } from '../ledger/life';
import { CampusBook, DEADLINE_KINDS, FOCUS_MINUTES, campusWeek, classNow, classesOn, monthAgo, planFor, pullDays, upcoming,
  type Campus, type Course, type DeadlineKind, type Energy, type Slot } from '../ledger/campus';
import type { Entry } from '../ledger/ledger';
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';
import { focusAlarm } from '../remind/native';
import { Zhangzhang, type ZzState } from '../jelly/Zhangzhang';

export const campusBook = new CampusBook(preferencesKV);
const oldLife = new LifeBook(preferencesKV);
const DOWS = ['一', '二', '三', '四', '五', '六', '日'];
const ENERGY: { id: Energy; label: string }[] = [{ id: 'high', label: '精力充足' }, { id: 'mid', label: '一般' }, { id: 'low', label: '需要休息' }];
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export interface CampusActions {
  /** Open 讲给我听 in the 学习 ledger. */
  onRepay: () => void;
  /** Open 记一笔 in the 学习 ledger with this course and question filled in. */
  onQuickNote: (course: string, question: string) => void;
  /** Open 拍一页问. */
  onPhoto: () => void;
}

export function CampusScreen({ onRepay, onQuickNote, onPhoto, switcher }: CampusActions & { switcher: React.ReactNode }) {
  const day = today();
  const [c, setC] = useState<Campus | null>(null);
  const [due, setDue] = useState(0);
  const [past, setPast] = useState<Entry | null>(null);
  const [note, setNote] = useState('');
  const [quick, setQuick] = useState('');
  const [quickCourse, setQuickCourse] = useState('');
  const [focusEnd, setFocusEnd] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [focusDone, setFocusDone] = useState(false);
  const [zz, setZz] = useState<ZzState>('wave');
  useEffect(() => { const t = setTimeout(() => setZz('life'), 2200); return () => clearTimeout(t); }, [zz]);

  async function load() {
    const camp = await campusBook.get();
    const all = await book.all();
    const moved: string[] = [];
    for (const [course, on] of pullDays(camp.deadlines, day)) if (await book.pullForward(course, on, day)) moved.push(course);
    if (moved.length) setNote(tr('{0} 快到考试或组会了，这门课的账已经排到那天前面。', moved.join('、')));
    setC(camp); setPast(monthAgo(all, day));
    setDue((await book.due(day)).filter(e => e.board === '学习' || e.board === '科研').length);
    const now = classNow(camp.courses, day, hhmm());
    if (now) setQuickCourse(q => q || now.course);
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on open

  useEffect(() => {
    if (focusEnd === null) return;
    const tick = () => {
      const ms = focusEnd - Date.now();
      if (ms <= 0) { setFocusEnd(null); setFocusDone(true); setZz('smile'); void campusBook.focused(day, FOCUS_MINUTES).then(setC); return; }
      setLeft(Math.ceil(ms / 1000));
    };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [focusEnd, day]);

  if (!c) return <section className="home">{switcher}</section>;
  const plan = planFor(c.energy?.on === day ? c.energy.level : undefined);
  const classes = classesOn(c.courses, day);
  const dls = upcoming(c.deadlines, day);
  const week = campusWeek(c, day);
  const courseNames = c.courses.map(x => x.name);

  async function startFocus() {
    const end = Date.now() + FOCUS_MINUTES * 60000;
    setFocusDone(false); setFocusEnd(end); setZz('think');
    await focusAlarm(end, tr('专注结束'), tr('讲给账账听一笔，刚学的最好讲。'));
  }
  async function stopFocus() { setFocusEnd(null); await focusAlarm(null, '', ''); }
  async function repayAfterFocus() { setC(await campusBook.repaidAfterFocus(day)); setFocusDone(false); onRepay(); }
  async function energy(level: Energy) { setC(await campusBook.setEnergy(day, level)); setZz(level === 'low' ? 'hug' : 'smile'); }

  return (
    <section className="home campus" data-testid="campus">
      {switcher}
      <div className="hero-wrap">
        <div className="hero-zz"><Zhangzhang state={zz} size={150} /></div>
        <div className="card hero" data-board="生活">
          <p className="eyebrow">{tr('大学学习生活 · 课、截止日和专注都连着你的账')}</p>
          <div className="kpis kpis-3">
            <div><span className="big">{classes.length}</span><span className="kpi-label">{tr('节课今天')}</span></div>
            <div><span className="big">{dls.length ? dls[0].left : '—'}</span><span className="kpi-label">{dls.length ? tr('天到「{0}」', dls[0].title) : tr('没有截止日')}</span></div>
            <div><span className="big">{Math.min(due, plan.count)}</span><span className="kpi-label">{tr('笔今天建议讲')}</span></div>
          </div>
          <button className="primary big-button" onClick={onRepay} data-testid="campus-repay">{due ? tr('讲给我听 · 今天 {0} 笔', due) : tr('讲给我听')}</button>
        </div>
      </div>
      {note && <p className="note" role="status">{note}</p>}

      <div className="card" data-testid="energy">
        <h2>{tr('今天状态怎么样？')}</h2>
        <div className="row" role="radiogroup" aria-label={tr('今天的状态')}>
          {ENERGY.map(x => <button key={x.id} type="button" role="radio" className="ghost" aria-checked={c.energy?.on === day && c.energy.level === x.id} onClick={() => void energy(x.id)}>{tr(x.label)}</button>)}
        </div>
        <p className="muted">{tr(plan.minute)}</p>
      </div>

      <div className="card" data-testid="quick-note">
        <h2>{tr('课堂快记')}</h2>
        {courseNames.length > 0 && (
          <div className="chips" role="radiogroup" aria-label={tr('哪门课')}>
            {courseNames.map(n => <button key={n} type="button" role="radio" className="chip" aria-checked={quickCourse === n} onClick={() => setQuickCourse(n)}>{n}</button>)}
          </div>
        )}
        <textarea rows={2} value={quick} placeholder={tr('这节课哪里没懂？一句话就行')} onChange={e => setQuick(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={!quick.trim()} onClick={() => { onQuickNote(quickCourse, quick.trim()); setQuick(''); }}>{tr('记进账本')}</button>
          <button className="ghost" onClick={onPhoto}>{tr('拍板书问')}</button>
        </div>
      </div>

      <div className="card" data-testid="focus">
        <h2>{tr('专注一段')}</h2>
        {focusEnd !== null ? (
          <>
            <p className="big focus-clock" aria-live="polite">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</p>
            <button className="ghost" onClick={() => void stopFocus()}>{tr('先停下')}</button>
          </>
        ) : focusDone ? (
          <>
            <p>{tr('专注了 {0} 分钟。趁热讲给我听一笔？', FOCUS_MINUTES)}</p>
            <div className="row">
              <button className="primary" onClick={() => void repayAfterFocus()}>{tr('讲一笔')}</button>
              <button className="ghost" onClick={() => setFocusDone(false)}>{tr('先休息')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{tr('{0} 分钟，结束时讲给我听一笔。不计打卡，停下也没关系。', FOCUS_MINUTES)}</p>
            <button className="primary" onClick={() => void startFocus()}>{tr('开始 {0} 分钟', FOCUS_MINUTES)}</button>
          </>
        )}
      </div>

      <Deadlines c={c} courses={courseNames} day={day} onChange={setC} />

      {classes.length > 0 && (
        <div className="card" data-testid="today-classes">
          <h2>{tr('今天的课')}</h2>
          {classes.map(x => <p key={x.course + x.slot.start} className="class-row"><b>{x.slot.start}–{x.slot.end}</b> {x.course}{x.slot.place ? ` · ${x.slot.place}` : ''}</p>)}
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

      <div className="card" data-testid="campus-week">
        <h2>{tr('这一周')}</h2>
        <p>{tr('专注 {0} 次，其中 {1} 次之后去讲了；本周截止的 {2} 项完成 {3} 项。', week.focus, week.focusRepaid, week.due, week.done)}</p>
      </div>

      <Timetable c={c} onChange={setC} />
      <OldLife />
    </section>
  );
}

function Deadlines({ c, courses, day, onChange }: { c: Campus; courses: string[]; day: string; onChange: (c: Campus) => void }) {
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState({ title: '', course: '', kind: '作业' as DeadlineKind, on: '' });
  const list = upcoming(c.deadlines, day);
  async function add() {
    onChange(await campusBook.addDeadline({ id: newId(), ...d, course: d.course.trim() }));
    setD({ title: '', course: '', kind: '作业', on: '' }); setAdding(false);
  }
  return (
    <div className="card" data-testid="deadlines">
      <h2>{tr('截止日')}</h2>
      {list.length === 0 && <p className="muted">{tr('作业、实验报告、考试、组会都可以记在这里。考试和组会一周内到，那门课的账会自动排到前面。')}</p>}
      {list.map(x => (
        <div key={x.id} className="deadline-row">
          <span className={x.left <= 2 ? 'dl-left soon' : 'dl-left'}>{x.left === 0 ? tr('今天') : tr('{0} 天', x.left)}</span>
          <span className="course-name">{x.title}<span className="muted">{tr(x.kind)}{x.course ? ` · ${x.course}` : ''} · {x.on}</span></span>
          <button className="ghost" aria-label={tr('完成：{0}', x.title)} onClick={() => void campusBook.finish(x.id, day).then(onChange)}>✓</button>
        </div>
      ))}
      {adding ? (
        <div className="form">
          <input value={d.title} placeholder={tr('比如：高数第 5 章作业')} aria-label={tr('截止日名称')} onChange={e => setD({ ...d, title: e.target.value })} />
          <input value={d.course} list="campus-courses" placeholder={tr('哪门课（可不填）')} aria-label={tr('哪门课')} onChange={e => setD({ ...d, course: e.target.value })} />
          <datalist id="campus-courses">{courses.map(n => <option key={n} value={n} />)}</datalist>
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

function Timetable({ c, onChange }: { c: Campus; onChange: (c: Campus) => void }) {
  const blank = (): Course => ({ id: newId(), name: '', slots: [{ dow: 1, start: '08:00', end: '09:40' }] });
  const [edit, setEdit] = useState<Course | null>(null);
  const slot = (i: number, s: Partial<Slot>) => edit && setEdit({ ...edit, slots: edit.slots.map((x, j) => j === i ? { ...x, ...s } : x) });
  return (
    <details className="card" data-testid="timetable">
      <summary>{tr('课表（{0} 门课）', c.courses.length)}</summary>
      {c.courses.map(x => (
        <div key={x.id} className="deadline-row">
          <span className="course-name">{x.name}<span className="muted">{x.slots.map(s => tr('周{0} {1}–{2}', DOWS[s.dow - 1], s.start, s.end)).join('，')}</span></span>
          <button className="ghost" onClick={() => setEdit(x)}>{tr('改')}</button>
        </div>
      ))}
      {edit ? (
        <div className="form">
          <input value={edit.name} placeholder={tr('课程名，比如：高数 3')} aria-label={tr('课程名')} onChange={e => setEdit({ ...edit, name: e.target.value })} />
          {edit.slots.map((s, i) => (
            <div key={i} className="row">
              <select value={s.dow} aria-label={tr('星期')} onChange={e => slot(i, { dow: Number(e.target.value) })}>
                {DOWS.map((w, k) => <option key={w} value={k + 1}>{tr('周{0}', w)}</option>)}
              </select>
              <input type="time" value={s.start} aria-label={tr('开始')} onChange={e => slot(i, { start: e.target.value })} />
              <input type="time" value={s.end} aria-label={tr('结束')} onChange={e => slot(i, { end: e.target.value })} />
            </div>
          ))}
          <div className="row">
            <button className="ghost" onClick={() => setEdit({ ...edit, slots: [...edit.slots, { dow: 1, start: '08:00', end: '09:40' }] })}>{tr('再加一节')}</button>
            <button className="primary" disabled={!edit.name.trim()} onClick={() => void campusBook.saveCourse(edit).then(x => { onChange(x); setEdit(null); })}>{tr('保存')}</button>
            {c.courses.some(x => x.id === edit.id) && <button className="ghost" onClick={() => void campusBook.removeCourse(edit.id).then(x => { onChange(x); setEdit(null); })}>{tr('删掉这门课')}</button>}
          </div>
        </div>
      ) : <button className="ghost" onClick={() => setEdit(blank())}>{tr('加一门课')}</button>}
    </details>
  );
}

/** The old 生活 ledger, kept read-only so nothing the user wrote is lost. */
function OldLife() {
  const [old, setOld] = useState<Decision[]>([]);
  useEffect(() => { void oldLife.all().then(setOld); }, []);
  if (!old.length) return null;
  return (
    <details className="card" data-testid="old-life">
      <summary>{tr('以前的生活账（{0} 条，只读）', old.length)}</summary>
      {old.map(d => <p key={d.id} className="muted">{d.on} · {d.kind === 'own' ? tr('自己拿的主意') : tr('交给 AI 拿的主意')} · {d.title}</p>)}
    </details>
  );
}
