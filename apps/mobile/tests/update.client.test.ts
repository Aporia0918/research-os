// In-app update client against a LOCAL test server only (no hosting account). 非真机: native download/install not exercised.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AUTO_INTERVAL_MS, DEFAULT_MANIFEST_URL, DEFAULT_RELEASE_BASE, UpdateError, decide, describeUpdateError,
  downloadVerified, fetchDownloader, fetchManifest, isAssetName, loadMirrorPrefix, loadSource, manualAllowed,
  markAutoCheck, parseManifest, releaseUrl, saveMirrorPrefix, saveSource, shouldAutoCheck, sha256Hex,
  withMirrorPrefix, type Manifest, UPDATE_SOURCES, UPDATE_TIMEOUT_MS, sourceList, fetchManifestFromSources, percent,
} from '../src/update/manifest';
import { LOCAL_VERSION_CODE, LOCAL_VERSION_NAME } from '../src/update/version';
import { memoryKV } from '../src/storage/kv';
import { setLang } from '../src/i18n';

const APK = Buffer.from('PK\u0003\u0004 fake apk bytes for tests only '.repeat(100));
const SHA = createHash('sha256').update(APK).digest('hex');
const hits: string[] = [];
let srv: Server; let base = '';
const manifest = (o: Partial<Manifest> = {}) => ({
  versionName: '0.2.0', versionCode: 2, minSupportedVersionCode: 1, sha256: SHA, size: APK.length,
  apk: [{ url: `${base}/apk/good`, priority: 10 }], signature: { scheme: 'v2', keyId: 'sha256:test' },
  releaseNotes: '修复若干问题。\n第二行。', publishedAt: '2026-11-20T12:00:00+08:00', channel: 'stable', ...o,
});
beforeAll(async () => {
  srv = createServer((req, res) => {
    const u = req.url ?? ''; hits.push(u);
    if (u === '/v/ok.json') return void res.end(JSON.stringify(manifest()));
    if (u === '/v/broken.json') return void res.end('{"versionCode": 2,');
    if (u === '/v/500.json') { res.statusCode = 500; return void res.end(); }
    if (u === '/v/slow.json') return void setTimeout(() => res.end('{}'), 1500);
    if (u === '/apk/good') return void res.end(APK);
    if (u === '/apk/tampered') { const b = Buffer.from(APK); b[10] ^= 1; return void res.end(b); }
    if (u === '/apk/short') return void res.end(APK.subarray(0, 100));
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.close(); setLang('zh'); });

describe('T1 manifest parse/validate', () => {
  it('accepts the spec example shape and sorts mirrors by priority', () => {
    const m = parseManifest(JSON.stringify(manifest({ apk: [{ url: 'https://b.example/a.apk', priority: 20 }, { url: 'https://a.example/a.apk', priority: 10 }] })));
    expect(m.apk.map(x => x.url)).toEqual(['https://a.example/a.apk', 'https://b.example/a.apk']);
  });
  it.each([
    ['not json', 'bad_json'], ['[1]', 'bad_json'],
    [JSON.stringify({ ...manifest(), sha256: 'ABC' }), 'bad_manifest'],
    [JSON.stringify({ ...manifest(), sha256: SHA.toUpperCase() }), 'bad_manifest'],
    [JSON.stringify({ ...manifest(), apk: [] }), 'bad_manifest'],
    [JSON.stringify({ ...manifest(), apk: [{ url: 'file:///x.apk' }] }), 'bad_manifest'],
    [JSON.stringify({ ...manifest(), versionCode: '2' }), 'bad_manifest'],
    [JSON.stringify({ ...manifest(), size: 0 }), 'bad_manifest'],
  ])('rejects %s', (text, code) => { expect(() => parseManifest(text)).toThrow(expect.objectContaining({ code })); });
});

describe('T2 versionCode compare / channel / minSupported', () => {
  const m = parseManifest(JSON.stringify(manifest({ apk: [{ url: 'https://a.example/a.apk', priority: 1 }] })));
  it('newer -> update, equal/older -> latest', () => {
    expect(decide(m, 1, 'stable')).toMatchObject({ kind: 'update', urgent: false });
    expect(decide(m, 2, 'stable').kind).toBe('latest');
    expect(decide(m, 3, 'stable').kind).toBe('latest');
  });
  it('compares versionCode only, not versionName', () => {
    expect(decide({ ...m, versionName: '9.9.9', versionCode: 1 }, 1, 'stable').kind).toBe('latest');
  });
  it('other channel ignored; below minSupported is urgent', () => {
    expect(decide(m, 1, 'beta').kind).toBe('other_channel');
    expect(decide({ ...m, versionCode: 5, minSupportedVersionCode: 3 }, 2, 'stable')).toMatchObject({ kind: 'update', urgent: true });
  });
  it('local version matches android/app/build.gradle', () => {
    const g = readFileSync('android/app/build.gradle', 'utf8');
    expect(g).toMatch(new RegExp(`versionCode ${LOCAL_VERSION_CODE}\\b`));
    expect(g).toContain(`versionName "${LOCAL_VERSION_NAME}"`);
  });
});

describe('T3 throttle (injectable clock)', () => {
  it('auto check at most once per 12h; manual has a 30s guard only', async () => {
    const kv = memoryKV(); const t0 = 1_800_000_000_000;
    expect(await shouldAutoCheck(kv, t0)).toBe(true);
    await markAutoCheck(kv, t0);
    expect(await shouldAutoCheck(kv, t0 + AUTO_INTERVAL_MS - 1)).toBe(false);
    expect(await shouldAutoCheck(kv, t0 + AUTO_INTERVAL_MS)).toBe(true);
    expect(await shouldAutoCheck(kv, t0 - 1000)).toBe(true); // clock moved back
    expect(manualAllowed(0, t0)).toBe(true);
    expect(manualAllowed(t0, t0 + 29_999)).toBe(false);
    expect(manualAllowed(t0, t0 + 30_000)).toBe(true);
  });
});

describe('T4 fetch manifest from local server; failure paths in Chinese', () => {
  it('reads version.json with a plain GET (no query, no personal data)', async () => {
    const m = await fetchManifest(`${base}/v/ok.json`);
    expect(m.versionCode).toBe(2); expect(hits.at(-1)).toBe('/v/ok.json');
  });
  const cases: [string, string, RegExp][] = [
    ['', 'no_source', /未配置更新源/], ['ftp://x/v.json', 'bad_source', /http:\/\//],
    ['/v/broken.json', 'bad_json', /格式不对/], ['/v/500.json', 'http', /错误代码 500/],
    ['/v/slow.json', 'timeout', /暂时连不上更新服务器，稍后再试/], ['http://127.0.0.1:9/v.json', 'offline', /暂时连不上更新服务器/],
  ];
  for (const [u, code, zh] of cases) it(`${code}`, async () => {
    const url = u.startsWith('/') ? base + u : u;
    const e = await fetchManifest(url, fetch, 400).catch(x => x);
    expect(e).toBeInstanceOf(UpdateError); expect(e.code).toBe(code);
    setLang('zh'); expect(describeUpdateError(e)).toMatch(zh);
    setLang('en'); expect(describeUpdateError(e)).not.toMatch(/[\u4e00-\u9fff]/); setLang('zh');
  });
});

describe('T5 download: size then sha256, mirrors in priority order', () => {
  it('sha256 helper matches node crypto', async () => { expect(await sha256Hex(new Uint8Array(APK))).toBe(SHA); });
  it('good mirror passes', async () => {
    const r = await downloadVerified(parseManifest(JSON.stringify(manifest())), fetchDownloader());
    expect(r.url).toBe(`${base}/apk/good`);
  });
  it('tampered -> sha_mismatch, short -> size_mismatch, nothing returned', async () => {
    const m1 = parseManifest(JSON.stringify(manifest({ apk: [{ url: `${base}/apk/tampered`, priority: 1 }] })));
    const e1 = await downloadVerified(m1, fetchDownloader()).catch(x => x);
    expect(e1.code).toBe('sha_mismatch'); expect(describeUpdateError(e1)).toMatch(/sha256.*没有安装/);
    const m2 = parseManifest(JSON.stringify(manifest({ apk: [{ url: `${base}/apk/short`, priority: 1 }] })));
    expect((await downloadVerified(m2, fetchDownloader()).catch(x => x)).code).toBe('size_mismatch');
  });
  it('falls back to the next mirror after a bad one', async () => {
    const m = parseManifest(JSON.stringify(manifest({ apk: [
      { url: `${base}/apk/good`, priority: 30 }, { url: `${base}/apk/tampered`, priority: 10 },
      { url: 'http://127.0.0.1:9/x.apk', priority: 20 } ] })));
    const start = hits.length; const store = new Map<string, Uint8Array>();
    const r = await downloadVerified(m, fetchDownloader(fetch, store));
    expect(r.url).toBe(`${base}/apk/good`);
    expect(hits.slice(start)).toEqual(['/apk/tampered', '/apk/good']);
    expect(store.size).toBe(1); // only the verified file is kept
  });
});

describe('T6 default release URL + asset name + mirror prefix', () => {
  it('DEFAULT_MANIFEST_URL points at the public releases latest version.json', async () => {
    expect(DEFAULT_RELEASE_BASE).toBe('https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download');
    expect(DEFAULT_MANIFEST_URL).toBe(`${DEFAULT_RELEASE_BASE}/version.json`);
    const kv = memoryKV();
    expect(await loadSource(kv)).toBe(DEFAULT_MANIFEST_URL);
    await saveSource(kv, '');
    expect(await loadSource(kv)).toBe('');
    expect(await loadMirrorPrefix(kv)).toBe('');
    await saveMirrorPrefix(kv, 'https://mirror.example/gh/');
    expect(await loadMirrorPrefix(kv)).toBe('https://mirror.example/gh/');
    expect(isAssetName('paper-lab-assistant-1.3.apk')).toBe(true);
    expect(isAssetName('../x.apk')).toBe(false);
    expect(isAssetName('a/b.apk')).toBe(false);
    expect(releaseUrl('paper-lab-assistant-1.3.apk')).toBe(
      'https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download/paper-lab-assistant-1.3.apk',
    );
    expect(withMirrorPrefix(DEFAULT_MANIFEST_URL, 'https://mirror.example/gh')).toBe(
      `https://mirror.example/gh/${DEFAULT_MANIFEST_URL}`,
    );
    expect(releaseUrl('paper-lab-assistant-1.3.apk', { mirrorPrefix: 'https://mirror.example/gh' })).toBe(
      'https://mirror.example/gh/https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download/paper-lab-assistant-1.3.apk',
    );
  });

  it('version.json with asset (no apk[]) builds the GitHub latest download URL', () => {
    const body = JSON.stringify({
      versionName: '1.3', versionCode: 4, minSupportedVersionCode: 2,
      asset: 'paper-lab-assistant-1.3.apk', sha256: SHA, size: APK.length,
      releaseNotes: '指向公开发布仓库。', publishedAt: '2026-11-06T12:00:00+08:00', channel: 'stable',
    });
    const m = parseManifest(body);
    expect(m.asset).toBe('paper-lab-assistant-1.3.apk');
    expect(m.versionCode).toBe(4);
    expect(m.sha256).toBe(SHA);
    expect(m.apk).toEqual([{
      url: 'https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download/paper-lab-assistant-1.3.apk',
      priority: 10,
    }]);
  });

  it('mirror prefix is applied to asset-built APK URL', () => {
    const body = JSON.stringify({
      versionName: '1.3', versionCode: 4, minSupportedVersionCode: 2,
      asset: 'paper-lab-assistant-1.3.apk', sha256: SHA, size: APK.length,
      releaseNotes: '镜像前缀。', publishedAt: '2026-11-06T12:00:00+08:00', channel: 'stable',
    });
    const m = parseManifest(body, { mirrorPrefix: 'https://mirror.example/gh' });
    expect(m.apk[0].url).toBe(
      'https://mirror.example/gh/https://github.com/Aporia0918/paper-lab-assistant-releases/releases/latest/download/paper-lab-assistant-1.3.apk',
    );
  });

  it('rejects missing versionCode / sha256 / asset-and-apk', () => {
    const base = { versionName: '1.3', minSupportedVersionCode: 2, size: APK.length,
      releaseNotes: 'x', publishedAt: '2026-11-06T12:00:00+08:00', channel: 'stable' };
    expect(() => parseManifest(JSON.stringify({ ...base, asset: 'a.apk', sha256: SHA }))).toThrow(expect.objectContaining({ code: 'bad_manifest' })); // no versionCode
    expect(() => parseManifest(JSON.stringify({ ...base, versionCode: 4, asset: 'a.apk' }))).toThrow(expect.objectContaining({ code: 'bad_manifest' })); // no sha256
    expect(() => parseManifest(JSON.stringify({ ...base, versionCode: 4, sha256: SHA }))).toThrow(expect.objectContaining({ code: 'bad_manifest' })); // no asset/apk
  });
});

describe('T7 1.4: 10 s hard timeout, ordered sources (GitHub only), download progress', () => {
  it('default limit is 10 s and only GitHub is enabled, first in the list', () => {
    expect(UPDATE_TIMEOUT_MS).toBe(10000);
    expect(UPDATE_SOURCES[0]).toEqual({ id: 'github', url: DEFAULT_MANIFEST_URL, enabled: true });
    expect(UPDATE_SOURCES.filter(s => s.enabled).map(s => s.id)).toEqual(['github']);
    expect(sourceList(DEFAULT_MANIFEST_URL)).toEqual([DEFAULT_MANIFEST_URL]);
    expect(sourceList('https://x.example/v.json')).toEqual(['https://x.example/v.json']);
    expect(sourceList('', [{ id: 'a', url: 'https://a/v.json', enabled: true }, { id: 'b', url: 'https://b/v.json', enabled: false }, { id: 'c', url: 'https://c/v.json', enabled: true }])).toEqual(['https://a/v.json', 'https://c/v.json']);
  });
  it('hard timeout also covers a body that never finishes', async () => {
    const hang: typeof fetch = async () => new Response(new ReadableStream({ start() { /* never closes */ } }));
    const t0 = Date.now(); const e = await fetchManifest('https://x.example/v.json', hang, 300).catch(x => x);
    expect(e.code).toBe('timeout'); expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('tries the next source after a failing one, in order', async () => {
    const r = await fetchManifestFromSources([`${base}/v/500.json`, 'http://127.0.0.1:9/v.json', `${base}/v/ok.json`], fetch, 400);
    expect(r.url).toBe(`${base}/v/ok.json`); expect(r.manifest.versionCode).toBe(2);
    const e = await fetchManifestFromSources([`${base}/v/slow.json`], fetch, 300).catch(x => x);
    expect(e.code).toBe('timeout');
  });
  it('reports download progress up to 100%', async () => {
    const seen: number[] = [];
    await downloadVerified(parseManifest(JSON.stringify(manifest())), fetchDownloader(), (l, t) => seen.push(percent(l, t)));
    expect(seen.length).toBeGreaterThan(0); expect(seen.at(-1)).toBe(100);
    expect(percent(50, 200)).toBe(25); expect(percent(1, 0)).toBe(0);
  });
});
