// OpenRouter routing on the phone: one key, a model per job, the public model list; and 拍一页问一句 booking. 非真机.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_SETTINGS, MAX_TIMEOUT_MS, OPENROUTER_BASE_URL, clampTimeout, forJob, loadModelSettings, saveModelSettings } from '../src/model/settings';
import { ModelError, chat, listModels, type FetchLike } from '../src/model/direct';
import { askPhoto, photoDebt, photoMessages } from '../src/logic/photoAsk';
import { memoryKV } from '../src/storage/kv';

const S = { ...DEFAULT_MODEL_SETTINGS, baseUrl: OPENROUTER_BASE_URL, model: 'main/model', jobs: { photo: 'vision/model' } };
const reply = (text: string): FetchLike => async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

describe('one key, a model per job', () => {
  it('a job uses its own model when set and the main model otherwise', () => {
    expect(forJob(S, 'photo').model).toBe('vision/model');
    expect(forJob(S, 'grade').model).toBe('main/model');
    expect(forJob({ ...S, jobs: { grade: '  ' } }, 'grade').model).toBe('main/model');
  });
  it('saves trimmed job models, drops empty ones, and clamps the wait to 1 to 30 seconds', async () => {
    const kv = memoryKV();
    await saveModelSettings(kv, { ...S, jobs: { photo: ' vision/model ', grade: '' } });
    expect((await loadModelSettings(kv)).jobs).toEqual({ photo: 'vision/model' });
    expect(clampTimeout(120000)).toBe(MAX_TIMEOUT_MS);
    expect(clampTimeout(10)).toBe(1000);
    expect((await loadModelSettings(memoryKV())).timeoutMs).toBe(20000);
  });
  it('sends the chosen model name with the one key, to the OpenRouter address', async () => {
    const sent: { url: string; body: string; auth: string }[] = [];
    const f: FetchLike = async (url, init) => {
      sent.push({ url, body: String(init?.body), auth: (init?.headers as Record<string, string>).Authorization });
      return reply('好')(url, init);
    };
    await chat(forJob(S, 'photo'), 'k', [{ role: 'user', content: 'hi' }], f);
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(sent[0].body).model).toBe('vision/model');
    expect(sent[0].auth).toBe('Bearer k');
  });
  it('reads the public model list without sending the key', async () => {
    let headers: unknown;
    const f: FetchLike = async (_url, init) => { headers = init?.headers; return new Response(JSON.stringify({ data: [{ id: 'b/m' }, { id: 'a/m' }, { id: 'a/m' }, {}] })); };
    expect(await listModels(OPENROUTER_BASE_URL, f)).toEqual(['a/m', 'b/m']);
    expect(headers).toBeUndefined();
    await expect(listModels('openrouter.ai', f)).rejects.toBeInstanceOf(ModelError);
    await expect(listModels(OPENROUTER_BASE_URL, async () => new Response('{}'))).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('拍一页问一句', () => {
  it('sends the question and the photo together, to the photo model', async () => {
    let body: { model: string; messages: { content: unknown }[] } | null = null;
    const f: FetchLike = async (url, init) => { body = JSON.parse(String(init?.body)); return reply('换元后 du = 2x dx。')(url, init); };
    expect(await askPhoto('这一步怎么来的', 'data:image/jpeg;base64,AAAA', S, 'k', f)).toBe('换元后 du = 2x dx。');
    expect(body!.model).toBe('vision/model');
    expect(body!.messages[1].content).toEqual(photoMessages('这一步怎么来的', 'data:image/jpeg;base64,AAAA')[1].content);
  });
  it('books one 理解债 on the board the user picked, the same id for the same photo and question', () => {
    const a = { question: ' 这一步怎么来的 ', answer: '换元后 du = 2x dx。', board: '学习' as const, photoId: 'p1', ai: 'vision/model' };
    const d = photoDebt(a)!;
    expect(d).toMatchObject({ board: '学习', question: '这一步怎么来的（拍的一页）', helpLevel: 'answer', ai: 'vision/model' });
    expect(photoDebt(a)!.clientId).toBe(d.clientId);
    expect(photoDebt({ ...a, photoId: 'p2' })!.clientId).not.toBe(d.clientId);
  });
  it('books nothing when the model could not read the page', () => {
    expect(photoDebt({ question: '这是什么', answer: '照片看不清，没法回答。', board: '科研', photoId: 'p' })).toBeNull();
    expect(photoDebt({ question: '这是什么', answer: '', board: '科研', photoId: 'p' })).toBeNull();
  });
});
