// 拍手写: a photographed page of the user's own handwriting goes only to the user's own model key (a model that reads
// pictures); nothing reaches the computer.
import { chat, type FetchLike } from '../model/direct';
import { forJob, type ModelSettings } from '../model/settings';

/** A copy that only says it could not read the page is no copy. */
const NOTHING = /看不清|没找到|没有找到|无法识别|不能识别|cannot read|can't read|not found/i;

const COPY_SYSTEM = '把照片里手写的内容逐字抄下来，公式用普通文字写。只输出抄下来的内容，不要解释、不要补充、不要改错。看不清就只回复：看不清';
/** 拍手写: the handwritten explanation, copied word for word by the photo model, for the same grading as a typed one. */
export async function readHandwriting(dataUrl: string, s: ModelSettings, key: string, f?: FetchLike): Promise<string> {
  const text = (await chat(forJob(s, 'photo'), key, [
    { role: 'system', content: COPY_SYSTEM },
    { role: 'user', content: [{ type: 'text', text: '抄下这页手写的内容。' }, { type: 'image_url', image_url: { url: dataUrl } }] },
  ], f)).trim();
  return NOTHING.test(text.slice(0, 10)) ? '' : text;
}
