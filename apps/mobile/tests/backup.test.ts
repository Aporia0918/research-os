import { describe, expect, it } from 'vitest';
import { BackupError, autoDue, autoPrune, entryCount, keepKey, makeBackup, readBackup, restoreBackup, type Store } from '../src/backup/backup';

function store(init: Record<string, string> = {}): Store & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return { m, async keys() { return [...m.keys()]; }, async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); } };
}

describe('backup', () => {
  it('keeps the ledger and drops secrets and device-only settings', async () => {
    const s = store({
      'mindledger.v1': '[{"id":"a"},{"id":"b"}]', 'mindledger.board.v1': '学习',
      'model.apiKey.v1': 'sk-x', 'model.apiKey.v1.migrated.secure.v1': '1',
      'settings.computerUrl.v1': 'http://x', 'update.lastCheck.v1': '1', 'backup.autoLast.v1': '1',
    });
    const b = await makeBackup(s, '1.4.122', new Date('2026-11-17T08:00:00Z'));
    expect(Object.keys(b.data)).toEqual(['mindledger.board.v1', 'mindledger.v1']);
    expect(b).toMatchObject({ app: 'researchos', format: 1, version: '1.4.122', createdAt: '2026-11-17T08:00:00.000Z' });
    expect(entryCount(b)).toBe(2);
    expect(JSON.stringify(b)).not.toContain('sk-x');
  });

  it('round-trips into an empty phone and leaves other keys alone', async () => {
    const b = await makeBackup(store({ 'mindledger.v1': '[]', 'life.x.v1': 'y' }), 'v');
    const target = store({ 'mindledger.v1': '[{"id":"old"}]', 'keep.me.v1': 'z' });
    expect(await restoreBackup(target, readBackup(JSON.stringify(b)))).toBe(2);
    expect(Object.fromEntries(target.m)).toEqual({ 'mindledger.v1': '[]', 'keep.me.v1': 'z', 'life.x.v1': 'y' });
  });

  it('refuses files that are not backups, from a newer format, and filters planted secrets', () => {
    expect(() => readBackup('not json')).toThrow(BackupError);
    expect(() => readBackup('{"app":"other","format":1,"data":{}}')).toThrow('这不是备份文件');
    expect(() => readBackup('{"app":"researchos","format":9,"data":{}}')).toThrow('备份来自更新的版本');
    const b = readBackup('{"app":"researchos","format":1,"data":{"model.apiKey.v1":"sk","a.v1":"1","n.v1":5}}');
    expect(b.data).toEqual({ 'a.v1': '1' });
    expect(keepKey('settings.computerEnabled.v1')).toBe(false);
  });

  it('takes one snapshot a day and keeps the newest five', () => {
    expect(autoDue(null, 0)).toBe(true);
    expect(autoDue(0, 23 * 3600e3)).toBe(false);
    expect(autoDue(0, 24 * 3600e3)).toBe(true);
    const names = ['auto-2026-11-10T08-00-00.json', 'auto-2026-11-11T08-00-00.json', 'auto-2026-11-12T08-00-00.json',
      'auto-2026-11-13T08-00-00.json', 'auto-2026-11-14T08-00-00.json', 'auto-2026-11-15T08-00-00.json', 'auto-2026-11-16T08-00-00.json', 'other.json'];
    expect(autoPrune(names)).toEqual(['auto-2026-11-10T08-00-00.json', 'auto-2026-11-11T08-00-00.json']);
  });
});
