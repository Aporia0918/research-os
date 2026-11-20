// Every model call of 「组会之后」, through the user's own key (model/direct.ts). Each one has an offline fallback,
// and each result says which produced it, so the screen never passes a template off as the model's work.
import { chat, describeModelError, type FetchLike } from '../model/direct';
import { loadKey, loadModelSettings } from '../model/settings';
import { preferencesKV, type KV } from '../storage/kv';
import { newId } from '../local/store';
import { parseSteps, ruleBreakdown, selfCheck } from './breakdown';
import { compareRequirements, parseDue, ruleClassify, ruleRequirements, ruleTodos } from './meeting';
import { chooseQuestions, SLOTS, type Gap, type Slot } from './gaps';
import type { Standing } from './memory';
import { ruleFeedback, ruleProbes, type Probe } from './rehearse';
import type { Change, ChangeKind, Meeting, Requirement, Role, Step, Todo } from './types';

export interface Drafted<T> { value: T; source: 'model' | 'rules'; note: string }
interface Deps { kv?: KV; f?: FetchLike }

async function ask(system: string, user: string, { kv = preferencesKV, f }: Deps): Promise<string> {
  const [s, key] = await Promise.all([loadModelSettings(kv), loadKey(kv)]);
  return chat(s, key, [{ role: 'system', content: system }, { role: 'user', content: user }], f);
}

const BREAKDOWN_SYS = `你帮本科生导师把一句话任务拆成本科新生能直接开始的步骤。只输出 JSON 数组，每项 {"title":"做什么","output":"交什么","minutes":整数}。
要求：3 到 7 步；第一步 30 分钟以内能做完；每步写清交什么；不要编造导师没提的要求。`;

/** Model draft, checked by the rule gate and redrafted with the problems listed (at most three rounds); rules if no model. */
export async function draftBreakdown(task: string, freeMinutes: number | undefined, deps: Deps = {}): Promise<Drafted<Step[]> & { problems: string[] }> {
  let feedback = '';
  try {
    for (let round = 0; round < 3; round++) {
      const text = await ask(BREAKDOWN_SYS, `任务：${task}${freeMinutes ? `\n学生截止前大约有 ${Math.round(freeMinutes)} 分钟空闲。` : ''}${feedback}`, deps);
      const steps = parseSteps(text);
      if (!steps) { feedback = '\n上次的回复不是 JSON 数组，请只输出 JSON 数组。'; continue; }
      const check = selfCheck(steps, freeMinutes);
      if (check.ok) return { value: steps, source: 'model', note: round ? `模型拆解，自检改了 ${round} 次` : '模型拆解，自检通过', problems: [] };
      feedback = `\n上次的拆解没通过检查：${check.problems.join('；')}。请改正后重新输出。`;
      if (round === 2) return { value: steps, source: 'model', note: '模型拆解，自检仍有问题，请导师确认前修改', problems: check.problems };
    }
  } catch (e) {
    const steps = ruleBreakdown(task);
    return { value: steps, source: 'rules', note: `${describeModelError(e)}（已用离线模板拆解）`, problems: selfCheck(steps, freeMinutes).problems };
  }
  const steps = ruleBreakdown(task);
  return { value: steps, source: 'rules', note: '模型回复看不懂，已用离线模板拆解', problems: selfCheck(steps, freeMinutes).problems };
}

const MEETING_SYS = `你从本科生和导师的组会记录里找出待办和导师提的要求。只输出 JSON：
{"todos":[{"who":"导师"或"学生","what":"谁要做什么（原话简写）","when":"原文里的时间说法，没有就空字符串"}],"requirements":["导师提出的做法要求，原话"]}
导师答应学生的事也算待办，"who" 写"导师"。不要编造记录里没有的内容。`;

