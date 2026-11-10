import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Plan } from '../src/api/computer';
import { confirmLocal, decideNumberLocal, openNumberGates } from '../src/logic/plan';

const plan = (): Plan => ({ id: 'p', version_id: 'v', state: 'draft', method: 'model', created_at: '', updated_at: '', confirmed_at: null,
  items: [
    { id: 'a', category: 'variables', text: 'sampled at 256 Hz', citation: { page_number: 2, quote: 'sampled at 128 Hz' } as never, source: 'model', edited: false,
      number_gate: { state: 'needs_confirmation', missing: ['256'], label: '需确认' } },
    { id: 'b', category: 'variables', text: '1-40 Hz', citation: null, source: 'paper', edited: false, number_gate: { state: 'ok', missing: [] } },
  ] });

describe('W6 1.11 numbers-and-citation gate', () => {
  it('lists open items and closes them only by the user decision', () => {
    const p = plan();
    expect(openNumberGates(p).map(i => i.id)).toEqual(['a']);
    const d = decideNumberLocal(p, 'a', 'reject_match', new Date('2026-11-05T02:00:00Z'));
    expect(d.items[0].number_gate?.state).toBe('reject_match');
    expect(decideNumberLocal(p, 'b', 'confirm_match').items[1].number_gate?.state).toBe('ok');
    expect(openNumberGates(d)).toEqual([]);
    expect(() => decideNumberLocal(confirmLocal(d), 'a', 'confirm_match')).toThrow();
  });
  it('wording', () => {
    const src = readFileSync('src/screens/PlanScreen.tsx', 'utf8');
    expect(src).toContain('需确认'); expect(src).toContain('由你判断'); expect(src).not.toMatch(/核验|已核实|verified/);
  });
});
