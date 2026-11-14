// 思维账本 first screen: the pre-exam report on top, today's repayments, then booking a new debt. Works with no key
// and no computer; a model set in Settings is asked only where it can change a grade (ledger.needsModel).
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { type Ask, type Book, type Entry, type HelpLevel, type LedgerRemote } from '../ledger/ledger';
import { ResearchOsClient } from '../api/computer';
import { loadComputerSettings } from '../settings';
import { book, copyText, today } from '../ledger/book';
import { chat } from '../model/direct';
import { loadKey, loadModelSettings } from '../model/settings';
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';

const EXAM_KEY = 'mindledger.exam.v1';
const LEVELS: { id: HelpLevel; label: string }[] = [
  { id: 'own', label: tr('自己想的') }, { id: 'hint', label: tr('提示') },
  { id: 'approach', label: tr('思路') }, { id: 'answer', label: tr('完整答案') },
];
const BOARDS: Entry['board'][] = ['学习', '科研', '生活'];
const GRADE_SYSTEM = '根据参考答案列出正确回答必须包含的 2 到 6 个要点，再按从 0 开始的序号列出作答在实质上讲到了哪些。不要判断通过与否。只回复 JSON：' + '{"points":[],"hits":[]}';

async function modelAsk(): Promise<Ask | undefined> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return undefined;
  return (q, ref, attempt) => chat(s, key, [{ role: 'system', content: GRADE_SYSTEM },
    { role: 'user', content: `问题：\n${q}\n\n参考答案：\n${ref}\n\n不看 AI 写的作答：\n${attempt}` }]);
}

type Report = Awaited<ReturnType<Book['report']>>;

/** The paired computer as the book sees it; null when computer features are off. */
async function remote(): Promise<LedgerRemote | null> {
  const s = await loadComputerSettings(preferencesKV);
  if (!s.enabled) return null;
  const c = new ResearchOsClient(s.url, undefined, 5000);
  return { entry: (b, k) => c.ledgerEntry(b, k), attempt: (id, t, k) => c.ledgerAttempt(id, t, k), due: () => c.ledgerDue() };
}

