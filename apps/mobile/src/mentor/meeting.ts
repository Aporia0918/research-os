// Offline stand-in for the meeting model (plan §6.2): pulls to-dos, who owns them and their dates out of meeting
// notes, and compares the advisor's requirements with earlier ones. The trained model replaces these rules; until
// then the screen says which one produced the result.
import { newId } from '../local/store';
import type { Change, ChangeKind, Requirement, Role, Todo } from './types';

const DAY = 86_400_000;
const WEEKDAY: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

export interface Line { speaker: Role; text: string }

/** "老师：…" / "导师:…" lines are the advisor's; any other "名字：…" line is a student's. Unlabelled lines keep the last speaker. */
export function splitLines(notes: string): Line[] {
  let speaker: Role = '导师';
  const out: Line[] = [];
  for (const raw of notes.split(/\n+/)) {
    const m = /^\s*([^：:]{1,8})[：:]\s*(.*)$/.exec(raw);
    if (m) { speaker = /老师|导师|教授/.test(m[1]) ? '导师' : '学生'; }
    const body = (m ? m[2] : raw).trim();
    for (const s of body.split(/(?<=[。！？!?；;])/)) if (s.trim()) out.push({ speaker, text: s.trim() });
  }
  return out;
}

/** End of the day a Chinese date phrase points to, relative to the meeting; undefined if none. */
export function parseDue(text: string, meetingAt: number): number | undefined {
  const base = new Date(meetingAt); base.setHours(23, 59, 0, 0);
  const t = base.getTime();
  if (/今天|今晚/.test(text)) return t;
  if (/明天/.test(text)) return t + DAY;
  if (/后天/.test(text)) return t + 2 * DAY;
  const md = /(\d{1,2})月(\d{1,2})[日号]/.exec(text);
  if (md) { const d = new Date(base); d.setMonth(Number(md[1]) - 1, Number(md[2])); if (d.getTime() < t) d.setFullYear(d.getFullYear() + 1); return d.getTime(); }
  const wk = /(下+)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text);
  if (wk) {
    const target = WEEKDAY[wk[2]], today = base.getDay();
    if (!wk[1]) return t + ((target - today + 7) % 7) * DAY; // this coming one
    const toNextMonday = (8 - today) % 7 || 7; // weeks start on Monday
    return t + (toNextMonday + (target + 6) % 7 + 7 * (wk[1].length - 1)) * DAY;
  }
  if (/下周|下次组会/.test(text)) return t + 7 * DAY;
  return undefined;
}

const COMMIT = /下周|周[一二三四五六日天]|星期|明天|后天|今晚|之前|以前|前把|月\d|记得|负责|我来|我会|我给|我发|我帮|给你|发你|你先|你把|你去|你再|你要|麻烦|准备|整理|做一下|看一下|改一下|补/;

/** Whose job a sentence is, from who said it and whether it says 我 or 你. */
export function ownerOf(l: Line): Role {
  const self = /^(我|那我|好，我|好的，我|行，我)|我(来|会|给|发|帮|看|去|把)/.test(l.text);
  const you = /你|您/.test(l.text);
  if (l.speaker === '导师') return self && !/你(把|先|去|要|再)/.test(l.text) ? '导师' : '学生';
  return you && !self ? '导师' : '学生';
}

export function ruleTodos(notes: string, meetingId: string, at: number): Todo[] {
  return splitLines(notes)
    .filter(l => COMMIT.test(l.text) && !/[？?]$/.test(l.text))
    .map(l => ({ id: newId(), who: ownerOf(l), what: l.text.replace(/[。；;]$/, ''), due: parseDue(l.text, at), meetingId, done: false }));
}

const REQUIRE = /要|用|只看|不要|别|改成|改用|换成|以.+为准|必须|重点|先做|不用/;
export function ruleRequirements(notes: string, meetingId: string, at: number): Requirement[] {
  return splitLines(notes).filter(l => l.speaker === '导师' && REQUIRE.test(l.text) && !/[？?]$/.test(l.text))
    .map(l => ({ id: newId(), text: l.text.replace(/[。；;]$/, ''), meetingId, at }));
}

/** Han-character bigrams, the cheap topic signal the rules compare. */
function grams(s: string): Set<string> {
  const h = s.replace(/[^㐀-鿿A-Za-z0-9]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < h.length - 1; i++) out.add(h.slice(i, i + 2));
  return out;
}
const STOP = new Set(['这个', '那个', '一下', '我们', '你们', '下周', '然后', '就是', '可以', '要用', '不要', '只看']);
function overlap(a: string, b: string): number {
  const A = [...grams(a)].filter(g => !STOP.has(g)); const B = grams(b);
  const hit = A.filter(g => B.has(g)).length;
  return A.length ? hit / Math.min(A.length, Math.max(1, B.size)) : 0;
}
function jaccard(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  const hit = [...A].filter(g => B.has(g)).length;
  return A.size + B.size ? hit / (A.size + B.size - hit) : 1;
}
const NEG = /不要|不用|别|不能|不必|取消/;

/** Rule version of the four-way requirement change: topic by bigram overlap, sameness by Jaccard; same topic +
 *  opposite polarity = 矛盾, same topic + different content = 改变. */
export function ruleClassify(now: string, before: string): ChangeKind {
  const o = overlap(now, before);
  if (o < 0.25) return '新增';
  if (NEG.test(now) !== NEG.test(before)) return '矛盾';
  if (jaccard(now, before) > 0.75) return '一致';
  return '改变';
}

/** Compares each new requirement with the closest earlier one. */
export function compareRequirements(fresh: Requirement[], history: Requirement[], classify = ruleClassify): Change[] {
  return fresh.map(now => {
    const before = [...history].sort((a, b) => overlap(now.text, b.text) - overlap(now.text, a.text) || b.at - a.at)[0];
    const kind = before ? classify(now.text, before.text) : '新增';
    return { kind, now, before: kind === '新增' ? undefined : before, settled: kind === '一致' || kind === '新增' };
  });
}
