import { describe, expect, it } from 'vitest';

import {
  buildRequestScopedSystemPrompts,
  buildRoundSystemMessages,
  injectSyntheticRequestContext,
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

  it('inserts companion prompt after capability context when provided', () => {
    const result = buildRequestScopedSystemPrompts(
      '使用 /buddy 看一下',
      '## 系统 Agents\n- hephaestus',
      {
        companionPrompt: 'OpenAWork companion 上下文：\nBuddy 已进入当前上下文。',
      },
    );

    expect(result[0]).toBe('## 系统 Agents\n- hephaestus');
    expect(result[1]).toBe('OpenAWork companion 上下文：\nBuddy 已进入当前上下文。');
    expect(result.some((p) => p.startsWith('LSP 工具使用策略'))).toBe(true);
  });

  it('describes LSP fallback and forbidden automatic actions explicitly', () => {
    const result = buildRequestScopedSystemPrompts('帮我定位这个符号', '## 系统 Agents\n- oracle');
    const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain(
      '如果 LSP 工具返回"No definition found"/"No implementation found"/"No references found"/"No symbols found"/"No hover information available"/"No call hierarchy found"/"No incoming calls found"/"No outgoing calls found"，回退到 grep + read 组合',
    );
    expect(guidance).toContain('不是所有文件类型都支持');
    expect(guidance).toContain('绝不自动执行 rename，必须是用户明确要求');
    expect(guidance).toContain(
      '不要每轮自动调用 lsp_goto_definition/lsp_find_references/lsp_symbols/lsp_call_hierarchy',
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

  it('includes lsp_call_hierarchy in the semantic query guidance', () => {
    const result = buildRequestScopedSystemPrompts('查看调用关系', '## 系统 Agents\n- oracle');
    const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain('lsp_call_hierarchy');
    expect(guidance).toContain('查看函数的调用关系（谁调用了它/它调用了谁） → lsp_call_hierarchy');
  });

  it('builds 2-part system messages with stable prefix and dynamic suffix', () => {
    const result = buildRoundSystemMessages({
      workspaceCtx: '<workspace />',
      routeSystemPrompt: 'route prompt',
      lspGuidance: 'LSP 工具使用策略',
      dialogueModePrompt: 'OpenAWork 对话模式提醒：programmer',
      yoloModePrompt: 'OpenAWork 执行偏好提醒：yolo',
    });
    // 2 system messages: stable prefix + dynamic suffix
    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('system');
    expect(result[1]!.role).toBe('system');
    // Stable prefix contains workspace, route, lsp, dialogue, yolo, tool-output-ref
    expect(result[0]!.content).toContain('<workspace />');
    expect(result[0]!.content).toContain('route prompt');
    expect(result[0]!.content).toContain('LSP 工具使用策略');
    expect(result[0]!.content).toContain('OpenAWork 对话模式提醒：programmer');
    expect(result[0]!.content).toContain('OpenAWork 执行偏好提醒：yolo');
    expect(result[0]!.content).toContain('tool_output_reference');
    // Dynamic suffix contains memory block (compaction summary is now in conversation flow)
    expect(result[1]!.content).toContain('user-memory');
  });

  it('injects synthetic context into last user message', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
      { role: 'user' as const, content: 'do something' },
    ];
    const result = injectSyntheticRequestContext(messages, {
      injectedPrompt: '[analyze-mode]',
      capabilityContext: '## 系统 Agents',
      companionPrompt: 'companion context',
    });
    // Only last user message should be modified
    expect(result[0]!.content).toBe('hello');
    expect(result[2]!.content).toContain('<system-reminder>');
    expect(result[2]!.content).toContain('[analyze-mode]');
    expect(result[2]!.content).toContain('## 系统 Agents');
    expect(result[2]!.content).toContain('companion context');
    expect(result[2]!.content).toContain('</system-reminder>');
    expect(result[2]!.content).toContain('do something');
  });

  it('does not inject synthetic context into tool result messages', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: null },
      { role: 'tool' as const, content: 'result', tool_call_id: 'call_1' },
    ];
    const result = injectSyntheticRequestContext(messages, {
      injectedPrompt: 'extra prompt',
    });
    // Tool messages should not be modified; last user message gets injection
    expect(result[0]!.content).toContain('<system-reminder>');
    expect(result[2]!.content).toBe('result');
  });

  it('returns messages unchanged when no synthetic context', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const result = injectSyntheticRequestContext(messages, {});
    expect(result).toEqual(messages);
  });

  it('uses clarify-specific LSP guidance in clarify mode', () => {
    const result = buildRequestScopedSystemPrompts('帮我分析这个需求', '## 系统 Agents\n- oracle', {
      dialogueMode: 'clarify',
    });
    const guidance = result.find((prompt) => prompt.startsWith('LSP 只读工具使用策略（澄清模式）'));

    expect(guidance).toBeDefined();
    expect(guidance).toContain('lsp_goto_definition');
    expect(guidance).toContain('lsp_hover');
    expect(guidance).toContain('lsp_call_hierarchy');
    expect(guidance).toContain('禁止使用 lsp_rename');
    expect(guidance).not.toContain('绝不自动执行 rename');
  });

  it('uses full LSP guidance in coding and programmer modes', () => {
    for (const mode of ['coding', 'programmer'] as const) {
      const result = buildRequestScopedSystemPrompts('实现功能', '## 系统 Agents', {
        dialogueMode: mode,
      });
      const guidance = result.find((prompt) => prompt.startsWith('LSP 工具使用策略'));

      expect(guidance).toBeDefined();
      expect(guidance).toContain('lsp_rename');
      expect(guidance).toContain('绝不自动执行 rename');
    }
  });

  it('clarify mode prompt contains progressive questioning guidance', () => {
    const result = buildRequestScopedSystemPrompts('创建一个应用', '## 系统 Agents', {
      dialogueMode: 'clarify',
    });
    const clarifyPrompt = result.find((prompt) =>
      prompt.startsWith('OpenAWork 对话模式提醒：clarify'),
    );

    expect(clarifyPrompt).toBeDefined();
    expect(clarifyPrompt).toContain('禁止编写代码');
    expect(clarifyPrompt).toContain('由浅入深');
    expect(clarifyPrompt).toContain('渐进式提问');
    expect(clarifyPrompt).toContain('给出 2-4 个可选方向');
    expect(clarifyPrompt).toContain('切换到编程模式或程序员模式');
    expect(clarifyPrompt).toContain('子任务');
    expect(clarifyPrompt).toContain('仅用于信息获取和问题分析');
  });

  it('always injects tool output reference guidance in stable prefix', () => {
    const result = buildRoundSystemMessages({
      workspaceCtx: null,
      routeSystemPrompt: undefined,
    });
    expect(result).toHaveLength(2);
    // Stable prefix should contain tool output reference
    expect(result[0]!.content).toContain('tool_output_reference');
    // Dynamic suffix should contain memory placeholder (compaction summary is in conversation flow)
    expect(result[1]!.content).toContain('user-memory');
  });

  it('places memory block in dynamic suffix', () => {
    const result = buildRoundSystemMessages({
      workspaceCtx: '<workspace />',
      routeSystemPrompt: 'route prompt',
      memoryBlock: '<user-memory>\n- [fact] stack: openawork\n</user-memory>',
    });
    expect(result).toHaveLength(2);
    // Dynamic suffix should contain the actual memory block
    expect(result[1]!.content).toContain('[fact] stack: openawork');
    // Stable prefix should not contain memory
    expect(result[0]!.content).not.toContain('[fact] stack: openawork');
  });
});
