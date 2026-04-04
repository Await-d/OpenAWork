import { describe, expect, it } from 'vitest';

import {
  buildRequestScopedSystemPrompts,
  buildRoundSystemMessages,
} from '../routes/stream-system-prompts.js';
import { ANALYZE_MODE_MESSAGE } from '@openAwork/agent-core';

describe('stream system prompt integration', () => {
  it('adds analyze injected prompt before capability context', () => {
    const result = buildRequestScopedSystemPrompts(
      'please analyze this bug',
      '## 系统 Agents\n- oracle',
    );
    expect(result[0]).toBe(ANALYZE_MODE_MESSAGE);
    expect(result[1]).toBe('## 系统 Agents\n- oracle');
    expect(result.some((p) => p.startsWith('LSP 工具使用策略'))).toBe(true);
  });

  it('still injects capability context for normal messages', () => {
    const result = buildRequestScopedSystemPrompts('hello world', '## 系统 Agents\n- oracle');
    expect(result[0]).toBe('## 系统 Agents\n- oracle');
    expect(result.some((p) => p.startsWith('LSP 工具使用策略'))).toBe(true);
  });

  it('injects dialogue mode and yolo prompts after capability context', () => {
    const result = buildRequestScopedSystemPrompts('实现这个接口', '## 系统 Agents\n- hephaestus', {
      dialogueMode: 'programmer',
      yoloMode: true,
    });
    expect(result[0]).toBe('## 系统 Agents\n- hephaestus');
    expect(result.some((p) => p.startsWith('LSP 工具使用策略'))).toBe(true);
    expect(result.some((p) => p.startsWith('OpenAWork 对话模式提醒：programmer'))).toBe(true);
    expect(result.some((p) => p.startsWith('OpenAWork 执行偏好提醒：yolo'))).toBe(true);
  });

  it('describes LSP fallback and forbidden automatic actions explicitly', () => {
    const result = buildRequestScopedSystemPrompts('帮我定位这个符号', '## 系统 Agents\n- oracle');
    const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain(
      '如果 LSP 工具返回"No definition found"/"No implementation found"/"No references found"/"No symbols found"/"No hover information available"，回退到 grep + read 组合',
    );
    expect(guidance).toContain('不是所有文件类型都支持');
    expect(guidance).toContain('绝不自动执行 rename，必须是用户明确要求');
    expect(guidance).toContain(
      '不要每轮自动调用 lsp_goto_definition/lsp_find_references/lsp_symbols',
    );
  });

  it('includes lsp_hover in the semantic query guidance', () => {
    const result = buildRequestScopedSystemPrompts('查看类型信息', '## 系统 Agents\n- oracle');
    const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain('lsp_hover');
    expect(guidance).toContain('查看符号类型签名/文档 → lsp_hover');
  });

  it('includes lsp_goto_implementation in the semantic query guidance', () => {
    const result = buildRequestScopedSystemPrompts('查找实现', '## 系统 Agents\n- oracle');
    const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain('lsp_goto_implementation');
    expect(guidance).toContain(
      '查找接口/抽象方法的具体实现 → lsp_goto_implementation（而非 lsp_goto_definition）',
    );
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

  it('inserts memory block after request prompts and before tool-output guidance', () => {
    expect(
      buildRoundSystemMessages({
        workspaceCtx: '<workspace />',
        routeSystemPrompt: 'route prompt',
        requestSystemPrompts: ['prompt-a'],
        memoryBlock: '<user-memory>\n- [fact] stack: openawork\n</user-memory>',
        shouldGuideToolOutputReadback: true,
      }),
    ).toEqual([
      { role: 'system', content: '<workspace />' },
      { role: 'system', content: 'route prompt' },
      { role: 'system', content: 'prompt-a' },
      { role: 'system', content: '<user-memory>\n- [fact] stack: openawork\n</user-memory>' },
      {
        role: 'system',
        content:
          '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。',
      },
    ]);
  });
});
