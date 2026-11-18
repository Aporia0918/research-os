// Phone and computer (simulated, no device, no network): the session kept after pairing survives a "restart" (a new
// client built from storage), goes out as a bearer header, and pushes from the computer land in the book. 非真机.
import { describe, expect, it } from 'vitest';
import { computerClient, forgetSession, loadSession, pairWith, type Vault } from '../src/api/session';
import type { FetchLike } from '../src/api/computer';
import { Book, type LedgerRemote } from '../src/ledger/ledger';
import { saveComputerSettings } from '../src/settings';
import { memoryKV } from '../src/storage/kv';

const D0 = '2026-12-01';
function vault(): Vault {
  const m = new Map<string, string>();
  return {
    store: { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } },
    plain: { get: async () => ({ value: null }), remove: async () => {} },
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('pairing keeps the phone signed in', () => {
  it('stores the token from the computer and sends it after a restart; off means no client at all', async () => {
    const v = vault(), kv = memoryKV();
    const seen: { url: string; auth?: string }[] = [];
    const f: FetchLike = async (url, init) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
      return url.endsWith('/auth/pair') ? json({ authenticated: true, token: 'tok-1' }) : json({ authenticated: true });
    };
    await pairWith('http://computer:8443', 'ab12cd34', v, f);
    expect(await loadSession(v)).toBe('tok-1');
    expect(await computerClient(kv, v, f)).toBeNull(); // computer features off: nothing is sent anywhere
    await saveComputerSettings(kv, { enabled: true, url: 'http://computer:8443' });
    const restarted = await computerClient(kv, v, f); // a new client from storage, as after closing the app
    expect((await restarted!.authState()).authenticated).toBe(true);
    expect(seen.map((s) => s.auth)).toEqual([undefined, 'Bearer tok-1']);
    await forgetSession(v);
    expect(await loadSession(v)).toBe('');
  });

  it('an older computer that answers without a token leaves no token behind', async () => {
    const v = vault();
    await pairWith('http://computer:8443', 'ab12cd34', v, async () => json({ authenticated: true }));
    expect(await loadSession(v)).toBe('');
  });

  it('a revoked or expired session reads as 401, which 设置 turns into "pair again"', async () => {
    const v = vault(), kv = memoryKV();
    await saveComputerSettings(kv, { enabled: true, url: 'http://computer:8443' });
    const c = await computerClient(kv, v, async () => json({ code: 'unauthenticated' }, 401));
    await expect(c!.authState()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});

describe('pushes from the computer land in the book', () => {
  it('用在哪里 found in a note fills an empty one, a recall accepted there reopens it here, all marked seen', async () => {
    const book = new Book(memoryKV());
    const a = await book.add({ clientId: 'k1', board: '科研', question: '午睡和记忆', answer: '午睡会提高记忆。', helpLevel: 'answer' }, D0);
    await book.add({ clientId: 'k2', board: '科研', question: '另一笔', answer: '傅里叶变换把信号从时域转到频域。', helpLevel: 'answer', usedIn: '开题报告' }, D0);
    await book.recallScan({ name: '论文乙', pages: ['在 80 名受试者中，午睡会降低记忆。'] }, D0);
    const marked: string[][] = [];
    let box = [{ id: 'p1', kind: 'used', entity_id: 'srv-k1', text: '组会幻灯片' }, { id: 'p2', kind: 'used', entity_id: 'srv-k2', text: '读书笔记' },
      { id: 'p3', kind: 'recall_settled', entity_id: 'rec-1', text: '午睡会提高记忆。' }, { id: 'p4', kind: 'entry', entity_id: 'x', text: '浏览器里记的' }];
    const remote: LedgerRemote = {
      entry: async (b) => ({ id: `srv-${b.client_id}` }), attempt: async () => ({}), due: async () => [], mark: async () => ({}), recall: async () => ({}),
      pushes: async () => box, seen: async (ids) => { marked.push(ids); box = []; },
    };
    expect(await book.sync(remote, '2026-12-03')).toMatchObject({ stopped: false, news: 2 });
    const [one, two] = await book.all();
    expect(one).toMatchObject({ id: a.id, usedIn: '组会幻灯片', dueOn: '2026-12-03', answer: '在 80 名受试者中，午睡会降低记忆。' });
    expect(one.recalls?.[0].state).toBe('accepted');
    expect(two.usedIn).toBe('开题报告'); // what the user wrote is never replaced
    expect(marked).toEqual([['p1', 'p2', 'p3', 'p4']]);
    expect((await book.sync(remote, '2026-12-03')).news).toBeUndefined(); // nothing new, nothing counted
  });
});