function parseMeeting(text: string, meetingId: string, at: number): { todos: Todo[]; requirements: Requirement[] } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { todos?: { who?: string; what?: string; when?: string }[]; requirements?: string[] };
    const todos = (o.todos ?? []).filter(t => t.what?.trim()).map(t => ({
      id: newId(), who: (t.who === '导师' ? '导师' : '学生') as Role, what: t.what!.trim(), due: t.when ? parseDue(t.when, at) : undefined, meetingId, done: false }));
    const requirements = (o.requirements ?? []).filter(r => typeof r === 'string' && r.trim()).map(r => ({ id: newId(), text: r.trim(), meetingId, at }));
    return { todos, requirements };
  } catch { return null; }
}

const CLASSIFY_SYS = `判断导师这次的要求和以前的要求是什么关系。每对只回一个词：一致、新增、改变、矛盾。只输出 JSON 数组，顺序和输入一致。`;
const KINDS: ChangeKind[] = ['一致', '新增', '改变', '矛盾'];

export interface MeetingResult { todos: Todo[]; requirements: Requirement[]; changes: Change[] }

export async function readMeeting(notes: string, meetingId: string, at: number, history: Requirement[], deps: Deps = {}): Promise<Drafted<MeetingResult>> {
  try {
    const got = parseMeeting(await ask(MEETING_SYS, notes, deps), meetingId, at);
    if (got) {
      let changes = compareRequirements(got.requirements, history);
      const pairs = changes.filter(c => c.before);
      if (pairs.length) {
        const reply = await ask(CLASSIFY_SYS, pairs.map((c, i) => `${i + 1}. 以前：${c.before!.text}\n   这次：${c.now.text}`).join('\n'), deps);
        const kinds = (/\[[\s\S]*\]/.exec(reply)?.[0] ?? '[]');
        let parsed: unknown = [];
        try { parsed = JSON.parse(kinds); } catch { /* keep the rule verdicts */ }
        if (Array.isArray(parsed) && parsed.length === pairs.length && parsed.every(k => KINDS.includes(k as ChangeKind))) {
          const byId = new Map(pairs.map((c, i) => [c.now.id, parsed[i] as ChangeKind]));
          changes = changes.map(c => {
            const kind = byId.get(c.now.id) ?? c.kind;
            return { ...c, kind, before: kind === '新增' ? undefined : c.before, settled: kind === '一致' || kind === '新增' };
          });
        }
      }
      return { value: { ...got, changes }, source: 'model', note: '模型抽取（训练好的组会模型上线前的临时替代）' };
    }
  } catch (e) {
    return { value: offline(notes, meetingId, at, history), source: 'rules', note: `${describeModelError(e)}（已用离线规则抽取）` };
  }
  return { value: offline(notes, meetingId, at, history), source: 'rules', note: '模型回复看不懂，已用离线规则抽取' };
}

function offline(notes: string, meetingId: string, at: number, history: Requirement[]): MeetingResult {
  const requirements = ruleRequirements(notes, meetingId, at);
  return { todos: ruleTodos(notes, meetingId, at), requirements, changes: compareRequirements(requirements, history, ruleClassify) };
}

const HELP_SYS = `帮本科生把卡住的问题写成发给导师的三句话：想做什么、试了什么、两个可选的办法请导师选。语气礼貌简短。
只用学生给的信息，学生没说试过的不要编。直接输出这三句话。`;

export async function helpMessage(task: string, step: string, words: string, deps: Deps = {}): Promise<Drafted<string>> {
  try {
    const text = (await ask(HELP_SYS, `任务：${task}\n卡住的步骤：${step}\n学生的话：${words}`, deps)).trim();
    if (text) return { value: text, source: 'model', note: '模型起草，发之前请自己改一遍' };
  } catch (e) {
    return { value: helpTemplate(task, step, words), source: 'rules', note: `${describeModelError(e)}（已用模板）` };
  }
  return { value: helpTemplate(task, step, words), source: 'rules', note: '模型没有回复，已用模板' };
}

export function helpTemplate(task: string, step: string, words: string): string {
  return `老师好，我在做「${task}」的「${step}」这一步。\n${words.trim() || '（写下你试过什么）'}\n我想到两个办法：①（办法一）②（办法二），您看哪个更合适？`;
}

