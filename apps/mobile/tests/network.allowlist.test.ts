// 1.4: outbound network is allowed only for (a) the user's own model key (model/direct.ts),
// (b) the update check/download, (c) computer calls behind the off-by-default toggle.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('network allowlist (static scan)', () => {
  const out = execFileSync('bash', ['scripts/network-scan.sh', '.'], { encoding: 'utf8' });
  const sites = out.split('## call sites')[1].trim().split('\n').slice(1).map(l => l.split(':')[0]);
  it('only allowed files can start a request', () => {
    const allowed = new Set(['src/App.tsx', 'src/api/session.ts', // the paired computer: pairing, and the client behind the toggle
      'src/logic/askLocal.ts', 'src/model/direct.ts', 'src/screens/EnhancedScreen.tsx', 'src/screens/ExamScreen.tsx',
      'src/screens/LedgerScreen.tsx', // ledger sync with the user's own paired computer, only when computer features are on
      'src/screens/ledger/shared.ts', // the user's own model key: grade an unsure repayment, first feedback, suggest task steps
      'src/logic/photoAsk.ts', // the user's own model key, for one photographed page the user chose to ask about
      'src/mentor/ai.ts', // 组会之后 prototype: the user's own model key, with offline rules when there is none
      'src/screens/SettingsScreen.tsx', 'src/screens/UpdateCard.tsx', 'src/update/manifest.ts', 'src/update/native.ts']);
    expect(sites.filter(f => !allowed.has(f))).toEqual([]);
  });
  it('no axios / XMLHttpRequest / WebSocket anywhere in shipped code', () => {
    expect(out).not.toMatch(/\baxios\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  });
  // One place builds the computer client (session.ts: null while computer features are off, plus pairing); the
  // settings test button builds its own so it can test before the toggle is on. Only these screens ask for it.
  it('computer client is only built in session.ts and the settings test button, and used by the four screens', () => {
    const lines = out.split('\n').filter(l => /new ResearchOsClient/.test(l)).map(l => l.split(':')[0]);
    expect([...new Set(lines)].sort()).toEqual(['src/api/session.ts', 'src/screens/SettingsScreen.tsx']);
    const users = execFileSync('grep', ['-rlE', 'computerClient\\(|pairWith\\(', 'src'], { encoding: 'utf8' })
      .trim().split('\n').filter(f => f !== 'src/api/session.ts').sort();
    expect(users).toEqual(['src/screens/EnhancedScreen.tsx', 'src/screens/ExamScreen.tsx',
      'src/screens/LedgerScreen.tsx', 'src/screens/SettingsScreen.tsx']);
  });
});
