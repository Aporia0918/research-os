import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { ERROR_ZH, describeError, ApiError } from '../src/api/computer';

describe('zh UI', () => {
  it('scan finds no user-visible English in src', () => {
    const out = execFileSync('node', ['scripts/zh-scan.mjs'], { encoding: 'utf8' });
    expect(out).toContain('zh-scan: OK');
  });
  it('computer error codes are shown in Chinese, never the English message', () => {
    const msg = describeError(new ApiError(409, 'citation_gate_open', 'numbers not found on cited page'));
    expect(msg).toBe(ERROR_ZH.citation_gate_open);
    expect(describeError(new ApiError(418, 'weird_code', 'Some English'))).not.toContain('Some English');
  });
});
