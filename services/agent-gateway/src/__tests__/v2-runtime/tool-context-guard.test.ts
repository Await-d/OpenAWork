import { describe, expect, it } from 'vitest';
import { Message, ToolResultPart } from '@openAwork/opencode-llm';
import { guardNativeToolContext } from '../../v2-runtime/upstream/tool-context-guard.js';

describe('上游工具上下文最终门禁', () => {
  it('直接构造的原生超长工具结果也会在上游边界投影', () => {
    const messages = [
      Message.tool(
        ToolResultPart.make({ id: 'call-1', name: 'custom', result: 'x'.repeat(50_000) }),
      ),
    ];

    const guarded = guardNativeToolContext(messages);
    const part = guarded[0]?.content[0];
    expect(part?.type).toBe('tool-result');
    if (part?.type !== 'tool-result') throw new Error('缺少工具结果');
    expect(String(part.result.value).length).toBeLessThanOrEqual(8_192);
    expect(String(part.result.value)).toContain('read_tool_output');
  });

  it('大量原生工具结果也受累计预算约束', () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      Message.tool(
        ToolResultPart.make({ id: `call-${index}`, name: 'custom', result: 'x'.repeat(8_000) }),
      ),
    );
    const guarded = guardNativeToolContext(messages);
    const chars = guarded
      .flatMap((message) => message.content)
      .reduce(
        (sum, part) => sum + (part.type === 'tool-result' ? String(part.result.value).length : 0),
        0,
      );
    expect(chars).toBeLessThanOrEqual(48_000);
  });
});
