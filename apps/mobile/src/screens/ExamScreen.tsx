// 零世界考试: confirm the columns, approve the run, read the verdict, retake. The exam itself runs on the computer.
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { ApiError, ResearchOsClient, describeError } from '../api/computer';
import { newId } from '../local/store';
import { loadComputerSettings } from '../settings';
import { preferencesKV } from '../storage/kv';
import {
  EXAM_KIND, RUN_CHOICES, describeVerdict, examPayload, fmtScore, phase, retake, runsDone, strip,
  type Detected, type ExamInput, type ExamReport, type Task,
} from '../logic/nullworld';

const PATHS_KEY = 'exam.paths.v1';
const POLL_MS = 1500;

export function ExamScreen() {
  const [client, setClient] = useState<ResearchOsClient | null | undefined>(undefined);
  const [script, setScript] = useState('');
  const [data, setData] = useState('');
  const [found, setFound] = useState<Detected | null>(null);
  const [input, setInput] = useState<ExamInput | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  async function act(f: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await f(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  const detect = () => act(async () => {
    const d = await client!.detectColumns(data.trim());
    await preferencesKV.set(PATHS_KEY, JSON.stringify({ script: script.trim(), data: data.trim() }));
    setFound(d); setTask(null);
    setInput({ script: script.trim(), data: d.data, group: d.groups[0]?.column ?? '', label: d.labels[0]?.column ?? '', runs: RUN_CHOICES[0], seed: 0 });
  });
  const start = (i: ExamInput) => act(async () => { setInput(i); setTask(await client!.createTask(EXAM_KIND, examPayload(i), newId())); });
  const approve = () => act(async () => { await client!.approveTask(task!.id); setTask(await client!.task(task!.id)); });
  const cancel = () => act(async () => { setTask(await client!.cancelTask(task!.id)); });

  if (client === undefined) return <section className="exam"><h1>{tr('零世界考试')}</h1></section>;
  if (client === null) return (
    <section className="exam"><h1>{tr('零世界考试')}</h1>
      <div className="card glass"><b>{tr('需要连接电脑')}</b>
        <div className="muted">{tr('考试会在电脑上把你的脚本运行几十次，手机负责确认、批准和看结果。请先在「设置」里开启“连接电脑”。')}</div></div>
    </section>
  );
  const p = task ? phase(task) : null;
  return (
    <section className="exam">
      <h1>{tr('零世界考试')}</h1>
      <p className="muted">{tr('把标签打乱、但保留分组结构，造出“没有规律的世界”。如果脚本在这些世界里也能考高分，高分就不可信。')}</p>
      {!task && <div className="card glass">
        <label htmlFor="exam-script">{tr('脚本（电脑上的路径）')}</label>
        <input id="exam-script" value={script} onChange={e => setScript(e.target.value)} autoCapitalize="off" placeholder="/…/train.py" />
        <label htmlFor="exam-data">{tr('数据表（CSV 或 TSV）')}</label>
        <input id="exam-data" value={data} onChange={e => setData(e.target.value)} autoCapitalize="off" placeholder="/…/features.csv" />
        <button className="ghost" disabled={busy || !script.trim() || !data.trim()} onClick={detect}>{tr('认结构')}</button>
      </div>}
      {found && input && !task && <Columns found={found} input={input} onInput={setInput} onStart={() => start(input)} busy={busy} />}
      {task && p === 'approve' && <div className="card glass" data-testid="exam-approve">
        <b>{tr('批准电脑运行这次考试？')}</b>
        <div>{tr('电脑会运行你的脚本 {0} 次：真数据 1 次，零世界 {1} 次。', (input?.runs ?? 0) + 1, input?.runs ?? 0)}</div>
        <div className="muted mono">{String(task.payload.script)}<br />{String(task.payload.data)}</div>
        <div className="muted">{tr('分组列：{0}　标签列：{1}', String(task.payload.group), String(task.payload.label))}</div>
        <div className="row"><button className="primary" disabled={busy} onClick={approve}>{tr('批准运行')}</button>
          <button className="ghost" disabled={busy} onClick={cancel}>{tr('取消')}</button></div>
      </div>}
      {task && p === 'running' && <div className="card glass" role="status">
        <b>{tr('正在考试')}</b>
        <progress max={(input?.runs ?? 0) + 1} value={runsDone(task)} />
        <div className="muted">{tr('已跑完 {0} / {1} 次', runsDone(task), (input?.runs ?? 0) + 1)}</div>
        <button className="ghost" disabled={busy || task.state === 'cancelling'} onClick={cancel}>{tr('停止')}</button>
      </div>}
      {task && p === 'done' && task.result && <Result report={task.result} />}
      {task && (p === 'failed' || p === 'cancelled') && <div className="card glass">
        <b>{p === 'cancelled' ? tr('考试已停止') : tr('考试没有完成')}</b>
        {p === 'failed' && <div className="muted">{describeError(new ApiError(422, task.error_code ?? 'http_error', ''))}</div>}
      </div>}
      {task && p !== 'running' && p !== 'approve' && input && <div className="row">
        <button className="primary" disabled={busy} onClick={() => start(retake(input))}>{tr('复考（换一批零世界）')}</button>
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

function Columns({ found, input, onInput, onStart, busy }: { found: Detected; input: ExamInput; onInput: (i: ExamInput) => void; onStart: () => void; busy: boolean }) {
  const others = (picked: string[]) => found.columns.filter(c => !picked.includes(c));
  const groups = [...found.groups.map(c => c.column), ...others(found.groups.map(c => c.column))];
  const labels = [...found.labels.map(c => c.column), ...others(found.labels.map(c => c.column))].filter(c => c !== input.group);
  return <div className="card glass" data-testid="exam-columns">
    <b>{tr('共 {0} 行。请确认这两列（已按可能性排好）：', found.rows)}</b>
    <label>{tr('分组列：同一个人（或同一批）的数据')}</label>
    <Chips label={tr('分组列')} options={groups} value={input.group} onPick={group => onInput({ ...input, group, label: input.label === group ? '' : input.label })} />
    <label>{tr('标签列：脚本要预测的答案')}</label>
    <Chips label={tr('标签列')} options={labels} value={input.label} onPick={label => onInput({ ...input, label })} />
    <label>{tr('零世界数量')}</label>
    <Chips label={tr('零世界数量')} options={RUN_CHOICES.map(String)} value={String(input.runs)} onPick={r => onInput({ ...input, runs: Number(r) })} />
    <div className="muted">{tr('只打乱标签列，其他列一个数都不改。脚本要在最后打印一行分数，例如 accuracy: 0.81。')}</div>
    <button className="primary" disabled={busy || !input.group || !input.label} onClick={onStart}>{tr('开始考试')}</button>
  </div>;
}

function Result({ report }: { report: ExamReport }) {
  const v = describeVerdict(report.verdict);
  const s = strip(report);
  return <>
    <div className={`card glass verdict-hero ${v.tone}`} data-testid="exam-verdict"><b>{v.title}</b><div>{v.body}</div></div>
    <div className="card glass">
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
