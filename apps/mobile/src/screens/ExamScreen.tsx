// 零世界考试: confirm the columns, approve the run, read the verdict, retake. The exam itself runs on the computer.
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { ApiError, ResearchOsClient, describeError } from '../api/computer';
import { newId } from '../local/store';
import { auditHeadline, describeFinding, type AuditReport } from '../logic/audit';
import { loadComputerSettings } from '../settings';
import { preferencesKV } from '../storage/kv';
import {
  EXAM_KIND, POWER_KIND, RUN_CHOICES, analysisKey, debtLine, describePower, describeVerdict, examPayload, fmtScore, phase,
  plannedRuns, powerPayload, retake, runsDone, strip, vouch,
  type Detected, type ExamInput, type ExamReport, type PowerReport, type Task,
} from '../logic/nullworld';
import { book, today } from '../ledger/book';

const PATHS_KEY = 'exam.paths.v1';
const POLL_MS = 1500;
const fileName = (path: string): string => path.trim().split(/[\\/]/).pop() || path.trim();

export function ExamScreen() {
  const [client, setClient] = useState<ResearchOsClient | null | undefined>(undefined);
  const [script, setScript] = useState('');
  const [data, setData] = useState('');
  const [found, setFound] = useState<Detected | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [input, setInput] = useState<ExamInput | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiWritten, setAiWritten] = useState(true); // the script came from AI: its result is a 结论债 until it passes
  const booked = useRef(new Set<string>()); // tasks already entered in the ledger, so a re-render never books twice

  useEffect(() => {
    void loadComputerSettings(preferencesKV).then(s => setClient(s.enabled ? new ResearchOsClient(s.url, undefined, 5000) : null));
    void preferencesKV.get(PATHS_KEY).then(v => { if (v) { const p = JSON.parse(v) as { script: string; data: string }; setScript(p.script); setData(p.data); } });
  }, []);

  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => { // poll while the computer works; stop once the task waits for the owner or is over
    if (!client || !task || phase(task) !== 'running') return;
    const t = setTimeout(() => void client.task(task.id).then(
      n => { if (live.current) { setError(''); setTask(n); } },
      e => { if (live.current) { setError(describeError(e)); setTask({ ...task }); } }, // a blip: show it, poll again
    ), POLL_MS);
    return () => clearTimeout(t);
  }, [client, task]);

  useEffect(() => { // a finished exam of an AI-written analysis books or settles its 结论债
    if (!task || task.kind !== EXAM_KIND || !input || !aiWritten || !task.result || phase(task) !== 'done' || booked.current.has(task.id)) return;
    booked.current.add(task.id);
    void book.checkup({ key: analysisKey(input), outcome: (task.result as ExamReport).verdict.outcome,
      question: tr('{0} 在 {1} 上跑出的结论', fileName(input.script), fileName(input.data)) }, today())
      .catch(e => { if (live.current) setError(describeError(e)); });
  }, [task, input, aiWritten]);

  async function act(f: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await f(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  const detect = () => act(async () => {
    const [d, a] = await Promise.all([ // the rule check is a bonus: an older computer without it still runs the exam
      client!.detectColumns(data.trim()),
      client!.auditScript(script.trim(), []).then(r => (Array.isArray(r?.findings) ? r : null), () => null),
    ]);
    setAudit(a);
    await preferencesKV.set(PATHS_KEY, JSON.stringify({ script: script.trim(), data: data.trim() }));
    setFound(d); setTask(null);
    setInput({ script: script.trim(), data: d.data, group: d.groups[0]?.column ?? '', label: d.labels[0]?.column ?? '', runs: RUN_CHOICES[0], seed: 0 });
  });
  const start = (i: ExamInput, power = false) => act(async () => {
    setInput(i);
    setTask(await client!.createTask(power ? POWER_KIND : EXAM_KIND, power ? powerPayload(i) : examPayload(i), newId()));
  });
  const approve = () => act(async () => { await client!.approveTask(task!.id); setTask(await client!.task(task!.id)); });
  const cancel = () => act(async () => { setTask(await client!.cancelTask(task!.id)); });

  if (client === undefined) return <section className="exam"><h1>{tr('零世界考试')}</h1></section>;
  if (client === null) return (
    <section className="exam"><h1>{tr('零世界考试')}</h1>
      <div className="card"><b>{tr('需要连接电脑')}</b>
        <div className="muted">{tr('考试会在电脑上把你的脚本运行几十次，手机负责确认、批准和看结果。请先在「设置」里开启“连接电脑”。')}</div></div>
    </section>
  );
  const p = task ? phase(task) : null;
  const power = task?.kind === POWER_KIND;
  const total = task ? plannedRuns(task) : 0;
  return (
    <section className="exam">
      <h1>{tr('零世界考试')}</h1>
      <p className="muted">{tr('把标签打乱、但保留分组结构，造出“没有规律的世界”。如果脚本在这些世界里也能考高分，高分就不可信。')}</p>
      {!task && <div className="card">
        <label htmlFor="exam-script">{tr('脚本（电脑上的路径）')}</label>
        <input id="exam-script" value={script} onChange={e => setScript(e.target.value)} autoCapitalize="off" placeholder="/…/train.py" />
        <label htmlFor="exam-data">{tr('数据表（CSV 或 TSV）')}</label>
        <input id="exam-data" value={data} onChange={e => setData(e.target.value)} autoCapitalize="off" placeholder="/…/features.csv" />
        <button className="ghost" disabled={busy || !script.trim() || !data.trim()} onClick={detect}>{tr('认结构')}</button>
      </div>}
      {audit && found && !task && <Audit report={audit} />}
      {found && input && !task && <Columns found={found} input={input} onInput={setInput} onStart={() => start(input)}
        onPower={() => start(input, true)} busy={busy} aiWritten={aiWritten} onAiWritten={setAiWritten} />}
      {task && p === 'approve' && <div className="card" data-testid="exam-approve">
        <b>{power ? tr('批准电脑测检出率？') : tr('批准电脑运行这次考试？')}</b>
        <div>{power
          ? tr('电脑会运行你的脚本 {0} 次：在零世界里植入大小不同的效应，看脚本能检出几次。不用真实标签。', total)
          : tr('电脑会运行你的脚本 {0} 次：真数据 1 次，零世界 {1} 次。', total, total - 1)}</div>
        <div className="muted mono">{String(task.payload.script)}<br />{String(task.payload.data)}</div>
        <div className="muted">{tr('分组列：{0}　标签列：{1}', String(task.payload.group), String(task.payload.label))}</div>
        {Array.isArray(task.payload.allow) && <div data-testid="exam-allow">{tr('你确认是真实测量、不查抄标签的列：{0}', task.payload.allow.join('、'))}</div>}
        <div className="row"><button className="primary" disabled={busy} onClick={approve}>{tr('批准运行')}</button>
          <button className="ghost" disabled={busy} onClick={cancel}>{tr('取消')}</button></div>
      </div>}
      {task && p === 'running' && <div className="card" role="status">
        <b>{power ? tr('正在测检出率') : tr('正在考试')}</b>
        <progress max={total} value={runsDone(task)} />
        <div className="muted">{tr('已跑完 {0} / {1} 次', runsDone(task), total)}</div>
        <button className="ghost" disabled={busy || task.state === 'cancelling'} onClick={cancel}>{tr('停止')}</button>
      </div>}
      {task && p === 'done' && task.result && (power
        ? <Power report={task.result as PowerReport} />
        : <Result report={task.result as ExamReport} debt={aiWritten} busy={busy} onVouch={input ? (c => start(vouch(input, c))) : undefined} />)}
      {task && (p === 'failed' || p === 'cancelled') && <div className="card">
        <b>{p === 'cancelled' ? tr('考试已停止') : tr('考试没有完成')}</b>
        {p === 'failed' && <div className="muted">{describeError(new ApiError(422, task.error_code ?? 'http_error', ''))}</div>}
      </div>}
      {task && p !== 'running' && p !== 'approve' && input && <div className="row">
        {power
          ? <button className="primary" disabled={busy} onClick={() => start(input)}>{tr('开始考试')}</button>
          : <button className="primary" disabled={busy} onClick={() => start(retake(input))}>{tr('复考（换一批零世界）')}</button>}
        <button className="ghost" disabled={busy} onClick={() => setTask(null)}>{tr('改设置')}</button>
      </div>}
      {error && <div className="card error" role="alert">{error}</div>}
    </section>
  );
}

function Chips({ label, options, value, onPick }: { label: string; options: string[]; value: string; onPick: (v: string) => void }) {
  return <div className="row" role="radiogroup" aria-label={label}>
    {options.map(o => <button key={o} type="button" role="radio" aria-checked={o === value} className="ghost small" onClick={() => onPick(o)}>{o}</button>)}
  </div>;
}

function Columns({ found, input, onInput, onStart, onPower, busy, aiWritten, onAiWritten }: {
  found: Detected; input: ExamInput; onInput: (i: ExamInput) => void; onStart: () => void; onPower: () => void; busy: boolean;
  aiWritten: boolean; onAiWritten: (v: boolean) => void;
}) {
  const others = (picked: string[]) => found.columns.filter(c => !picked.includes(c));
  const groups = [...found.groups.map(c => c.column), ...others(found.groups.map(c => c.column))];
  const labels = [...found.labels.map(c => c.column), ...others(found.labels.map(c => c.column))].filter(c => c !== input.group);
  return <div className="card" data-testid="exam-columns">
    <b>{tr('共 {0} 行。请确认这两列（已按可能性排好）：', found.rows)}</b>
    <label>{tr('分组列：同一个人（或同一批）的数据')}</label>
    <Chips label={tr('分组列')} options={groups} value={input.group} onPick={group => onInput({ ...input, group, label: input.label === group ? '' : input.label })} />
    <label>{tr('标签列：脚本要预测的答案')}</label>
    <Chips label={tr('标签列')} options={labels} value={input.label} onPick={label => onInput({ ...input, label })} />
    <label>{tr('零世界数量')}</label>
    <Chips label={tr('零世界数量')} options={RUN_CHOICES.map(String)} value={String(input.runs)} onPick={r => onInput({ ...input, runs: Number(r) })} />
    <div className="muted">{tr('只打乱标签列，其他列一个数都不改。脚本要在最后打印一行分数，例如 accuracy: 0.81。')}</div>
    <label className="row"><input type="checkbox" checked={aiWritten} onChange={e => onAiWritten(e.target.checked)} />
      {tr('这份分析有 AI 帮写（考完记进账本，考过才算还清）')}</label>
    <div className="row">
      <button className="primary" disabled={busy || !input.group || !input.label} onClick={onStart}>{tr('开始考试')}</button>
      <button className="ghost" disabled={busy || !input.group || !input.label} onClick={onPower}>{tr('先测检出率')}</button>
    </div>
    <div className="muted">{tr('检出率：在没有规律的世界里植入已知大小的效应，看现在的人数能不能把它找出来。')}</div>
  </div>;
}

function Result({ report, debt, busy, onVouch }: { report: ExamReport; debt: boolean; busy: boolean; onVouch?: (column: string) => void }) {
  const v = describeVerdict(report.verdict);
  const s = strip(report);
  const suspects = report.suspects ?? [];
  return <>
    <div className={`card verdict-hero ${v.tone}`} data-testid="exam-verdict"><b>{v.title}</b><div>{v.body}</div>
      {suspects.length > 0 && <ul data-testid="exam-suspects">{suspects.map(x => <li key={x.column}><b className="mono">{x.column}</b>{'　'}
        {x.reason === 'same_as_label' ? tr('和标签一一对应') : tr('单独就能把各类分开（间隔 {0} 个标准差）', x.gap_sd ?? '∞')}
        {onVouch && <button className="ghost" disabled={busy} onClick={() => onVouch(x.column)}>{tr('这列是真实测量，重考')}</button>}</li>)}</ul>}
      {debt && <div className={report.verdict.outcome === 'fail' ? 'red-mark' : 'muted'} data-testid="exam-debt">{debtLine(report.verdict.outcome)}</div>}
    </div>
    <div className="card">
      <div className="strip" role="img" aria-label={tr('零世界分数分布，真分数用竖线标出')}>
        <span className="strip-chance" style={{ left: `${s.chance}%` }} />
        {s.nulls.map((x, i) => <span key={i} className="strip-dot" style={{ left: `${x}%` }} />)}
        {s.real !== null && <span className={`strip-real ${v.tone}`} style={{ left: `${s.real}%` }} />}
      </div>
      <div className="row strip-axis muted"><span>{fmtScore(s.min)}</span><span>{fmtScore(s.max)}</span></div>
      <div className="facts">
        <span>{tr('真分数')}</span><b>{fmtScore(report.real)}</b>
        <span>{tr('零世界平均')}</span><b>{fmtScore(report.verdict.null_mean)}</b>
        <span>{tr('机会水平')}</span><b>{fmtScore(report.verdict.chance)}</b>
        <span>{tr('p 值')}</span><b>{fmtScore(report.verdict.p)}</b>
      </div>
      <div className="muted">{report.layout.mode === 'between'
        ? tr('每组只有一个标签：在 {0} 个组之间整组交换标签。', report.layout.groups)
        : tr('组内有不同标签：在每个组内部打乱标签（{0} 个组只有一种标签，无法打乱）。', report.layout.fixed_groups)}</div>
      {report.errors.map((e, i) => <pre key={i} className="answer">{e}</pre>)}
      <div className="muted mono">{tr('种子 {0} · 数据 {1} · 脚本 {2}', report.seed, report.data_sha256.slice(0, 12), report.script_sha256.slice(0, 12))}</div>
    </div>
  </>;
}

function Power({ report }: { report: PowerReport }) {
  const v = describePower(report);
  return <div className={`card verdict-hero ${v.tone}`} data-testid="exam-power">
    <b>{v.title}</b>
    <div className="facts">
      {report.rows.map(r => <PowerLine key={`${r.groups}:${r.effect}`} r={r} />)}
    </div>
    <div className="muted">{tr('效应用标准差计：0.2 小，0.5 中，0.8 大。括号里是 95% 区间。植入的特征：{0}', report.features.join(', '))}</div>
    {report.errors.map((e, i) => <pre key={i} className="answer">{e}</pre>)}
  </div>;
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
function PowerLine({ r }: { r: PowerReport['rows'][number] }) {
  return <>
    <span>{tr('{0} 组 · 效应 {1}', r.groups, r.effect)}</span>
    <b>{`${r.detected}/${r.runs}`} <span className="muted">({pct(r.low)}–{pct(r.high)})</span></b>
  </>;
}

function Audit({ report }: { report: AuditReport }) {
  const h = auditHeadline(report);
  return <div className={`card verdict-hero ${h.tone}`} data-testid="exam-audit">
    <b>{h.title}</b>
    {report.error && <div className="muted mono">{report.error.message}</div>}
    {report.findings.map((f, i) => {
      const d = describeFinding(f);
      return <div key={i} className="plan-item">
        <span><span className="entry-kind">{tr('第 {0} 行', f.line)}</span> {d.what}</span>
        {d.fix && <span className="muted">{d.fix}</span>}
      </div>;
    })}
    <div className="muted">{tr('只读脚本、不运行。规则查的是常见写法，查不出不等于没有泄漏，零世界考试会再验一次。')}</div>
  </div>;
}
