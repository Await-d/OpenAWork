// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolOutputPreview } from './tool-output-preview.js';

afterEach(cleanup);

/** 虚拟 MCP server 的对象载荷形态：`text` 里是一段 JSON。 */
function mcpJsonPayload(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

describe('ToolOutputPreview · 内置 MCP 通道归一化', () => {
  it('codegraph 的 MCP 通道复用现成的结果卡，不再是一坨 JSON', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__codegraph__codegraph_search"
        output={mcpJsonPayload({
          results: [{ name: 'buildBuiltinMcpServers', kind: 'function' }],
        })}
      />,
    );

    expect(container.querySelector('.cg-result')).not.toBeNull();
    expect(container.querySelector('.cg-symbol')?.textContent).toBe('buildBuiltinMcpServers');
    expect(container.querySelector('.mcp-result')).toBeNull();
  });

  it('legacy mcp_call + serverId=codegraph 走同一条路径', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp_call"
        input={{ serverId: 'codegraph', toolName: 'codegraph_search' }}
        output={mcpJsonPayload({ results: [{ name: 'runAgentTurn', kind: 'function' }] })}
      />,
    );

    expect(container.querySelector('.cg-result')).not.toBeNull();
    expect(container.querySelector('.mcp-result')).toBeNull();
  });

  it('没有内置对应的 MCP 工具仍走 McpResultPreview', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__grep_app__search"
        output={{ content: [{ type: 'text', text: 'no adapter for this server' }] }}
      />,
    );

    expect(container.querySelector('.mcp-result')).not.toBeNull();
    expect(container.textContent).toContain('no adapter for this server');
  });

  it('LSP 扁平名与内置 lsp_* 渲染完全一致', () => {
    // 内置通道直接吃位置文本；MCP 通道把同一段文本包在信封里。归一化后两者 DOM 应当相同。
    const viaMcp = render(
      <ToolOutputPreview
        toolName="mcp__lsp__find_references"
        output={{ content: [{ type: 'text', text: 'services/a.ts:12:4' }] }}
      />,
    );
    const viaBuiltin = render(
      <ToolOutputPreview toolName="lsp_find_references" output="services/a.ts:12:4" />,
    );

    expect(viaMcp.container.innerHTML).toBe(viaBuiltin.container.innerHTML);
    expect(viaMcp.container.querySelector('.mcp-result')).toBeNull();
  });

  it('git_bash 的状态类工具摊成状态卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__git_bash__diagnose"
        output={mcpJsonPayload({
          platform: 'win32',
          enabled: false,
          status: 'missing-git-bash',
          resolution: {
            found: false,
            path: null,
            source: 'not-found',
            checkedPaths: ['C:\\Program Files\\Git\\bin\\bash.exe'],
          },
        })}
      />,
    );

    expect(container.querySelector('.git-bash-status')).not.toBeNull();
    expect(container.textContent).toContain('win32');
    expect(container.textContent).toContain('missing-git-bash');
    expect(container.textContent).toContain('当前环境无法执行 git_bash');
    expect(container.querySelector('.mcp-result')).toBeNull();
  });

  it('git_bash 的 run 输出复用 bash 渲染路径', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__git_bash__run"
        output={mcpJsonPayload({
          exitCode: 0,
          cwd: '/workspace',
          output: 'hello',
          timedOut: false,
        })}
      />,
    );

    expect(container.querySelector('.mcp-result')).toBeNull();
    expect(container.textContent).toContain('hello');
  });

  it('存量 mcp__omo__adapter_catalog 消息回落通用 MCP 预览且不抛错', () => {
    // T-14：omo adapter 已下线、`omo_catalog` 预览分支已删除。历史会话里仍有
    // 这类 tool_call，必须回落到通用 `McpResultPreview`（`.mcp-result`）而不是
    // 抛错或渲染空白。
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__omo__adapter_catalog"
        output={mcpJsonPayload({
          entries: [
            { sourceId: 'codegraph', toolName: 'codegraph', kind: 'stdio-candidate' },
            { sourceId: 'grep_app', toolName: 'grep_app', kind: 'remote-candidate' },
          ],
          nativeAliases: ['context7'],
          diagnostics: [{ source: 'capabilities', code: 'duplicate_id', message: '冲突' }],
        })}
      />,
    );

    // 已删除的 omo 专属渲染通道不再出现。
    expect(container.querySelectorAll('.omo-entry')).toHaveLength(0);
    expect(container.querySelector('.omo-alias')).toBeNull();
    expect(container.querySelector('.omo-diagnostic-code')).toBeNull();
    // 回落到通用 MCP 结果预览（只要渲染出内容即可，不抛错）。
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});
