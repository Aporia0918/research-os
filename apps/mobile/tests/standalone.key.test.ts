// Direct model client against a LOCAL mock model server only (no real model, no real key). 非真机.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chat, describeModelError, withFallback, ModelError } from '../src/model/direct';
import { DEFAULT_MODEL_SETTINGS, MODEL_KEY_KEY, loadModelSettings, saveModelSettings } from '../src/model/settings';
import { memoryKV } from '../src/storage/kv';
import { readSecret, writeSecret, type PlainMap, type SecretStore } from '../src/storage/secureKeyStore';
import { setLang } from '../src/i18n';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FAKE = 'test-fake-key-000';            // not a real key
const seen: { path: string; auth?: string; xkey?: string; body: string }[] = [];
let srv: Server; let base = '';
function body(r: IncomingMessage) { return new Promise<string>(ok => { let b = ''; r.on('data', c => b += c); r.on('end', () => ok(b)); }); }
beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const b = await body(req); const path = req.url ?? '';
    seen.push({ path, auth: req.headers.authorization, xkey: req.headers['x-api-key'] as string | undefined, body: b });
    const mode = path.split('/')[1];
    if (mode === 'slow') return void setTimeout(() => res.end('{}'), 1500);
    if (mode === 'deny') { res.statusCode = 401; return void res.end(`{"error":"bad key ${FAKE}"}`); }
    if (mode === 'busy') { res.statusCode = 429; return void res.end('{}'); }
    if (mode === 'boom') { res.statusCode = 500; return void res.end('oops'); }
    if (mode === 'junk') return void res.end('not json');
    const okKey = req.headers.authorization === `Bearer ${FAKE}` || req.headers['x-api-key'] === FAKE;
    if (!okKey) { res.statusCode = 401; return void res.end('{}'); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }));
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.close(); setLang('zh'); });
export function memStore(m: Map<string, string>): SecretStore {
  return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async remove(k) { m.delete(k); } };
}
export function memPlain(m: Map<string, string>): PlainMap {
  return { async get(k) { return { value: m.get(k) ?? null }; }, async remove(k) { m.delete(k); } };
}
const S = (path: string, extra = {}) => ({ ...DEFAULT_MODEL_SETTINGS, baseUrl: `${base}/${path}`, model: 'mock', timeoutMs: 400, ...extra });
const msg = [{ role: 'user' as const, content: 'ping' }];

describe('key stays on the phone', () => {
  it('key is stored in the phone KV and can be cleared', async () => {
    // stores are plain in-memory maps so no Keystore / native plugin is touched (非真机)
    const secure = new Map<string, string>(); const prefs = new Map<string, string>();
    const kv = memoryKV();
    expect(await readSecret(MODEL_KEY_KEY, memStore(secure), memPlain(prefs))).toBe('');
    await writeSecret(MODEL_KEY_KEY, `  ${FAKE} `, memStore(secure), memPlain(prefs));
    expect(secure.get(MODEL_KEY_KEY)).toBe(FAKE);
    expect(prefs.has(MODEL_KEY_KEY)).toBe(false);
    expect(await readSecret(MODEL_KEY_KEY, memStore(secure), memPlain(prefs))).toBe(FAKE);
    await saveModelSettings(kv, { ...DEFAULT_MODEL_SETTINGS, baseUrl: 'https://m.example/v1/', model: ' m ' });
    expect(await loadModelSettings(kv)).toMatchObject({ baseUrl: 'https://m.example/v1', model: 'm' });
    await writeSecret(MODEL_KEY_KEY, '', memStore(secure), memPlain(prefs));
    expect(secure.has(MODEL_KEY_KEY)).toBe(false);
  });
  it('no source file sends a key to the computer backend or logs it', () => {
    const files: string[] = [];
    (function walk(d: string) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })('src');
    const all = files.map(f => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toMatch(/settings\/keys/);
    expect(all).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });
});

describe('direct model client (local mock server)', () => {
  it('sends Bearer key straight to the model URL and returns the text', async () => {
    expect(await chat(S('ok'), FAKE, msg)).toBe('pong');
    const r = seen.at(-1)!;
    expect(r.path).toBe('/ok/chat/completions'); expect(r.auth).toBe(`Bearer ${FAKE}`);
    expect(JSON.parse(r.body)).toEqual({ model: 'mock', messages: msg });
  });
  it('supports the x-api-key header', async () => {
    expect(await chat(S('ok', { header: 'x-api-key' }), FAKE, msg)).toBe('pong');
    expect(seen.at(-1)!.xkey).toBe(FAKE); expect(seen.at(-1)!.auth).toBeUndefined();
  });
  const cases: [string, string, RegExp][] = [
    ['slow', 'timeout', /超时/], ['deny', 'unauthorized', /拒绝了这个密钥/], ['busy', 'rate_limited', /额度/],
    ['boom', 'http', /错误代码 500/], ['junk', 'bad_response', /看不懂/],
  ];
  for (const [path, code, zh] of cases) it(`${code} -> Chinese message, key never in the message`, async () => {
    const e = await chat(S(path), FAKE, msg).catch(x => x);
    expect(e).toBeInstanceOf(ModelError); expect((e as ModelError).code).toBe(code);
    setLang('zh'); const m = describeModelError(e); expect(m).toMatch(zh); expect(m).not.toContain(FAKE);
    expect(String(e) + JSON.stringify(e)).not.toContain(FAKE);
    setLang('en'); expect(describeModelError(e)).toMatch(/rule-only/); setLang('zh');
  });
  it('offline (nothing listening) -> Chinese message', async () => {
    const e = await chat({ ...S('ok'), baseUrl: 'http://127.0.0.1:9' }, FAKE, msg).catch(x => x);
    expect((e as ModelError).code).toBe('offline'); expect(describeModelError(e)).toMatch(/连不上模型服务/);
  });
  it('no key / no URL never makes a request', async () => {
    const n = seen.length;
    expect((await chat(S('ok'), '', msg).catch(x => x)).code).toBe('no_key');
    expect((await chat({ ...S('ok'), baseUrl: '' }, FAKE, msg).catch(x => x)).code).toBe('no_base_url');
    expect((await chat({ ...S('ok'), baseUrl: 'ftp://x' }, FAKE, msg).catch(x => x)).code).toBe('bad_base_url');
    expect(seen.length).toBe(n);
  });
  it('falls back to rule-only mode with a reason', async () => {
    const out = await withFallback(S('deny'), FAKE, msg, () => 'rules-answer');
    expect(out).toMatchObject({ mode: 'rules', result: 'rules-answer' });
    if (out.mode === 'rules') expect(out.reason).toMatch(/规则模式/);
    expect(await withFallback(S('ok'), FAKE, msg, () => 'x')).toEqual({ mode: 'model', text: 'pong' });
    expect((await withFallback(S('ok'), '', msg, () => 'r')).mode).toBe('rules');
  });
});
