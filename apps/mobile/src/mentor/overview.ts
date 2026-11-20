// The advisor's page: one row per student. Built as a standalone HTML file the student shares through any chat app,
// so the advisor needs no install. Only tasks and to-dos go in; nothing about time online or location exists to leak.
import type { Meeting, Task } from './types';

export interface StudentRow { student: string; current: string; overdue: number; doneSteps: number; totalSteps: number }

export function rows(tasks: Task[], now: number): StudentRow[] {
  const by = new Map<string, Task[]>();
  for (const t of tasks.filter(t => t.confirmed)) by.set(t.student, [...(by.get(t.student) ?? []), t]);
  return [...by].map(([student, ts]) => {
    const open = ts.filter(t => t.steps.some(s => !s.done)).sort((a, b) => a.due - b.due);
    const next = open[0]?.steps.find(s => !s.done);
    return {
      student,
      current: next ? `${open[0].title}：${next.title}` : '没有进行中的任务',
      overdue: open.filter(t => t.due < now).length,
      doneSteps: ts.reduce((a, t) => a + t.steps.filter(s => s.done).length, 0),
      totalSteps: ts.reduce((a, t) => a + t.steps.length, 0),
    };
  });
}

/** What the advisor promised and has not done yet, newest meeting first. */
export function advisorOwes(meetings: Meeting[]): { what: string; due?: number }[] {
  return [...meetings].sort((a, b) => b.at - a.at).flatMap(m => m.todos.filter(t => t.who === '导师' && !t.done).map(t => ({ what: t.what, due: t.due })));
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const day = (t: number) => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });

export function overviewHtml(tasks: Task[], meetings: Meeting[], now: number): string {
  const body = rows(tasks, now).map(r => `<tr><td>${esc(r.student)}</td><td>${esc(r.current)}</td><td>${r.doneSteps}/${r.totalSteps}</td><td class="${r.overdue ? 'late' : ''}">${r.overdue || '无'}</td></tr>`).join('');
  const owes = advisorOwes(meetings).map(o => `<li>${esc(o.what)}${o.due ? `（${day(o.due)}前）` : ''}</li>`).join('') || '<li>没有</li>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本周进度总览</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;padding:16px;color:#1d2433;background:#f6f7fb}h1{font-size:1.3rem}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
td,th{padding:10px;border-bottom:1px solid #e6e8ef;text-align:left;vertical-align:top}.late{color:#c0392b;font-weight:700}section{background:#fff;border-radius:12px;padding:4px 16px;margin-top:16px}small{color:#6b7280}</style></head>
<body><h1>本周进度总览</h1><small>生成于 ${esc(new Date(now).toLocaleString('zh-CN'))}，由学生在手机上导出，只读。</small>
<table><thead><tr><th>学生</th><th>正在做</th><th>步骤</th><th>超期任务</th></tr></thead><tbody>${body || '<tr><td colspan="4">还没有确认过的任务</td></tr>'}</tbody></table>
<section><h2>您答应过、还没做的</h2><ul>${owes}</ul></section></body></html>`;
}
