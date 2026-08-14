/**
 * 工具提示词系统集成测试
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../prompt/system-prompt-builder.js';

describe('工具提示词系统集成', () => {
  it('应该包含 LSP 工具使用指南', async () => {
    const enabledTools = new Set(['lsp_diagnostics', 'lsp_touch']);

    const prompt = await buildSystemPrompt({
      enabledTools,
      model: 'claude-sonnet-4',
    });

    const fullPrompt = prompt.join('\n\n');

    expect(fullPrompt).toContain('LSP 工具使用指南');
    expect(fullPrompt).toContain('lsp_diagnostics');
  });

  it('应该包含动态边界标记', async () => {
    const prompt = await buildSystemPrompt({
      enabledTools: new Set(),
      model: 'claude-sonnet-4',
    });

    expect(prompt).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  });

  it('提示词应该有正确的结构', async () => {
    const enabledTools = new Set(['lsp_diagnostics']);
    const prompt = await buildSystemPrompt({
      enabledTools,
      model: 'claude-sonnet-4',
    });

    const boundaryIndex = prompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    expect(boundaryIndex).toBeGreaterThan(0);

    // 工具使用指南应该在边界之前（静态部分）
    const toolGuideIndex = prompt.findIndex(p => p.includes('工具使用指南'));
    expect(toolGuideIndex).toBeLessThan(boundaryIndex);
  });
});
