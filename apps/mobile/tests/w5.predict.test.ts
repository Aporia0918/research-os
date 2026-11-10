import { describe, expect, it } from 'vitest';
import type { Guidance } from '../src/api/computer';
import { MAX_PREDICT_LOGS, PREDICT_NOTE, canDecide, decisionsFor, setDecision, tally, toggleLog } from '../src/logic/guidance';

const g: Guidance = { id: 'g1', kind: 'predict', version_id: 'v', plan_id: 'p', state: 'draft', method: 'deterministic', status: 'ok',
  input_text: 'l1', confirmed_at: null, items: [
    { id: 'a', kind: 'adjust', decision: null, suggestion: 'Log value 0.5-30 Hz differs from the paper\'s 1-40 Hz -> consider adjusting it. Source p.5.',
      prediction: 'may not be directly comparable (p.5)', citation: { evidence_id: 'e', page_number: 5, quote: 'to 1-40 Hz' } as never },
    { id: 'b', kind: 'consistent', decision: null, citation: { evidence_id: 'e2', page_number: 5, quote: 'x' } as never },
    { id: 'w', kind: 'weak_match', needs_confirmation: true, decision: null,
      suggestion: '弱匹配,需确认: log 256 Hz was paired with the paper\'s 1024 Hz (p.5). 辅助参考.',
      prediction: 'If this pairing is wrong, do not treat it as the paper value.',
      citation: { evidence_id: 'e3', page_number: 5, quote: '1024 Hz' } as never }] };

describe('W5 prediction and adjustment suggestions', () => {
  it('offers adopt / ignore for normal items; weak_match needs confirm/reject and tallies separately', () => {
    expect(decisionsFor(g, g.items[0])).toEqual(['adopt', 'ignore']);
    expect(decisionsFor(g, g.items[2])).toEqual(['confirm_match', 'reject_match']);
    expect(tally(g)).toEqual({ adjust: 1, consistent: 1, weak_match: 1 });
    expect(g.items[2].suggestion).toMatch(/弱匹配,需确认/);
  });
  it('every suggestion names its page and the note says the user decides', () => {
    expect(g.items[0].suggestion).toMatch(/p\.5/);
    expect(PREDICT_NOTE).toMatch(/辅助参考/);
    expect(PREDICT_NOTE).not.toMatch(/核验|已核实|verified/);
  });
  it('confirmed guidance cannot change', () => {
    const c = { ...g, state: 'confirmed' as const };
    expect(canDecide(c)).toBe(false);
    expect(() => setDecision(c, 'a', 'adopt')).toThrow();
  });
  it('log selection is capped at the server limit', () => {
    let sel: string[] = [];
    for (let k = 0; k < 15; k++) sel = toggleLog(sel, `l${k}`);
    expect(sel.length).toBe(MAX_PREDICT_LOGS);
    expect(toggleLog(sel, 'l0')).not.toContain('l0');
  });
});
