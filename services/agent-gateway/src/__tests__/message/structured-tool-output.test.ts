import { describe, expect, it } from 'vitest';
import { buildToolResultContent } from '../../tools/tool-result-contract.js';

describe('结构化工具输出协议', () => {
  it('保留输出类型和短摘要，同时兼容原始输出字段', () => {
    const result = buildToolResultContent({
      toolCallId: 'structured-call',
      toolName: 'websearch',
      output: { items: Array.from({ length: 100 }, (_, index) => ({ index })) },
      outputKind: 'json',
      outputSummary: '返回 100 条搜索结果。',
      isError: false,
    });
    expect(result.outputKind).toBe('json');
    expect(result.outputSummary).toBe('返回 100 条搜索结果。');
    expect(result.output).toMatchObject({ items: expect.any(Array) });
  });
});
