/**
 * 工具折叠（A）单元测试：直连/折叠划分、目录渲染与预算、
 * `tool_invoke` 解包决策（含安全拒绝路径）、开关语义。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import {
  buildFoldedToolSurface,
  DEFERRED_TOOL_NAMES,
  DIRECT_TOOL_NAMES,
  isDeferrableToolName,
  isToolFoldingEnabled,
  renderToolCatalog,
  renderToolSignature,
  resolveToolInvokeRequest,
  shouldFoldTool,
  TOOL_CATALOG_MAX_CHARS_DEFAULT,
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
} from '../../tools/tool-folding.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('折叠划分', () => {
  it('anti-drift：DEFERRED_TOOL_NAMES 必须都是当前真实存在的工具名', () => {
    const names = new Set(buildGatewayToolDefinitions().map((tool) => tool.function.name));
    const stale = [...DEFERRED_TOOL_NAMES].filter((name) => !names.has(name));
    expect(stale).toEqual([]);
  });

  it('直连与折叠集合互斥，且 bash/read/lsp_ 的归属符合预期', () => {
    for (const name of DIRECT_TOOL_NAMES) {
      expect(DEFERRED_TOOL_NAMES.has(name)).toBe(false);
    }
    expect(shouldFoldTool('bash')).toBe(false);
    expect(shouldFoldTool('read')).toBe(false);
    expect(shouldFoldTool('Skill')).toBe(false);
    expect(shouldFoldTool('lsp_symbols')).toBe(true);
    expect(shouldFoldTool('session_read')).toBe(true);
    expect(shouldFoldTool('mcp__websearch__web_search_exa')).toBe(true);
    // 未知/新增工具默认直连，避免漏登记导致模型「看不到也不能调」。
    expect(shouldFoldTool('some_future_tool')).toBe(false);
    expect(isDeferrableToolName('mcp__x__y')).toBe(true);
  });

  it('buildFoldedToolSurface 按上游过滤结果拆分并给出可见名单', () => {
    const tools = buildGatewayToolDefinitions();
    const surface = buildFoldedToolSurface(tools);
    expect(surface.directTools.length).toBeGreaterThan(0);
    expect(surface.deferredTools.length).toBeGreaterThan(0);
    expect(surface.visibleNames).toHaveLength(tools.length);
    expect(surface.visibleNames).toContain('bash');
    expect(surface.visibleNames).toContain('lsp_symbols');
    expect(surface.catalogPrompt).toContain('可折叠工具目录');
    expect(surface.catalogPrompt).toContain('tool_search');
    expect(surface.catalogPrompt).toContain(TOOL_INVOKE_TOOL_NAME);
    // 目录只出现在折叠面里，不是全部工具。
    expect(surface.catalogPrompt).not.toContain('`bash(');
  });
});

describe('目录渲染', () => {
  it('签名渲染包含必填/可选标记与类型', () => {
    const signature = renderToolSignature('demo', {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'integer' },
        mode: { enum: ['a', 'b'] },
      },
      required: ['path'],
    });
    expect(signature).toBe('demo(path: string, limit?: integer, mode?: "a"|"b")');
    expect(renderToolSignature('empty', { type: 'object', properties: {} })).toBe('empty()');
  });

  it('顶级 anyOf 渲染为「必填其一」，避免互斥必填字段被当成全可选', () => {
    const signature = renderToolSignature('codegraph_node', {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        file: { type: 'string' },
        limit: { type: 'integer' },
      },
      anyOf: [
        { type: 'object', required: ['symbol'] },
        { type: 'object', required: ['file'] },
      ],
    });
    expect(signature).toBe(
      'codegraph_node(symbol?: string, file?: string, limit?: integer) [必填其一: symbol | file]',
    );
    const grouped = renderToolSignature('grouped', {
      type: 'object',
      properties: {},
      anyOf: [
        { type: 'object', required: ['a', 'b'] },
        { type: 'object', required: ['c'] },
      ],
    });
    expect(grouped).toBe('grouped() [必填其一: a+b | c]');
  });

  it('目录在预算内截断并提示剩余数量，且对同名集合输出稳定', () => {
    const tools = buildGatewayToolDefinitions();
    const surface = buildFoldedToolSurface(tools, { catalogMaxChars: 600 });
    expect(surface.catalogPrompt.length).toBeLessThan(1_200);
    expect(surface.catalogPrompt).toContain('未内联');
    const again = buildFoldedToolSurface(tools, { catalogMaxChars: 600 });
    expect(again.catalogPrompt).toBe(surface.catalogPrompt);
  });

  it('无折叠工具时目录为空串；默认预算为 8k 字符（≈2000 tokens）', () => {
    expect(renderToolCatalog([])).toBe('');
    expect(TOOL_CATALOG_MAX_CHARS_DEFAULT).toBe(8_000);
  });
});

describe('tool_invoke 解包决策', () => {
  const base = { allowlist: ['session_list', 'lsp_symbols'], isToolEnabled: () => true };

  it('非 tool_invoke 请求原样放过', () => {
    expect(resolveToolInvokeRequest({ ...base, toolName: 'bash', rawInput: {} })).toEqual({
      kind: 'pass',
    });
  });

  it('在 allowlist 内且启用时重写为内层工具', () => {
    expect(
      resolveToolInvokeRequest({
        ...base,
        toolName: TOOL_INVOKE_TOOL_NAME,
        rawInput: { tool: 'lsp_symbols', arguments: { filePath: 'a.ts' } },
      }),
    ).toEqual({ kind: 'rewrite', toolName: 'lsp_symbols', rawInput: { filePath: 'a.ts' } });
  });

  it('arguments 缺省时补空对象', () => {
    expect(
      resolveToolInvokeRequest({
        ...base,
        toolName: TOOL_INVOKE_TOOL_NAME,
        rawInput: { tool: 'session_list' },
      }),
    ).toEqual({ kind: 'rewrite', toolName: 'session_list', rawInput: {} });
  });

  it('不在 allowlist 内 → 拒绝（不降级放行）', () => {
    const decision = resolveToolInvokeRequest({
      ...base,
      toolName: TOOL_INVOKE_TOOL_NAME,
      rawInput: { tool: 'bash', arguments: { command: 'rm -rf /' } },
    });
    expect(decision.kind).toBe('reject');
  });

  it('会话内已禁用 → 拒绝（defense in depth）', () => {
    const decision = resolveToolInvokeRequest({
      toolName: TOOL_INVOKE_TOOL_NAME,
      rawInput: { tool: 'session_list' },
      allowlist: ['session_list'],
      isToolEnabled: () => false,
    });
    expect(decision).toMatchObject({ kind: 'reject' });
    expect((decision as { message: string }).message).toContain('disabled');
  });

  it('不允许嵌套 tool_invoke / tool_search；参数非法直接拒绝', () => {
    for (const inner of [TOOL_INVOKE_TOOL_NAME, TOOL_SEARCH_TOOL_NAME]) {
      expect(
        resolveToolInvokeRequest({
          ...base,
          toolName: TOOL_INVOKE_TOOL_NAME,
          rawInput: { tool: inner, arguments: {} },
        }).kind,
      ).toBe('reject');
    }
    expect(
      resolveToolInvokeRequest({
        ...base,
        toolName: TOOL_INVOKE_TOOL_NAME,
        rawInput: { arguments: {} },
      }).kind,
    ).toBe('reject');
    expect(
      resolveToolInvokeRequest({
        ...base,
        toolName: TOOL_INVOKE_TOOL_NAME,
        rawInput: { tool: 'session_list', arguments: 'not-an-object' },
      }).kind,
    ).toBe('reject');
  });
});

describe('折叠开关', () => {
  it('默认开启；OPENAWORK_DISABLE_TOOL_FOLDING=1 关闭', () => {
    expect(isToolFoldingEnabled()).toBe(true);
    vi.stubEnv('OPENAWORK_DISABLE_TOOL_FOLDING', '1');
    expect(isToolFoldingEnabled()).toBe(false);
    vi.stubEnv('OPENAWORK_DISABLE_TOOL_FOLDING', '0');
    expect(isToolFoldingEnabled()).toBe(true);
  });
});
