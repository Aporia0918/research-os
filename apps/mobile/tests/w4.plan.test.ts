import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/api/computer';
import { NO_METHOD_LABEL, methodSectionMissing } from '../src/logic/plan';

const base: Plan = { id: 'P', version_id: 'V', state: 'draft', method: 'deterministic', created_at: '', updated_at: '',
  confirmed_at: null, items: [] };

describe('W4 plan: method section not found', () => {
  it('flags a plan whose paper has no method heading', () => {
    expect(methodSectionMissing({ ...base, status: 'method_section_not_found' })).toBe(true);
    expect(NO_METHOD_LABEL).toBe('未找到方法章节');
  });
  it('treats ok, missing status (older server) and no plan as found', () => {
    expect(methodSectionMissing({ ...base, status: 'ok' })).toBe(false);
    expect(methodSectionMissing(base)).toBe(false);
    expect(methodSectionMissing(null)).toBe(false);
  });
});
