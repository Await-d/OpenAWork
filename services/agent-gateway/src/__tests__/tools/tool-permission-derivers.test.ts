/**
 * 逐工具权限派生注册表的回归锁定。
 *
 * 这些用例锁定「参数 → scope/reason/riskLevel/previewAction/always」的派生结果，
 * 是 `buildPermissionRequestContext` 从中心 switch 下沉到
 * `permission/tool-permission-derivers.ts` 之后的行为基线。
 *
 * 只 mock 外部 I/O 边界（db / MCP runtime / workspace 校验 / 重依赖工具模块），
 * bash-arity、mcp-tool-naming、mcp-tool-input、tool-path-aliases 走真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { validateWorkspaceOk: true },
  getMcpServerFingerprint: vi.fn(() => 'fp-abc'),
  getConfiguredMcpServerForSession: vi.fn(() => ({
    id: 'github',
    name: 'GitHub',
    transport: 'sse',
    enabled: true,
  })),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/workspace',
  sqliteGet: () => undefined,
  sqliteAll: () => [],
  sqliteRun: () => undefined,
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  callMcpToolForSession: vi.fn(),
  listMcpToolsForSession: vi.fn(async () => []),
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSession,
  getMcpServerFingerprint: mocks.getMcpServerFingerprint,
}));

vi.mock('../../workspace/workspace-safety.js', () => ({
  getSessionWorkingDirectory: () => '/workspace',
  getSessionWorkspaceRoot: () => '/workspace',
  requiresBoundSessionWorkspace: () => false,
  assertSessionWorkingDirectory: () => '/workspace',
  rewriteUnboundPlaceholderPath: (_sessionId: string, path: string) => path,
  validateSessionWorkspacePath: ({ path }: { path: string }) =>
    mocks.state.validateWorkspaceOk
      ? { ok: true, safePath: path, workingDirectory: '/workspace' }
      : { ok: false, reason: 'outside-session-workspace' },
  hasWorkspacePermanentPermission: () => false,
}));

vi.mock('../../tools/apply-patch-tools.js', () => ({
  buildApplyPatchPermissionScope: (patchText: string) => `patch:${patchText.length}`,
}));

vi.mock('../../tools/workspace-tools.js', () => ({
  resolveWorkspaceReviewFilePath: (_rootPath: string, filePath: string) => filePath,
}));

import {
  buildToolPermissionRequestContext,
  listToolPermissionDeriverNames,
  type ToolPermissionDerivationContext,
} from '../../permission/tool-permission-derivers.js';

function ctx(
  toolName: string,
  rawInput: Record<string, unknown> = {},
  sshManaged = false,
): ToolPermissionDerivationContext {
  return { sessionId: 'session-1', toolName, rawInput, sshManaged };
}

beforeEach(() => {
  mocks.state.validateWorkspaceOk = true;
  mocks.getMcpServerFingerprint.mockClear();
  mocks.getConfiguredMcpServerForSession.mockClear();
});

describe('tool permission derivers · 简单任务 / 渠道 / 桌面类', () => {
  const cases: Array<{
    tool: string;
    input: Record<string, unknown>;
    scope: string;
    risk: 'low' | 'medium' | 'high';
  }> = [
    { tool: 'task_create', input: { subject: '修复登录' }, scope: 'task:修复登录', risk: 'medium' },
    { tool: 'task_create', input: {}, scope: 'task:*', risk: 'medium' },
    { tool: 'task_update', input: { id: 't-1' }, scope: 'task:t-1', risk: 'low' },
    { tool: 'task_update', input: {}, scope: 'task:*', risk: 'low' },
    {
      tool: 'call_omo_agent',
      input: { description: 'review' },
      scope: 'agent:review',
      risk: 'high',
    },
    { tool: 'call_omo_agent', input: {}, scope: 'agent:*', risk: 'high' },
    { tool: 'task', input: { description: '子任务' }, scope: 'task:子任务', risk: 'high' },
    {
      tool: 'PluginSendMessage',
      input: { plugin_id: 'telegram', chat_id: 'c-1' },
      scope: 'channel:telegram:c-1:send',
      risk: 'high',
    },
    { tool: 'PluginSendImage', input: {}, scope: 'channel:*:*:send', risk: 'high' },
    {
      tool: 'PluginReplyMessage',
      input: { plugin_id: 'telegram', message_id: 'm-1' },
      scope: 'channel:telegram:reply:m-1',
      risk: 'high',
    },
    {
      tool: 'PluginGetGroupMessages',
      input: { plugin_id: 'telegram', chat_id: 'c-2' },
      scope: 'channel:telegram:c-2:read',
      risk: 'medium',
    },
    { tool: 'FeishuBitableGetRecords', input: {}, scope: 'channel:*:*:read', risk: 'medium' },
    {
      tool: 'desktop_automation',
      input: { action: 'OPEN', url: 'https://example.com' },
      scope: 'open:https://example.com',
      risk: 'high',
    },
    {
      tool: 'desktop_automation',
      input: { action: 'screenshot' },
      scope: 'screenshot',
      risk: 'high',
    },
    {
      tool: 'desktop_control',
      input: { action: 'Click', x: 10, y: 20 },
      scope: 'click:10,20',
      risk: 'high',
    },
    {
      tool: 'desktop_control',
      input: { action: 'key', key: 'Enter' },
      scope: 'key:Enter',
      risk: 'high',
    },
    { tool: 'bash_output', input: { terminal_id: 'term-1' }, scope: 'term-1', risk: 'low' },
    { tool: 'bash_output', input: {}, scope: 'terminal:*', risk: 'low' },
    { tool: 'bash_kill', input: { terminal_id: 'term-2' }, scope: 'term-2', risk: 'medium' },
  ];

  it.each(cases)('$tool → scope $scope', ({ tool, input, scope, risk }) => {
    const out = buildToolPermissionRequestContext(ctx(tool, input));
    expect(out).not.toBeNull();
    expect(out?.scope).toBe(scope);
    expect(out?.riskLevel).toBe(risk);
    expect(out?.always).toEqual(['*']);
    expect(out?.reason).toBeTruthy();
    expect(out?.previewAction).toBeTruthy();
  });
});

describe('tool permission derivers · skill / skill_mcp / mcp_call / flat MCP', () => {
  it('skill：带 name 时 scope=name 且 always=[name]', () => {
    const out = buildToolPermissionRequestContext(ctx('skill', { name: 'frontend' }));
    expect(out).toMatchObject({ scope: 'frontend', always: ['frontend'], riskLevel: 'medium' });
  });

  it('skill：缺 name 时返回 null（不派生上下文）', () => {
    expect(buildToolPermissionRequestContext(ctx('skill', {}))).toBeNull();
  });

  it('skill_mcp：mcp_name + tool_name → scope', () => {
    const out = buildToolPermissionRequestContext(
      ctx('skill_mcp', { mcp_name: 'playwright', tool_name: 'navigate' }),
    );
    expect(out).toMatchObject({ scope: 'playwright:navigate', riskLevel: 'high', always: ['*'] });
  });

  it('skill_mcp：缺字段时返回 null', () => {
    expect(
      buildToolPermissionRequestContext(ctx('skill_mcp', { mcp_name: 'playwright' })),
    ).toBeNull();
  });

  it('mcp_call：scope 带 server fingerprint，always 覆盖 tool 与 server', () => {
    const out = buildToolPermissionRequestContext(
      ctx('mcp_call', { serverId: 'github', toolName: 'create_issue', arguments: {} }),
    );
    expect(out).toMatchObject({
      scope: 'github:create_issue:fp-abc',
      riskLevel: 'high',
      always: ['github:create_issue:*', 'github:*'],
    });
  });

  it('mcp_call：参数非法时返回 null', () => {
    expect(buildToolPermissionRequestContext(ctx('mcp_call', { toolName: 'x' }))).toBeNull();
  });

  it('flat MCP：mcp__<server>__<tool> 与 legacy mcp_call 同 scope', () => {
    const out = buildToolPermissionRequestContext(ctx('mcp__github__create_issue', { title: 'x' }));
    expect(out).toMatchObject({
      scope: 'github:create_issue:fp-abc',
      riskLevel: 'high',
      always: ['github:create_issue:*', 'github:*'],
    });
  });

  it('flat MCP：服务器已移除（查询抛错）时返回 null', () => {
    mocks.getConfiguredMcpServerForSession.mockImplementationOnce(() => {
      throw new Error('server removed');
    });
    expect(buildToolPermissionRequestContext(ctx('mcp__github__create_issue', {}))).toBeNull();
  });
});

describe('tool permission derivers · 文件 / bash / patch 类', () => {
  it('write：workspace 内路径 → 相对 scope', () => {
    const out = buildToolPermissionRequestContext(
      ctx('write', { filePath: '/workspace/src/a.ts' }),
    );
    expect(out).toMatchObject({ scope: 'src/a.ts', riskLevel: 'medium', always: ['*'] });
  });

  it('edit / multi_edit：共用文件类派生，仅 reason/preview 不同', () => {
    const edit = buildToolPermissionRequestContext(
      ctx('edit', { filePath: '/workspace/src/a.ts' }),
    );
    const multi = buildToolPermissionRequestContext(
      ctx('multi_edit', { filePath: '/workspace/src/a.ts' }),
    );
    expect(edit?.scope).toBe('src/a.ts');
    expect(multi?.scope).toBe('src/a.ts');
    expect(edit?.reason).not.toBe(multi?.reason);
  });

  it('write：SSH 远端且本地校验失败 → 用远端路径原文', () => {
    mocks.state.validateWorkspaceOk = false;
    const out = buildToolPermissionRequestContext(ctx('write', { filePath: '/remote/a.ts' }, true));
    expect(out).toMatchObject({ scope: '/remote/a.ts', always: ['*'] });
    expect(out?.previewAction).toContain('SSH 远端');
  });

  it('write：校验失败且非 SSH → null', () => {
    mocks.state.validateWorkspaceOk = false;
    expect(
      buildToolPermissionRequestContext(ctx('write', { filePath: '/remote/a.ts' })),
    ).toBeNull();
  });

  it('bash：scope 为完整命令，always 为 arity 通配模式', () => {
    const out = buildToolPermissionRequestContext(ctx('bash', { command: 'git checkout main' }));
    expect(out?.scope).toBe('git checkout main');
    expect(out?.riskLevel).toBe('high');
    expect(out?.always).toContain('git checkout *');
    expect(out?.always).not.toContain('git checkout main');
  });

  it('interactive_bash：scope 为 tmux 命令', () => {
    const out = buildToolPermissionRequestContext(
      ctx('interactive_bash', { tmux_command: 'tmux new-session -d' }),
    );
    expect(out?.scope).toBe('tmux new-session -d');
    expect(out?.always.length).toBeGreaterThan(0);
  });

  it('run_bash_in_background：scope 为命令本身，不再是截断 JSON（缺陷2 回归）', () => {
    const out = buildToolPermissionRequestContext(
      ctx('run_bash_in_background', { command: 'pnpm test' }),
    );
    expect(out?.scope).toBe('pnpm test');
    expect(out?.scope.startsWith('run_bash_in_background:')).toBe(false);
    expect(out?.always).toContain('pnpm *');
    expect(out?.riskLevel).toBe('high');
  });

  it('run_bash_in_background：缺少 command 时返回 null', () => {
    expect(buildToolPermissionRequestContext(ctx('run_bash_in_background', {}))).toBeNull();
  });

  it('patch：scope 基于补丁内容摘要', () => {
    const out = buildToolPermissionRequestContext(ctx('patch', { patchText: 'abc' }));
    expect(out).toMatchObject({ scope: 'patch:3', riskLevel: 'high', always: ['*'] });
  });

  it('patch：空补丁返回 null', () => {
    expect(buildToolPermissionRequestContext(ctx('patch', { patchText: '   ' }))).toBeNull();
  });

  it('ast_grep_replace：scope 为 ast:lang:pattern', () => {
    const out = buildToolPermissionRequestContext(
      ctx('ast_grep_replace', { pattern: 'console.log', lang: 'ts' }),
    );
    expect(out).toMatchObject({ scope: 'ast:ts:console.log', riskLevel: 'high' });
  });

  it('lsp_rename：scope 为 相对路径:newName', () => {
    const out = buildToolPermissionRequestContext(
      ctx('lsp_rename', { path: '/workspace/src/a.ts', newName: 'bar' }),
    );
    expect(out).toMatchObject({ scope: 'src/a.ts:bar', riskLevel: 'high' });
  });

  it('workspace_create_directory：scope 为相对目录', () => {
    const out = buildToolPermissionRequestContext(
      ctx('workspace_create_directory', { path: '/workspace/src/newdir' }),
    );
    expect(out).toMatchObject({ scope: 'src/newdir', riskLevel: 'medium' });
  });

  it('workspace_review_revert：scope 为回滚目标的相对路径', () => {
    const out = buildToolPermissionRequestContext(
      ctx('workspace_review_revert', { path: '/workspace/proj', filePath: 'src/a.ts' }),
    );
    expect(out).toMatchObject({ scope: 'proj/src/a.ts', riskLevel: 'high' });
  });
});

describe('tool permission derivers · 兜底与注册表', () => {
  it('未登记工具走 default：scope 为 toolName + 截断 JSON，永远 ask（medium）', () => {
    const out = buildToolPermissionRequestContext(ctx('some_future_tool', { a: 1 }));
    expect(out).toMatchObject({
      scope: 'some_future_tool:{"a":1}',
      riskLevel: 'medium',
      always: ['*'],
    });
    expect(out?.reason).toContain('some_future_tool');
  });

  it('注册表包含缺陷2 修复的三个后台 bash 工具', () => {
    const names = listToolPermissionDeriverNames();
    expect(names).toContain('run_bash_in_background');
    expect(names).toContain('bash_output');
    expect(names).toContain('bash_kill');
  });

  it('注册表包含文件 / bash / 渠道 / MCP / 桌面核心工具', () => {
    const names = listToolPermissionDeriverNames();
    for (const name of ['write', 'edit', 'multi_edit', 'bash', 'mcp_call', 'PluginSendMessage']) {
      expect(names).toContain(name);
    }
  });
});
