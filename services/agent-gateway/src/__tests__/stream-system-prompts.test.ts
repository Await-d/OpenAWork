import { describe, expect, it } from 'vitest';

import {
  buildRequestScopedSystemPrompts,
  buildRoundSystemMessages,
} from '../routes/stream-system-prompts.js';
import { ANALYZE_MODE_MESSAGE } from '@openAwork/agent-core';

describe('stream system prompt integration', () => {
  it('adds analyze injected prompt before capability context', () => {
    expect(
      buildRequestScopedSystemPrompts('please analyze this bug', '## 系统 Agents\n- oracle'),
    ).toEqual([ANALYZE_MODE_MESSAGE, '## 系统 Agents\n- oracle']);
  });

  it('still injects capability context for normal messages', () => {
    expect(buildRequestScopedSystemPrompts('hello world', '## 系统 Agents\n- oracle')).toEqual([
      '## 系统 Agents\n- oracle',
    ]);
  });

  it('builds upstream system messages in stable order', () => {
    expect(
      buildRoundSystemMessages({
        workspaceCtx: '<workspace />',
        routeSystemPrompt: 'route prompt',
        requestSystemPrompts: ['[analyze-mode]', '## 系统 Agents'],
        shouldGuideToolOutputReadback: true,
      }),
    ).toEqual([
      { role: 'system', content: '<workspace />' },
      { role: 'system', content: 'route prompt' },
      { role: 'system', content: '[analyze-mode]' },
      { role: 'system', content: '## 系统 Agents' },
      {
        role: 'system',
        content:
          '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。',
      },
    ]);
  });
});
