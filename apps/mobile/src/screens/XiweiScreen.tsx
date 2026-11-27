// 析微 (项目简介 main line): bring a problem in, shared or pasted, with the AI's answer if there is one → 关键条件卡 →
// the same problem with one condition changed, answered without the AI → which condition was missed → 变式债 in the
// ledger, retested on the FSRS schedule until 过手. The engine runs on the phone (xiwei/xiwei.ts); nothing leaves it.
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { book, today } from '../ledger/book';
import type { Entry } from '../ledger/ledger';
import { preferencesKV } from '../storage/kv';
import { engine, hash, loadMastery, problemKey, saveMastery, warm, type Graded, type Next, type Problem, type Segment, type Variant } from '../xiwei/xiwei';

/** Typed, without the options, in this many seconds counts as fluent (团队设定). */
const FAST_SECONDS = 90;
const P0 = 0.3; // the engine's starting mastery (packages/xiwei/xiwei/bkt.py)

/** One problem worked on: the original, the debt it repays if any, and the variants already asked. */
interface Round { problem: Problem; question: string; claim: string | null; owed?: Entry; exclude: string[] }
type Stage =
  | { at: 'home' }
  | { at: 'card'; round: Round; next: Next }
  | { at: 'variant'; round: Round; v: Variant; since: number; choose: boolean }
  | { at: 'result'; round: Round; v: Variant; g: Graded; debt: Entry | null };

const text = (s: Segment[]) => s.map(([t]) => t).join('');

function Question({ segments, mark }: { segments: Segment[]; mark?: string }) {
  return (
    <p className="xiwei-q">
      {segments.map(([t, ids], i) => <span key={i} className={mark && ids?.split(' ').includes(mark) ? 'mark' : ids ? 'cond' : undefined}>{t}</span>)}
    </p>
  );
}

