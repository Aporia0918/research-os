import type { Entry } from './ledger';

/**
 * 导出成卡片: the user's debts as Anki-ready text or a spreadsheet, so what they learned is theirs in any tool.
 * Dropped debts and life entries stay out; the user's own idea travels with the AI answer.
 */
export function cardsOf(es: Entry[], board?: Entry['board']): Entry[] {
  return es.filter(e => !e.dropped && e.board !== '生活' && (!board || e.board === board) && e.question.trim());
}

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>').replace(/\t/g, ' ');
const tag = (s: string) => s.trim().replace(/\s+/g, '_');

/** Anki "Import File" text: tab separated, HTML on, front / back / tags. */
export function toAnki(es: Entry[], labels: { idea: string }): string {
  const rows = es.map(e => {
    const back = html(e.answer) + (e.ownIdea.trim() ? `<br><br><i>${html(labels.idea)}</i> ${html(e.ownIdea)}` : '');
    const tags = ['思维账本', e.board, e.topic && tag(e.topic), e.red && '讲不出来'].filter(Boolean).join(' ');
    return [html(e.question), back, tags].join('\t');
  });
  return ['#separator:tab', '#html:true', '#tags column:3', ...rows].join('\n') + '\n';
}

const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A spreadsheet (CSV with a BOM so Excel and WPS read Chinese correctly). */
export function toCsv(es: Entry[], head: string[]): string {
  const rows = es.map(e => [e.board, e.topic, e.question, e.ownIdea, e.answer, e.ai ?? '', e.createdOn, e.dueOn ?? '', e.red ? '1' : ''].map(cell).join(','));
  return '﻿' + [head.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
}
