import { describe, expect, it } from 'vitest';
import {
  buildReasoningBlockKey,
  extractReasoningHeading,
  extractReasoningPreview,
  getReasoningLabel,
} from '@openAwork/shared';
import {
  buildLocalReasoningBlockKey,
  extractLocalReasoningExcerpt,
  extractLocalReasoningHeading,
  extractLocalReasoningPreview,
  getLocalReasoningHint,
  getLocalReasoningLabel,
} from './assistant-reasoning-block.helpers.js';

describe('assistant-reasoning-block.helpers', () => {
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
      '已显示摘要 · 点击展开',
    );
    expect(getLocalReasoningHint({ charCount: 42, open: true, streaming: true })).toBe(
      '持续更新中 · 点击收起',
    );
    expect(getLocalReasoningHint({ charCount: 42, open: false, streaming: false })).toBe(
      '已显示摘要 · 42 字',
    );
    expect(getLocalReasoningHint({ charCount: 42, open: true, streaming: false })).toBe(
      '收起 · 42 字',
    );
  });

  it('builds a collapsed excerpt without repeating the preview line when no heading exists', () => {
    expect(extractLocalReasoningExcerpt('先比较约束\n再检查边界\n最后组织答复')).toBe(
      '再检查边界 · 最后组织答复',
    );
  });
});
