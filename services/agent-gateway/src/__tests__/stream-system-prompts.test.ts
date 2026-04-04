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

  it('injects dialogue mode and yolo prompts after capability context', () => {
    expect(
      buildRequestScopedSystemPrompts('实现这个接口', '## 系统 Agents\n- hephaestus', {
        dialogueMode: 'programmer',
        yoloMode: true,
      }),
    ).toEqual([
      '## 系统 Agents\n- hephaestus',
      [
        'OpenAWork 对话模式提醒：programmer（程序员）',
        '以工程协作模式回答，优先给实现思路、修改点、调试步骤、验证方式和风险提醒。',
        '优先结合现有代码结构、调用链和影响面给出建议，而不是只讲抽象概念。',
        '可以简短说明取舍，但结论必须面向落地。',
        '如果任务有多个步骤，用简明步骤组织输出。',
      ].join('\n'),
      [
        'OpenAWork 执行偏好提醒：yolo',
        '优先少确认、快执行、直达结果；除非明显缺信息，否则不要反复征询。',
      ].join('\n'),
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
