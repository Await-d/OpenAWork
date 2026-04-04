import { describe, expect, it } from 'vitest';
import {
  buildReasoningBlockKey,
  extractReasoningHeading,
  extractReasoningPreview,
  getReasoningHint,
  getReasoningLabel,
  REASONING_UI_TOKENS,
} from '@openAwork/shared';
import {
  buildLocalReasoningBlockKey,
  extractLocalReasoningHeading,
  extractLocalReasoningPreview,
  getLocalReasoningHint,
  getLocalReasoningLabel,
  LOCAL_REASONING_UI_TOKENS,
} from './assistant-reasoning-block.helpers.js';

describe('assistant-reasoning-block.helpers', () => {
  it('keeps local reasoning ui tokens aligned with shared tokens', () => {
    expect(LOCAL_REASONING_UI_TOKENS).toEqual(REASONING_UI_TOKENS);
  });

  it.each([
    '## 先比较约束\n- 再确认边界\n最后组织答复',
    '<h3>计划 <code>foo</code></h3>\r\n正文',
    '先看边界\r\n-----\r\n再展开',
    '**只保留标题**',
    `- [查看文档](https://example.com) 并整理 \`tool_result\` 输出，${'额外说明'.repeat(20)}\n第二行`,
  ])('matches shared heading, preview and key generation for %s', (content) => {
    expect(extractLocalReasoningHeading(content)).toBe(extractReasoningHeading(content));
    expect(extractLocalReasoningPreview(content)).toBe(extractReasoningPreview(content));
    expect(buildLocalReasoningBlockKey(content, 0)).toBe(buildReasoningBlockKey(content, 0));
  });

  it('matches shared copy rules for label and hint', () => {
    expect(getLocalReasoningLabel({ index: 0, streaming: true, total: 1 })).toBe(
      getReasoningLabel({ index: 0, streaming: true, total: 1 }),
    );
    expect(getLocalReasoningLabel({ index: 1, streaming: false, total: 2 })).toBe(
      getReasoningLabel({ index: 1, streaming: false, total: 2 }),
    );
    expect(getLocalReasoningHint({ charCount: 42, open: false, streaming: true })).toBe(
      getReasoningHint({ charCount: 42, open: false, streaming: true }),
    );
    expect(getLocalReasoningHint({ charCount: 42, open: true, streaming: false })).toBe(
      getReasoningHint({ charCount: 42, open: true, streaming: false }),
    );
  });
});