export function XiweiScreen({ shared, onLedger }: { shared: { text: string; at: number } | null; onLedger: (text: string) => void }) {
  const [stage, setStage] = useState<Stage>({ at: 'home' });
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [owed, setOwed] = useState<Entry[]>([]);
  const home = () => { setStage({ at: 'home' }); void book.due(today()).then(es => setOwed(es.filter(e => e.kind === 'variant'))); };
  useEffect(() => { warm(); home(); }, []);
  useEffect(() => { if (shared) { setDraft(shared.text); setNote(''); setStage({ at: 'home' }); } }, [shared]);

  async function run<T>(f: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setNote('');
    try { return await f(); } catch (e) { setNote(tr('出错了：{0}', (e as Error).message)); } finally { setBusy(false); }
  }

  const ask = (round: Round) => run(async () => {
    const next = await engine('generate', { problem: round.problem, mastery: await loadMastery(preferencesKV), exclude: round.exclude,
      asked: round.exclude.length, ...(round.exclude.length ? {} : { claim: round.claim }) });
    if (!next.ok) { setNote(next.error); return; }
    if (!next.variant) { setNote(next.error ?? tr('这道题看得差不多了，换一道吧。')); if (round.exclude.length) home(); return; }
    setAnswer('');
    setStage({ at: 'variant', round, v: next.variant, since: Date.now(), choose: false });
  });

  const read = () => run(async () => {
    const r = await engine('read', { text: draft });
    if (!r.ok) { setNote(r.error); return; }
    const next = await engine('generate', { problem: r.problem, mastery: await loadMastery(preferencesKV), methods: r.methods, claim: r.claim });
    if (!next.ok) { setNote(next.error); return; }
    setStage({ at: 'card', round: { problem: r.problem, question: text(r.segments), claim: r.claim, exclude: [] }, next });
  });

  const retest = (e: Entry) => e.problem && void ask({ problem: e.problem, question: e.question, claim: null, owed: e, exclude: [] });

  const submit = (s: Extract<Stage, { at: 'variant' }>, said: string) => run(async () => {
    const { round, v } = s, took = Date.now() - s.since;
    const before = await loadMastery(preferencesKV);
    const g = await engine('grade', { original: round.problem, variant: v.problem, answer: said, mastery: before, choices: s.choose ? v.options.length : 0 });
    if (!g.ok) { setNote(g.error); return; }
    if (g.verdict === 'unparsed') { setNote(tr('没读懂这个答案，换个写法再交，比如 1/2、-∞、不存在。')); return; }
    await saveMastery(preferencesKV, g.mastery);
    const kc = round.owed?.topic ?? v.kc;
    const debt = await book.retest({ key: problemKey(round.problem), kc, question: round.question,
      problem: round.problem, ok: g.correct, fast: !s.choose && took <= FAST_SECONDS * 1000,
      mastery: g.mastery[kc] ?? before[kc] ?? P0 }, today());
    setStage({ at: 'result', round: { ...round, exclude: [...round.exclude, v.key] }, v, g, debt });
  });

  return (
    <section className="xiwei">
      <h1>{tr('析微')}</h1>
      {note && <div className="card" role="status">{note}</div>}

      {stage.at === 'home' && (
        <>
          <div className="card">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} data-testid="xiwei-input"
              placeholder={tr('把题目贴进来，或从别的 App 分享过来，可以连 AI 的解答一起贴。现在会读极限、定积分、区间最值和线性方程组。')} />
            <button className="primary" disabled={busy || !draft.trim()} onClick={() => void read()}>{busy ? tr('引擎在算…（第一次打开要多等几秒）') : tr('读题')}</button>
          </div>
          {owed.map(e => (
            <div key={e.id} className={`card${e.red ? ' red-mark' : ''}`} data-testid="xiwei-owed">
              <b>{e.question}</b> <span className="pill">{tr(e.topic)}</span>
              <div className="row"><button className="ghost" disabled={busy} onClick={() => retest(e)}>{tr('复测一道变式')}</button></div>
            </div>
          ))}
        </>
      )}

      {stage.at === 'card' && (() => {
        const { round, next: n } = stage;
        return (
          <div className="card" data-testid="xiwei-card">
            <h2>{tr('关键条件卡')}</h2>
            <Question segments={n.original.segments} />
            <ul className="conds">
              {n.original.premises.map(c => <li key={c.id}><span className="muted">{tr(c.label)}</span> {c.text}{c.key && <span className="pill bad">{tr('关键')}</span>}</li>)}
            </ul>
            {n.aiDisagrees !== undefined && (n.aiDisagrees
              ? <p className="verdict bad">{tr('AI 给的答案是 {0}，算出来是 {1}，对不上，先别信这份解答。', round.claim, n.original.answer.text)}</p>
              : <p className="muted">{tr('AI 给的答案 {0} 和算出来的一致。', n.original.answer.text)}</p>)}
            {n.variant
              ? <p className="muted">{tr('标「关键」的条件一改，答案就跟着变。下面改掉一处，不看 AI 自己做。')}</p>
              : <p className="muted">{n.error}</p>}
            <div className="row">
              {n.variant && <button className="primary" disabled={busy} onClick={() => { setAnswer(''); setStage({ at: 'variant', round, v: n.variant!, since: Date.now(), choose: false }); }}>{tr('做变式')}</button>}
              <button className="ghost" onClick={() => onLedger(draft)}>{tr('只记一笔')}</button>
            </div>
          </div>
        );
      })()}

      {stage.at === 'variant' && (
        <div className="card" data-testid="xiwei-variant">
          <h2>{tr('改了一处条件（红框），不看 AI，直接写答案')}</h2>
          <Question segments={stage.v.segments} mark={stage.v.changed} />
          {stage.choose
            ? <div className="row">{[...stage.v.options].sort((a, b) => hash(a.text + stage.v.key).localeCompare(hash(b.text + stage.v.key)))
                .map(o => <button key={o.text} className="chip" disabled={busy} onClick={() => void submit(stage, o.text)}>{o.text}</button>)}</div>
            : <>
                <input value={answer} onChange={e => setAnswer(e.target.value)} placeholder={tr('答案，比如 1/2、-∞、不存在')} data-testid="xiwei-answer" />
                <div className="row">
                  <button className="primary" disabled={busy || !answer.trim()} onClick={() => void submit(stage, answer)}>{busy ? tr('处理中…') : tr('交答案')}</button>
                  <button className="ghost" disabled={busy} onClick={() => setStage({ ...stage, choose: true })}>{tr('给我选项')}</button>
                </div>
              </>}
        </div>
      )}

      {stage.at === 'result' && (() => {
        const { g, v, debt, round } = stage;
        const head = g.correct ? tr('对了，改的那处条件看到了。') : g.verdict === 'missed' ? tr('漏看了一处条件。')
          : g.verdict === 'review' ? tr('可能漏看了下面几处，光看这个答案分不出是哪一处。')
          : g.verdict === 'error' ? tr('条件看到了，错在常见的算法上。') : tr('条件看到了，错在计算或别处。');
        return (
          <div className={`card${g.correct ? '' : ' red-mark'}`} data-testid="xiwei-result">
            <h2>{head}</h2>
            <p className="muted">{v.explain}</p>
            {!g.correct && <ul>{[...g.missed, ...g.errors].map(m => <li key={m}>{m}</li>)}</ul>}
            <p>{tr('正确答案：{0}', g.truth.text)}</p>
            <p className="muted">{Object.entries(g.mastery).map(([kc, p]) => tr('{0} 掌握度约 {1}%', tr(kc), Math.round(p * 100))).join('，')}</p>
            {debt && <p>{debt.dueOn ? tr('记进账本了，{0} 再复测一道。', debt.dueOn) : tr('过手了：两天都不靠 AI 做对，这笔销账。')}</p>}
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void ask(round)}>{tr('再来一道')}</button>
              <button className="ghost" onClick={home}>{tr('换一道题')}</button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
