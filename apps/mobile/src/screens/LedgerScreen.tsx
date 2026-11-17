// 思维账本 first screen: the pre-exam report on top, today's repayments, then booking a new debt. Works with no key
// and no computer; a model set in Settings is asked only where it can change a grade (ledger.needsModel).
import { setBoardTheme } from '../look';
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { countdown, type Ask, type Book, type Entry, type Grade, type HelpLevel, type LedgerRemote } from '../ledger/ledger';
import { ResearchOsClient } from '../api/computer';
import { loadComputerSettings } from '../settings';
import { book, copyText, today } from '../ledger/book';
import { chat } from '../model/direct';
import { forJob, loadKey, loadModelSettings } from '../model/settings';
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';
import { loadPaper, paperPages } from '../local/paperStore';
import type { Source } from '../rules/recall';
import { LifeScreen } from './LifeScreen';
import { Icon, type IconName } from '../icons';
import { Zhangzhang } from '../jelly/Zhangzhang';
import { homeMood, type Moment } from '../jelly/mood';
import { courses, recentTopics, NO_TOPIC } from '../ledger/courses';

const EXAM_KEY = 'mindledger.exam.v1';
const LEVELS: { id: HelpLevel; label: string }[] = [
  { id: 'own', label: tr('自己想的') }, { id: 'hint', label: tr('提示') },
  { id: 'approach', label: tr('思路') }, { id: 'answer', label: tr('完整答案') },
];
type Board = Entry['board'];
type View = 'home' | 'due' | 'add' | 'list' | 'recall' | 'quiz';
const BOARDS: Board[] = ['学习', '科研', '生活'];
const BOARD_KEY = 'mindledger.board.v1';
/** 学习 and 科研 share the debt ledger, each seeing only its own debts; 生活 is a different book on a different screen. */
const ofBoard = (b: Board) => (e: Entry) => e.board === b;
const GRADE_SYSTEM = '根据参考答案列出正确回答必须包含的 2 到 6 个要点，再按从 0 开始的序号列出作答在实质上讲到了哪些。不要判断通过与否。只回复 JSON：' + '{"points":[],"hits":[]}';

async function modelAsk(): Promise<Ask | undefined> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return undefined;
  return (q, ref, attempt) => chat(forJob(s, 'grade'), key, [{ role: 'system', content: GRADE_SYSTEM },
    { role: 'user', content: `问题：\n${q}\n\n参考答案：\n${ref}\n\n不看 AI 写的作答：\n${attempt}` }]);
}

type Report = Awaited<ReturnType<Book['report']>>;
const missedOf = (g: Grade) => g.points.filter((_, i) => !g.hits.includes(i)).join('；');
const redTag = (e: Entry) => (e.kind ? tr('崩分') : tr('讲不出来'));
const openRecall = (e: Entry) => e.recalls!.find((r) => r.state === 'open')!;
/** The paper imported on this phone, as the recall rules read it; null before any import. */
async function importedPaper(): Promise<Source | null> {
  const p = await loadPaper(preferencesKV);
  return p ? { name: p.ref.name, pages: paperPages(p) } : null;
}

/** The paired computer as the book sees it; null when computer features are off. */
async function remote(): Promise<LedgerRemote | null> {
  const s = await loadComputerSettings(preferencesKV);
  if (!s.enabled) return null;
  const c = new ResearchOsClient(s.url, undefined, 5000);
  return { entry: (b, k) => c.ledgerEntry(b, k), attempt: (id, t, k) => c.ledgerAttempt(id, t, k), due: () => c.ledgerDue() };
}