export function LedgerScreen() {
  const [exam, setExam] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [due, setDue] = useState<Entry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [note, setNote] = useState('');
  const [quiz, setQuiz] = useState<Entry[]>([]);
  const [endNow, setEndNow] = useState(false);
  const [draft, setDraft] = useState({ board: BOARDS[0], topic: '', question: '', answer: '', ownIdea: '', level: 'answer' as HelpLevel });

  async function refresh(e = exam, end = endNow) {
    setDue(await book.due(today()));
    setQuiz(await book.quizDue(today(), end));
    setReport(e ? await book.report(today(), e) : null);
  }
  useEffect(() => {
    void book.trialStart().then(async s => { if (s) await book.opened(today()); });
    void preferencesKV.get(EXAM_KEY).then(e => { setExam(e ?? ''); void refresh(e ?? ''); });
    void remote().then(async r => {
      if (!r) return;
      const s = await book.sync(r, today());
      if (s.pulled) setNote(tr('电脑上记的 {0} 笔已经到手机上，可以接着还。', s.pulled));
      if (s.sent || s.pulled) await refresh();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on open
  }, []);

  const pickExam = (e: string) => { setExam(e); void preferencesKV.set(EXAM_KEY, e).then(() => refresh(e)); };
  async function repay(id: string) {
    const g = await book.repay(id, said, today(), exam || undefined, await modelAsk());
    const missed = g.points.filter((_, i) => !g.hits.includes(i));
    setNote(g.passed ? tr('讲顺了，这笔还上了。') : tr('还差这些没讲到：{0}。明天再讲一次。', missed.join('；')));
    setSaid(''); setOpen(null); await refresh();
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
  async function copy(text: string, done: string) { await copyText(text); setNote(done); }
  async function add() {
    await book.add({ clientId: newId(), board: draft.board, topic: draft.topic, question: draft.question,
      answer: draft.answer, ownIdea: draft.ownIdea, helpLevel: draft.level }, today(), exam || undefined);
    setDraft({ ...draft, question: '', answer: '', ownIdea: '' }); await refresh();
  }

  return (
    <section>
      <div className="card">
        <h2>{tr('考前真实掌握度')}</h2>
        <label>{tr('考试日期')} <input type="date" value={exam} onChange={e => pickExam(e.target.value)} /></label>
        {report && (
          <p data-testid="ledger-report">
            {tr('独立掌握度 {0}（只算不靠 AI 的作答）', report.independence === null ? '—' : `${Math.round(report.independence * 100)}%`)}<br />
            {tr('考前要还 {0} 笔，还清 {1} 笔，讲到一半的 {2} 笔', report.repayBeforeExam.length, report.counts.settled, report.counts.shaky)}
          </p>
        )}
        <button className="ghost" onClick={() => void book.processRecord(today(), exam || undefined).then(t => copy(t, tr('过程记录已复制，只在你自己手里。')))}>
          {tr('复制过程记录')}
        </button>
      </div>
      {quiz.length > 0 && (
        <div className="card" data-testid="trial-quiz">
          <h2>{tr('试用结束小测（还剩 {0} 笔）', quiz.length)}</h2>
          <p className="muted">{tr('每笔都不看答案讲一遍，不管之前排没排过还账。')}</p>
          <button className="ghost" onClick={() => setOpen(open === quiz[0].id ? null : quiz[0].id)}>{quiz[0].question}</button>
          {open === quiz[0].id && (
            <>
              <textarea value={said} placeholder={tr('不看答案，讲给我听')} onChange={x => setSaid(x.target.value)} />
              <button disabled={!said.trim()} onClick={() => void answerQuiz(quiz[0].id)}>{tr('讲完了')}</button>
            </>
          )}
        </div>
      )}
      <TrialCard onEnd={() => { setEndNow(true); void refresh(exam, true); }} onCopy={copy} />
      <div className="card">
        <h2>{tr('今天要还的')}</h2>
        {note && <p role="status">{note}</p>}
        {due.length === 0 && <p>{tr('今天没有要还的。')}</p>}
        {due.map(e => (
          <div key={e.id}>
            <button className="ghost" onClick={() => void pick(e.id)}>{e.question}{e.fromComputer ? tr('（电脑上记的）') : ''}</button>
            {open === e.id && (
              <>
                <textarea value={said} placeholder={tr('不看答案，讲给我听')} onChange={x => { setSaid(x.target.value); void book.saveDraft(e.id, x.target.value); }} />
                <button disabled={!said.trim()} onClick={() => void repay(e.id)}>{tr('讲完了')}</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>{tr('记一笔')}</h2>
        <div role="group">{BOARDS.map(b => (
          <button key={b} className={draft.board === b ? '' : 'ghost'} onClick={() => setDraft({ ...draft, board: b })}>{tr(b)}</button>
        ))}</div>
        <textarea value={draft.ownIdea} placeholder={tr('先写下你自己的想法（写了债会轻一档）')} onChange={x => setDraft({ ...draft, ownIdea: x.target.value })} />
        <textarea value={draft.question} placeholder={tr('问了 AI 什么')} onChange={x => setDraft({ ...draft, question: x.target.value })} />
        <textarea value={draft.answer} placeholder={tr('AI 的回答（可选，还账时对照）')} onChange={x => setDraft({ ...draft, answer: x.target.value })} />
        <div role="group">{LEVELS.map(l => (
          <button key={l.id} className={draft.level === l.id ? '' : 'ghost'} onClick={() => setDraft({ ...draft, level: l.id })}>{l.label}</button>
        ))}</div>
        <button disabled={!draft.question.trim()} onClick={() => void add()}>{tr('记下')}</button>
      </div>
    </section>
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
