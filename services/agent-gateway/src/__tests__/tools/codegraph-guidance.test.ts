import { describe, expect, it } from 'vitest';
import {
  CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  buildRequestScopedSystemPrompts,
} from '../../routes/stream-system-prompts.js';
import { buildLayerCapabilitySummary } from '../../team/team-layer-capability-summary.js';

describe('codegraph guidance', () => {
  it('treats codegraph as discovery cache while preserving LSP/grep/read fallbacks', () => {
    const prompts = buildRequestScopedSystemPrompts('请分析这个重构影响面', '', {
      dialogueMode: 'programmer',
    });
    const joined = prompts.join('\n');

    expect(joined).toContain('codegraph_status');
    expect(joined).toContain('发现缓存');
    expect(joined).toContain('lsp_*');
    expect(joined).toContain('ast_grep_search');
    expect(joined).toContain('grep');
    expect(joined).toContain('read');
    expect(joined).toContain('codegraph_index 只写 gateway data dir');
  });

  it('keeps clarify guidance read-only and fallback-aware', () => {
    expect(CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('codegraph_search');
    expect(CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('回退到 lsp_*');
    expect(CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('澄清模式下禁止');
  });

  it('keeps regular LSP guidance fallback-aware', () => {
    expect(LSP_TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('codegraph_impact');
    expect(LSP_TOOL_GUIDANCE_SYSTEM_PROMPT).toContain('不能作为编辑/删除的正确性证明');
  });

  it('surfaces codegraph in team read capability labels', () => {
    const executor = buildLayerCapabilitySummary('executor');
    const read = executor?.toolsetCategories.find((toolset) => toolset.id === 'read');
    expect(read?.description).toContain('codegraph');
  });
});
