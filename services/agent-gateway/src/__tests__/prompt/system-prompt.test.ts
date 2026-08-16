/**
 * 工具提示词系统集成测试
 */

import { describe, expect, it } from 'vitest';
import { buildToolUsageSections, getEnabledToolSections } from '../../prompt/tool-sections.js';
import { buildSystemPromptChain } from '../../routes/stream-system-prompts.js';

describe('工具提示词系统集成', () => {
  it('按启用工具筛选 LSP 章节', () => {
    const enabledTools = new Set(['lsp_diagnostics', 'lsp_touch']);

    const sections = getEnabledToolSections(enabledTools);
    expect(sections.map((section) => section.title)).toEqual(['LSP 工具']);
    expect(sections.flatMap((section) => section.tools)).toContain('lsp_diagnostics');
    expect(buildToolUsageSections(enabledTools)).not.toBe('');
  });

  it('保持系统提示槽位顺序', () => {
    const prompt = buildSystemPromptChain({
      routeSystemPrompt: 'route',
      workspaceCtx: 'workspace',
      lspGuidance: 'lsp',
      dialogueModePrompt: 'dialogue',
      yoloModePrompt: 'yolo',
      thinkingLanguagePrompt: 'thinking',
    });

    expect(prompt.indexOf('route')).toBeLessThan(prompt.indexOf('workspace'));
    expect(prompt.indexOf('workspace')).toBeLessThan(prompt.indexOf('lsp'));
    expect(prompt.indexOf('lsp')).toBeLessThan(prompt.indexOf('dialogue'));
    expect(prompt.indexOf('dialogue')).toBeLessThan(prompt.indexOf('yolo'));
    expect(prompt.indexOf('yolo')).toBeLessThan(prompt.indexOf('thinking'));
  });
});
