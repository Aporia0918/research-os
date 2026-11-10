import { describe, expect, it } from 'vitest';
import { NO_IDEA_TOPIC, noIdeaQuestions } from '../src/logic/guidance';

describe('W6 content-aware idea questions', () => {
  it('an idea with no matching topic shows a plain note, not invented questions', () => {
    expect(noIdeaQuestions({ kind: 'questions', status: 'ok', items: [] })).toBe(true);
    expect(noIdeaQuestions({ kind: 'questions', status: 'ok', items: [{}] })).toBe(false);
    expect(noIdeaQuestions({ kind: 'questions', status: 'method_section_not_found', items: [] })).toBe(false);
    expect(NO_IDEA_TOPIC).not.toMatch(/核验|已核实|verified/);
  });
});
