// 1.4: outbound network is allowed only for (a) the user's own model key (model/direct.ts),
// (b) the update check/download, (c) computer calls behind the off-by-default toggle.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('network allowlist (static scan)', () => {
  const out = execFileSync('bash', ['scripts/network-scan.sh', '.'], { encoding: 'utf8' });
  const sites = out.split('## call sites')[1].trim().split('\n').slice(1).map(l => l.split(':')[0]);
  it('only allowed files can start a request', () => {
    const allowed = new Set(['src/App.tsx', 'src/logic/askLocal.ts', 'src/model/direct.ts', 'src/screens/EnhancedScreen.tsx', 'src/screens/ExamScreen.tsx',
      'src/screens/LedgerScreen.tsx', // ledger sync with the user's own paired computer, only when computer features are on
      'src/screens/ledger/shared.ts', // the user's own model key, only to grade an unsure repayment
      'src/screens/LifeScreen.tsx', // the user's own model key, for the 生活 reply and a second risk check; text redacted first
      'src/logic/photoAsk.ts', // the user's own model key, for one photographed page the user chose to ask about
      'src/screens/SettingsScreen.tsx', 'src/screens/UpdateCard.tsx', 'src/update/manifest.ts', 'src/update/native.ts']);
    expect(sites.filter(f => !allowed.has(f))).toEqual([]);
  });
  it('no axios / XMLHttpRequest / WebSocket anywhere in shipped code', () => {
    expect(out).not.toMatch(/\baxios\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  });
  // The ledger screen syncs only with the user's own paired computer, and only when computer features are on.
  it('computer client is only built in the enhanced screen, the null-world exam, the ledger sync and the settings test button', () => {
    const lines = out.split('\n').filter(l => /new ResearchOsClient/.test(l)).map(l => l.split(':')[0]);
    expect([...new Set(lines)].sort()).toEqual(['src/screens/EnhancedScreen.tsx', 'src/screens/ExamScreen.tsx',
      'src/screens/LedgerScreen.tsx', 'src/screens/SettingsScreen.tsx']);
  });
});
