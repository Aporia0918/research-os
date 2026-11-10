import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/api/computer';
import { KEY_ACTION_LABEL, canConfirm, confirmLocal, decideLocal, openKeyActions } from '../src/logic/plan';
import { readFileSync } from 'node:fs';

const plan = (): Plan => ({ id: 'p', version_id: 'v', state: 'draft', method: 'deterministic', created_at: '', updated_at: '', confirmed_at: null,
  items: [
    { id: 'a', category: 'materials', text: 'upload raw EEG', citation: null, source: 'user', edited: true, key_action: 'send_data_out',
      approval: { state: 'needs_approval', decided_at: null, device_id: null } },
    { id: 'b', category: 'controls', text: 'baseline', citation: null, source: 'user', edited: true },
  ] });

describe('W6 2.3 key actions need approval', () => {
  it('blocks confirm until every key action is approved or rejected', () => {
    const p = plan();
    expect(openKeyActions(p).map(i => i.id)).toEqual(['a']);
    expect(canConfirm(p)).toBe(false);
    const d = decideLocal(p, 'a', 'reject', new Date('2026-11-05T01:00:00Z'));
    expect(d.items[0].approval).toEqual({ state: 'rejected', decided_at: '2026-11-05T01:00:00.000Z', device_id: 'demo' });
    expect(canConfirm(d)).toBe(true);
    const c = confirmLocal(d);
    expect(() => decideLocal(c, 'a', 'approve')).toThrow();
    expect(canConfirm(c)).toBe(false);
  });
  it('labels key actions and never claims verification', () => {
    expect(Object.keys(KEY_ACTION_LABEL)).toEqual(['run_model_call', 'send_data_out', 'share']);
    const src = readFileSync('src/screens/PlanScreen.tsx', 'utf8') + readFileSync('src/logic/plan.ts', 'utf8');
    expect(src).not.toMatch(/核验|已核实|verified/);
    expect(src).toContain('由你判断');
  });
});
