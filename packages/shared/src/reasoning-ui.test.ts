import { describe, expect, it } from 'vitest';
import {
  buildReasoningBlockKey,
  extractReasoningHeading,
  extractReasoningPreview,
  REASONING_UI_TOKENS,
  getReasoningHint,
  getReasoningLabel,
} from './reasoning-ui.js';

describe('reasoning-ui', () => {
  it('extracts a heading from markdown reasoning content', () => {
    expect(extractReasoningHeading('## 先比较约束\n然后输出结论')).toBe('先比较约束');
  });

  it('builds a stable preview and key from the first semantic line', () => {
    expect(extractReasoningPreview('先比较约束\n再检查边界')).toBe('先比较约束');
    expect(buildReasoningBlockKey('先比较约束\n再检查边界', 0)).toBe('先比较约束-0');
  });

  it('extracts headings from html, setext and strong-only reasoning blocks', () => {
    expect(extractReasoningHeading('<h3>计划 <code>foo</code></h3>\r\n正文')).toBe('计划 foo');
    expect(extractReasoningHeading('先看边界\r\n-----\r\n再展开')).toBe('先看边界');
    expect(extractReasoningHeading('**只保留标题**')).toBe('只保留标题');
  });

  it('normalizes preview and key fallback for cleaned long first lines', () => {
    const longLine = `- [查看文档](https://example.com) 并整理 \`tool_result\` 输出，${'额外说明'.repeat(20)}`;
    const cleanedFirstLine = `查看文档 并整理 tool result 输出，${'额外说明'.repeat(20)}`;
    const expectedPreview = `${cleanedFirstLine.slice(0, REASONING_UI_TOKENS.previewMaxChars - 1)}…`;
    const expectedKey = `${cleanedFirstLine.slice(0, 48)}-2`;
    const preview = extractReasoningPreview(`${longLine}\n第二行`);

    expect(preview).toBe(expectedPreview);
    expect(buildReasoningBlockKey(`${longLine}\n第二行`, 2)).toBe(expectedKey);
  });

  it('returns unified label and hint copy', () => {
    expect(getReasoningLabel({ index: 0, streaming: true, total: 1 })).toBe('思考中');
    expect(getReasoningLabel({ index: 1, streaming: false, total: 2 })).toBe('思考内容 2');
    expect(getReasoningHint({ charCount: 42, open: false, streaming: true })).toBe(
      '展开查看推理过程',
    );
    expect(getReasoningHint({ charCount: 42, open: false, streaming: false })).toBe('展开 · 42 字');
  });
});