const GAP_SYS = `判断导师布置给本科新生的一句话任务缺了哪些信息。对每一项给出"缺失概率"（0 到 1 的小数），只输出 JSON 对象，键固定为：
${SLOTS.map(d => d.slot).join('、')}。任务里已经说清的给低分；这类任务用不到的一项给 0。`;

/** Which parts of the ask are missing (model estimate, rules if none), then the 选问 algorithm picks what to ask. */
export async function findGaps(ask_: string, memory: Standing[], deps: Deps = {}): Promise<Drafted<{ ask: Gap[]; filled: Gap[] }>> {
  try {
    const reply = await ask(GAP_SYS, ask_, deps);
    const o = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? 'null') as Record<string, unknown> | null;
    if (o && SLOTS.every(d => typeof o[d.slot] === 'number')) {
      const missing = Object.fromEntries(SLOTS.map(d => [d.slot, Math.min(1, Math.max(0, o[d.slot] as number))])) as Record<Slot, number>;
      return { value: chooseQuestions(ask_, memory, missing), source: 'model', note: '模型判断缺什么（自训的缺口模型上线前的临时替代）' };
    }
  } catch (e) {
    return { value: chooseQuestions(ask_, memory), source: 'rules', note: `${describeModelError(e)}（已用离线规则）` };
  }
  return { value: chooseQuestions(ask_, memory), source: 'rules', note: '模型回复看不懂，已用离线规则' };
}

const REHEARSE_SYS = `你扮演本科生的导师，在组会上就学生的工作提问。先问导师以前提过的要求有没有做到，再问导师常问的那类问题。
只输出 JSON 数组，最多 4 项，每项 {"question":"导师的原话风格提问","why":"为什么会问","keys":["回答里应提到的词"]}。不要编造导师没说过的要求。`;

export async function rehearse(work: string, memory: Standing[], meetings: Meeting[], deps: Deps = {}): Promise<Drafted<Probe[]>> {
  const offline = () => ruleProbes(work, memory, meetings);
  try {
    const earlier = memory.slice(0, 8).map(m => `- ${m.now.text}`).join('\n') || '（无）';
    const reply = await ask(REHEARSE_SYS, `学生要汇报的工作：${work}\n导师以前的要求：\n${earlier}`, deps);
    const arr = JSON.parse(/\[[\s\S]*\]/.exec(reply)?.[0] ?? 'null') as Probe[] | null;
    const ok = Array.isArray(arr) ? arr.filter(p => typeof p?.question === 'string' && p.question.trim()).slice(0, 4)
      .map(p => ({ question: p.question.trim(), why: String(p.why ?? ''), keys: Array.isArray(p.keys) ? p.keys.map(String).slice(0, 4) : [] })) : [];
    if (ok.length) return { value: ok, source: 'model', note: '模型扮演导师提问' };
  } catch (e) {
    return { value: offline(), source: 'rules', note: `${describeModelError(e)}（已用导师以前的要求和常问问题）` };
  }
  return { value: offline(), source: 'rules', note: '模型回复看不懂，已用导师以前的要求和常问问题' };
}

const FEEDBACK_SYS = `你是组会上的导师。学生回答了你的问题。用两句话以内说：回答里缺了什么、怎么补一句更好。只依据问题和回答，不要编造。`;

export async function feedback(p: Probe, answer: string, deps: Deps = {}): Promise<Drafted<string>> {
  try {
    const text = (await ask(FEEDBACK_SYS, `问题：${p.question}\n应提到：${p.keys.join('、') || '（无）'}\n学生回答：${answer}`, deps)).trim();
    if (text) return { value: text, source: 'model', note: '模型点评' };
  } catch (e) {
    return { value: ruleFeedback(p, answer), source: 'rules', note: `${describeModelError(e)}（已用规则点评）` };
  }
  return { value: ruleFeedback(p, answer), source: 'rules', note: '模型没有回复，已用规则点评' };
}
