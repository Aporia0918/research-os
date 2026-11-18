// @vitest-environment jsdom
// 提示用户是在和 AI 互动: the fixed line under a model's answer says it is AI-written and may be wrong.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AI_NOTE, AiNote } from '../src/screens/AiNote';

describe('AI note', () => {
  it('says AI wrote it and to check it', () => {
    expect(AI_NOTE).toMatch(/AI 生成/);
    expect(AI_NOTE).toMatch(/核对/);
    expect(renderToStaticMarkup(createElement(AiNote))).toContain(AI_NOTE);
  });
});