export function LedgerScreen({ onGo }: { onGo?: (to: 'ask' | 'exam') => void } = {}) {
  const [board, setBoard] = useState<Board>('科研');
  useEffect(() => setBoardTheme(board), [board]);
  const [exam, setExam] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [due, setDue] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [note, setNote] = useState('');
  const [quiz, setQuiz] = useState<Entry[]>([]);
  const [fresh, setFresh] = useState<Entry | null>(null); // just booked: 「这一步你讲给我听？」
  const [endNow, setEndNow] = useState(false);
  const [recalled, setRecalled] = useState<Entry[]>([]);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [all, setAll] = useState<Entry[]>([]);
  const [course, setCourse] = useState<string | null>(null); // 讲给我听 for one course only
  /** A moment 账账 reacts to (hello, booked, paid, missed); it goes back to the book's own state after one beat. */
  const [moment, setMoment] = useState<Moment>('hello');
  useEffect(() => { if (!moment) return; const t = setTimeout(() => setMoment(null), moment === 'paid' ? 2400 : 2000); return () => clearTimeout(t); }, [moment]);
  const [draft, setDraft] = useState({ topic: '', question: '', answer: '', ownIdea: '', ai: '', level: 'answer' as HelpLevel });

  async function refresh(e = exam, end = endNow, b = board) {
    if (b === '生活') return;
    setAll(await book.all());
    setDue((await book.due(today())).filter(ofBoard(b)));
    setRecalled((await book.recalled()).filter(ofBoard(b)));
    setQuiz((await book.quizDue(today(), end)).filter(ofBoard(b)));
    setReport(e ? await book.report(today(), e, b) : null);
  }
  function pickBoard(b: Board) { setBoard(b); setNote(''); setFresh(null); setOpen(null); setView('home'); void preferencesKV.set(BOARD_KEY, b); void refresh(exam, endNow, b); }
  useEffect(() => {
    void book.trialStart().then(async s => { if (s) await book.opened(today()); });
    void Promise.all([preferencesKV.get(EXAM_KEY), preferencesKV.get(BOARD_KEY)]).then(([e, b]) => {
      const start = BOARDS.includes(b as Board) ? b as Board : '科研';
      setExam(e ?? ''); setBoard(start); void refresh(e ?? '', false, start);
    });
    void remote().then(async r => {
      if (!r) return;
      const s = await book.sync(r, today());
      if (s.pulled) setNote(tr('电脑上记的 {0} 笔已经到手机上，可以接着还。', s.pulled));
      if (s.sent || s.pulled) await refresh();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on open
  }, []);

  const left = countdown(today(), exam || undefined, report?.repayBeforeExam.length ?? 0);
  const pickExam = (e: string) => { setExam(e); void preferencesKV.set(EXAM_KEY, e).then(() => refresh(e)); };
  const switcher = (
    <div role="tablist" className="seg board-switch" data-testid="board-switch">{BOARDS.map(b => (
      <button key={b} role="tab" aria-selected={board === b} onClick={() => pickBoard(b)}>{tr(b)}</button>
    ))}</div>
  );
  async function repay(id: string) {
    const g = await book.repay(id, said, today(), exam || undefined, await modelAsk());
    setNote(g.passed ? tr('讲顺了，这笔还上了。') : tr('还差这些没讲到：{0}。明天再讲一次。', missedOf(g)));
    setMoment(g.passed ? 'paid' : 'missed');
    setSaid(''); setOpen(null); await refresh();
  }
  /** Right after booking. 讲不出来 is a plain answer, not a failure: no score, the debt is marked red and goes first. */
  async function checkNow(e: Entry, attempt: string) {
    const g = await book.checkNow(e.id, attempt, today(), exam || undefined, attempt.trim() ? await modelAsk() : undefined);
    setNote(g?.passed ? tr('讲顺了。到日子再讲一次，记得更牢。')
      : g ? tr('还差这些没讲到：{0}。这一笔标红，排在考前清单最前面。', missedOf(g))
        : tr('记下了。这一笔标红，排在考前清单最前面。'));
    setMoment(g?.passed ? 'paid' : 'missed');
    setSaid(''); setFresh(null); await refresh();
  }
  /** Opening a debt brings back whatever was said before an interruption (a call, the app closed). */
  async function pick(id: string) {
    if (open === id) { setOpen(null); return; }
    setSaid(await book.draftOf(id)); setOpen(id);
  }
  async function answerQuiz(id: string) {
    const ok = await book.quiz(id, said);
    setNote(ok ? tr('讲顺了。') : tr('记下了，这一笔不影响你的账。'));
    setSaid(''); setOpen(null); await refresh();
  }
  /** Check the paper already imported here against the ledger (a new import does this by itself). */
  async function scan() {
    const paper = await importedPaper();
    if (!paper) { setNote(tr('还没导入论文。先在「提问」里导入一篇。')); return; }
    const hits = await book.recallScan(paper, today());
    setNote(hits.length ? tr('{0} 条 AI 的说法被《{1}》的原话推翻，召回单在最上面。', hits.length, paper.name)
      : tr('《{0}》里没有和账上说法相反的原话。', paper.name));
    await refresh();
  }
  async function accept(id: string) {
    await book.acceptRecall(id, today(), exam || undefined);
    setNote(tr('这笔重新打开了：参考答案换成了原文那句，今天再讲一遍。')); await refresh();
  }
  /** 驳回 only with a sentence the rules can find in the imported paper and that backs what the AI said. */
  async function dismiss(id: string) {
    const paper = await importedPaper();
    try {
      await book.dismissRecall(id, said, paper ? [paper] : []);
      setNote(tr('证据核对通过，这张召回单撤下了。')); setSaid(''); setDisputing(null); await refresh();
    } catch {
      setNote(tr('这句话在导入的论文里找不到原文，或者它不支持 AI 当时的说法，召回单保留。'));
    }
  }
  async function copy(text: string, done: string) { await copyText(text); setNote(done); }
  async function add() {
    if (board === '生活') return;
    const e = await book.add({ clientId: newId(), board, topic: draft.topic, question: draft.question,
      answer: draft.answer, ownIdea: draft.ownIdea, ai: draft.ai, helpLevel: draft.level }, today(), exam || undefined);
    setDraft({ ...draft, question: '', answer: '', ownIdea: '' }); setNote('');
    setFresh(e.weight && e.dueOn ? e : null); setSaid(''); setView('home'); setMoment('booked'); await refresh();
  }

  if (board === '生活') return <section className="home">{switcher}<LifeScreen /></section>;
  const topics = recentTopics(all, board);
  const back = <button className="back" onClick={() => { setView('home'); setOpen(null); setCourse(null); }}>{tr('‹ 账本')}</button>;
  const status = note && <p className="note" role="status">{note}</p>;

  // Sub-pages: one job each, reached from the home screen. Nothing here is on the home screen itself.
  const dueShown = course ? due.filter(e => (e.topic.trim() || NO_TOPIC) === course) : due;
  if (view === 'due') return (
    <section>{back}
      <h1>{course ? tr('讲给我听 · {0}', course) : tr('讲给我听')}</h1>
      {status}
      {left !== null && <p className="muted" data-testid="countdown">{tr('离那天还有 {0} 天，这 {1} 笔还没讲过，到时可能被问到。', left, report!.repayBeforeExam.length)}</p>}
      {dueShown.length === 0 && <div className="card"><p>{tr('今天没有要还的。')}</p></div>}
      {dueShown.map(e => e.kind ? (
        <div key={e.id} className={`card${e.red ? ' red-mark' : ''}`} data-testid="conclusion-due">
          <b>{e.question}</b>{e.red && <span className="pill bad">{redTag(e)}</span>}
          <div className="muted">{tr('结论债靠零世界考试还：改好后到「科研 → 零世界」再考一次。')}</div>
        </div>
      ) : (
        <div key={e.id} className={`card${e.red ? ' red-mark' : ''}`}>
          <button className="item" onClick={() => void pick(e.id)}>
            <span>{e.question}{e.fromComputer ? tr('（电脑上记的）') : ''}</span>
            <span className="pill">{tr(e.board)}</span>
          </button>
          {open === e.id && (
            <>
              <textarea value={said} placeholder={tr('不看答案，讲给我听')} onChange={x => { setSaid(x.target.value); void book.saveDraft(e.id, x.target.value); }} />
              <button className="primary" disabled={!said.trim()} onClick={() => void repay(e.id)}>{tr('讲完了')}</button>
            </>
          )}
        </div>
      ))}
    </section>
  );
  if (view === 'add') return (
    <section>{back}
      <h1>{tr('记一笔')}</h1>
      <div className="card">
        <input value={draft.topic} data-testid="topic" placeholder={board === '学习' ? tr('哪门课（比如高数）') : tr('哪篇论文或哪个课题')} onChange={x => setDraft({ ...draft, topic: x.target.value })} />
        {topics.length > 0 && <div className="chips" role="group" aria-label={board === '学习' ? tr('最近的课') : tr('最近的论文和课题')}>{topics.map(t => (
          <button key={t} type="button" className="chip" aria-pressed={draft.topic === t} onClick={() => setDraft({ ...draft, topic: t })}>{t}</button>
        ))}</div>}
        <textarea value={draft.ownIdea} placeholder={tr('先写下你自己的想法（写了债会轻一档）')} onChange={x => setDraft({ ...draft, ownIdea: x.target.value })} />
        <textarea value={draft.question} placeholder={tr('问了 AI 什么')} onChange={x => setDraft({ ...draft, question: x.target.value })} />
        <textarea value={draft.answer} placeholder={tr('AI 的回答（可选，还账时对照）')} onChange={x => setDraft({ ...draft, answer: x.target.value })} />
        <input value={draft.ai} placeholder={tr('哪个 AI（可选，比如豆包）')} onChange={x => setDraft({ ...draft, ai: x.target.value })} />
        <div className="seg" role="radiogroup" aria-label={tr('AI 帮了多少')}>{LEVELS.map(l => (
          <button key={l.id} type="button" role="radio" aria-checked={draft.level === l.id} onClick={() => setDraft({ ...draft, level: l.id })}>{l.label}</button>
        ))}</div>
        <button className="primary" disabled={!draft.question.trim()} onClick={() => void add()}>{tr('记下')}</button>
      </div>
    </section>
  );
  if (view === 'list') return (
    <section>{back}
      <h1>{tr('考前清单')}</h1>
      {status}
      <div className="card">
        <label>{tr('考试、组会或答辩日期')} <input type="date" value={exam} onChange={e => pickExam(e.target.value)} /></label>
        {!exam && <p className="muted">{tr('设了日期，账本会按那天往回排还账。')}</p>}
        {report && report.repayBeforeExam.length > 0 ? (
          <ol className="exam-list" data-testid="exam-list">
            {report.repayBeforeExam.map(i => (
              <li key={i.id} className={i.red ? 'red-mark' : undefined}>
                {i.question}{i.red && <span className="red-tag">{redTag(i)}</span>}
              </li>
            ))}
          </ol>
        ) : report && <p className="muted">{tr('考前没有要还的。')}</p>}
      </div>
      <TrialCard onEnd={() => { setEndNow(true); setView('quiz'); void refresh(exam, true); }} onCopy={copy} />
      <div className="card">
        <button className="ghost" onClick={() => void book.processRecord(today(), exam || undefined, board).then(t => copy(t, tr('过程记录已复制，只在你自己手里。')))}>
          {tr('复制过程记录')}
        </button>
        <button className="ghost" onClick={() => void scan().then(() => setView('recall'))}>{tr('用导入的论文查一遍召回')}</button>
      </div>
    </section>
  );
  if (view === 'recall') return (
    <section>{back}
      <h1>{tr('召回单')}</h1>
      {status}
      {recalled.length === 0 && <div className="card"><p className="muted">{tr('现在没有召回单。')}</p></div>}
      {recalled.length > 0 && (
        <div data-testid="recall-slips">
          <p className="muted">{tr('你导入的论文里有原话和 AI 当时的说法相反。')}</p>
          {recalled.map(e => { const r = openRecall(e); return (
            <div key={e.id} className="card red-mark" data-testid="recall-slip">
              <b>{e.question}</b>
              <div>{tr('当时 {0} 说：{1}', e.ai ?? 'AI', r.claim)}</div>
              <div>{tr('《{0}》第 {1} 页：{2}', r.paper, r.page, r.quote)}</div>
              <div className="row">
                <button className="primary" onClick={() => void accept(e.id)}>{tr('接受，重开这笔')}</button>
                <button className="ghost" onClick={() => { setDisputing(disputing === e.id ? null : e.id); setSaid(''); }}>{tr('我有原文证据')}</button>
              </div>
              {disputing === e.id && (
                <>
                  <textarea value={said} placeholder={tr('贴一句导入论文里的原话，要支持 AI 当时的说法')} onChange={x => setSaid(x.target.value)} />
                  <button className="primary" disabled={!said.trim()} onClick={() => void dismiss(e.id)}>{tr('提交证据')}</button>
                </>
              )}
            </div>
          ); })}
        </div>
      )}
    </section>
  );
  if (view === 'quiz') return (
    <section>{back}
      <h1>{tr('试用结束小测')}</h1>
      {status}
      {quiz.length === 0 ? <div className="card"><p className="muted">{tr('小测做完了。')}</p></div> : (
        <div className="card" data-testid="trial-quiz">
          <h2>{tr('试用结束小测（还剩 {0} 笔）', quiz.length)}</h2>
          <p className="muted">{tr('每笔都不看答案讲一遍，不管之前排没排过还账。')}</p>
          <b>{quiz[0].question}</b>
          <textarea value={said} placeholder={tr('不看答案，讲给我听')} onChange={x => setSaid(x.target.value)} />
          <button className="primary" disabled={!said.trim()} onClick={() => void answerQuiz(quiz[0].id)}>{tr('讲完了')}</button>
        </div>
      )}
    </section>
  );

  // Home: 账账 standing on one hero, one button, a few ways in. 学习 counts down to the exam and reads by course; 科研 is
  // a console of 理解债 from papers and 结论债 from analyses, with the 零世界 check one tap away.
  const mine = all.filter(ofBoard(board));
  const list = courses(all, board);
  const owed = report?.repayBeforeExam.length ?? due.length;
  const share = report?.independence ?? (mine.length ? list.reduce((n, c) => n + c.clear, 0) / mine.length : null);
  const pct = share === null ? '—' : `${Math.round(share * 100)}%`;
  const research = board === '科研';
  const conclusions = due.filter(e => e.kind === 'conclusion').length;
  const zz = homeMood({ board, moment, total: mine.length, redDue: due.filter(e => e.red).length, quiz: quiz.length, hour: new Date().getHours() });
  const go = (v: View) => () => { setNote(''); setCourse(null); setView(v); };
  const orb = (icon: IconName, label: string, onClick: () => void) => (
    <button key={label} className="orb-button" onClick={onClick}><span className="orb"><Icon name={icon} /></span>{tr(label)}</button>
  );
  return (
    <section className={`home ${research ? 'home-research' : 'home-study'}`}>
      {switcher}
      <div className="hero-wrap">
        <div className="hero-zz"><Zhangzhang state={zz} size={150} /></div>
        <div className="card hero" data-testid="ledger-hero" data-board={board}>
          <p className="eyebrow">{research ? tr('科研 · 读论文、跑分析时问过 AI 的') : tr('学习 · 课上、刷题时问过 AI 的')}</p>
          {research ? (
            <div className="kpis kpis-3">
              <div><span className="big" data-testid="owed">{owed}</span><span className="kpi-label">{exam ? tr('笔组会前要还') : tr('笔要还')}</span></div>
              <div><span className="big">{conclusions}</span><span className="kpi-label">{tr('笔结论债')}</span></div>
              <div><span className="big">{pct}</span><span className="kpi-label">{tr('独立掌握度')}</span></div>
            </div>
          ) : (
            <div className="ring-row">
              <Ring share={share ?? 0} label={pct} />
              <div className="kpis-col">
                <div><span className="big" data-testid="owed">{owed}</span><span className="kpi-label">{exam ? tr('笔考前要还') : tr('笔要还')}</span></div>
                <span className="kpi-label">{tr('圈里是独立掌握度：不靠 AI 讲清楚的占几成')}</span>
              </div>
            </div>
          )}
          {report && <p className="muted" data-testid="ledger-report">{tr('考前要还 {0} 笔，还清 {1} 笔，讲到一半的 {2} 笔', report.repayBeforeExam.length, report.counts.settled, report.counts.shaky)}</p>}
          {left !== null && <p className="muted" data-testid="countdown">{tr('离那天还有 {0} 天，这 {1} 笔还没讲过，到时可能被问到。', left, report!.repayBeforeExam.length)}</p>}
          <button className="primary big-button" onClick={go('due')} data-testid="go-due">
            {due.length ? tr('讲给我听 · 今天 {0} 笔', due.length) : tr('讲给我听')}
          </button>
        </div>
      </div>
      {status}
      {recalled.length > 0 && <button className="alert" onClick={() => setView('recall')} data-testid="recall-alert">{tr('召回单 {0} 条：论文原话和 AI 说的相反', recalled.length)}</button>}
      {quiz.length > 0 && <button className="alert" onClick={() => setView('quiz')}>{tr('试用结束小测还剩 {0} 笔', quiz.length)}</button>}
      {fresh && (
        <div className="card" data-testid="explain-now">
          <h2>{tr('这一步你讲给我听？')}</h2>
          <p className="muted">{fresh.question}</p>
          <textarea value={said} placeholder={tr('不看答案，讲给我听')} onChange={x => setSaid(x.target.value)} />
          <div className="row">
            <button className="primary" disabled={!said.trim()} onClick={() => void checkNow(fresh, said)}>{tr('讲完了')}</button>
            <button className="ghost" onClick={() => void checkNow(fresh, '')}>{tr('讲不出来')}</button>
            <button className="ghost" onClick={() => setFresh(null)}>{tr('先不讲')}</button>
          </div>
        </div>
      )}
      <nav className={`orbs${research ? ' orbs-4' : ''}`} aria-label={tr('账本')}>
        {research ? [
          orb('plus', '记一笔', go('add')),
          orb('list', '考前清单', go('list')),
          orb('recall', '召回单', go('recall')),
          orb('exam', '结论体检', () => onGo?.('exam')),
        ] : [
          orb('plus', '记一笔', go('add')),
          orb('list', '考前清单', go('list')),
          orb('camera', '拍一页问', () => onGo?.('ask')),
        ]}
      </nav>
      {list.length > 0 && (
        <div className="card courses" data-testid="courses">
          <h2>{research ? tr('按论文和课题') : tr('按课程')}</h2>
          {list.map(c => (
            <button key={c.topic} type="button" className="course-row" onClick={() => { setNote(''); setCourse(c.topic); setView('due'); }}>
              <span className={c.red ? 'course-mark red' : c.open ? 'course-mark' : 'course-mark ok'}>{c.red ? '×' : c.open || '✓'}</span>
              <span className="course-name">{c.topic}<span className="muted">{c.open ? tr('{0} 笔没讲清，还清 {1} 笔', c.open, c.clear) : tr('{0} 笔都讲清了', c.total)}</span></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** 独立掌握度 as a ring: the share explained without AI. */
function Ring({ share, label }: { share: number; label: string }) {
  return (
    <div className="ring" role="img" aria-label={tr('独立掌握度 {0}', label)}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" className="ring-bg" />
        <circle cx="32" cy="32" r="26" className="ring-fg" pathLength="100" strokeDasharray={`${Math.round(share * 100)} 100`} />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Two-week classmate trial: start it, end it early, and copy the counts-only result. Shown only once a trial has started. */
function TrialCard({ onEnd, onCopy }: { onEnd: () => void; onCopy: (t: string, done: string) => Promise<void> }) {
  const [start, setStart] = useState<string | null>(null);
  useEffect(() => { void book.trialStart().then(setStart); }, []);
  if (!start) return null;
  return (
    <div className="card" data-testid="trial-card">
      <p className="muted">{tr('两周试用从 {0} 开始。', start)}</p>
      <button className="ghost" onClick={onEnd}>{tr('现在做结束小测')}</button>
      <button className="ghost" onClick={() => void book.trialSummary(today()).then(s => onCopy(JSON.stringify(s), tr('试用结果已复制，只有数字，没有题目和回答。')))}>
        {tr('复制试用结果')}
      </button>
    </div>
  );
}
