// 拍一页问一句 (plan 2.4; demo first stop, paper side): photograph one page of a textbook, handout or paper and ask about
// it. The photo goes only to the user's own model key (a model that reads pictures); nothing reaches the computer.
// What the model explained is booked as one 理解债 for that page, the same way a cited page of an imported PDF is.
import { chat, type ChatMessage, type FetchLike } from '../model/direct';
import { forJob, type ModelSettings } from '../model/settings';
import type { NewEntry } from '../ledger/ledger';
import { stableId } from '../rules/understand';

export type PhotoBoard = '学习' | '科研';
const SYSTEM = '只根据照片里这一页的内容回答，用中文，三到六句。照片里没有的就说没找到，不要编。看不清就直说看不清。';
/** A model answer that only says it could not read or find anything is not an explanation, so it books nothing. */
const NOTHING = /看不清|没找到|没有找到|无法识别|不能识别|cannot read|can't read|not found/i;

export function photoMessages(question: string, dataUrl: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: [{ type: 'text', text: question.trim() }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ];
}

/** Ask the photo model; throws ModelError (no key, timeout, a model that can't read pictures …) for the screen to word. */
export async function askPhoto(question: string, dataUrl: string, s: ModelSettings, key: string, f?: FetchLike): Promise<string> {
  return chat(forJob(s, 'photo'), key, photoMessages(question, dataUrl), f);
}

/** The one 理解债 a photo answer books, or none when the model could not read the page. Same photo and question: same id. */
export function photoDebt(a: { question: string; answer: string; board: PhotoBoard; photoId: string; ai?: string }): NewEntry | null {
  const q = a.question.trim(), text = a.answer.trim();
  if (!q || !text || NOTHING.test(text.slice(0, 40))) return null;
  return {
    clientId: stableId('photo', a.photoId, q), board: a.board, topic: '拍的一页', question: `${q}（拍的一页）`, answer: text,
    helpLevel: 'answer', ...(a.ai?.trim() ? { ai: a.ai.trim() } : {}),
  };
}

const COPY_SYSTEM = '把照片里手写的内容逐字抄下来，公式用普通文字写。只输出抄下来的内容，不要解释、不要补充、不要改错。看不清就只回复：看不清';
/** 拍手写: the handwritten explanation, copied word for word by the photo model, for the same grading as a typed one. */
export async function readHandwriting(dataUrl: string, s: ModelSettings, key: string, f?: FetchLike): Promise<string> {
  const text = (await chat(forJob(s, 'photo'), key, [
    { role: 'system', content: COPY_SYSTEM },
    { role: 'user', content: [{ type: 'text', text: '抄下这页手写的内容。' }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ], f)).trim();
  return NOTHING.test(text.slice(0, 10)) ? '' : text;
}
