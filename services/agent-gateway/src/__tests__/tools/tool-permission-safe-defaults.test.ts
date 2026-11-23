import type { ToolCallRequest } from '@openAwork/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRule } from '../../permission/permission-rules.js';
import type * as PermissionRulesModule from '../../permission/permission-rules.js';
import type { PermissionEvaluateEvent } from '../../runtime/plugin-host.js';
import type * as PermissionDecisionLogModule from '../../session/permission-decision-log-store.js';

const mocks = vi.hoisted(() => ({
  rules: [] as PermissionRule[],
  sqliteRun: vi.fn(),
  evaluate: vi.fn<(event: PermissionEvaluateEvent) => Promise<void>>(),
  audit: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: mocks.sqliteRun,
}));
vi.mock('../../workspace/workspace-safety.js', () => ({
  getSessionWorkspaceRoot: () => '/workspace',
  hasWorkspacePermanentPermission: () => false,
  getSessionWorkingDirectory: () => '/workspace',
  requiresBoundSessionWorkspace: () => false,
  assertSessionWorkingDirectory: () => '/workspace',
  rewriteUnboundPlaceholderPath: (_sessionId: string, path: string) => path,
  validateSessionWorkspacePath: ({ path }: { path: string }) => ({ ok: true, safePath: path }),
}));
vi.mock('../../permission/permission-rules.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PermissionRulesModule>()),
  loadWorkspacePermissionRules: () => mocks.rules,
}));
vi.mock('../../permission/permission-grants-store.js', () => ({
  findMatchingPermissionGrant: () => null,
}));
vi.mock('../../permission/permission-contract.js', () => ({
  resolvePermissionRequestTimeoutMs: () => null,
}));
vi.mock('../../tools/sandbox/whitelist.js', async () => {
  const { PERMISSION_CATEGORIES } = await import('@openAwork/agent-core');
  return {
    DEFAULT_PERMISSION_RULES: [
      { permission: '*', pattern: '*', action: 'allow' },
      ...PERMISSION_CATEGORIES.filter((cat) => cat.defaultAction !== 'allow').map((cat) => ({
        permission: cat.id,
        pattern: '*',
        action: cat.defaultAction,
      })),
    ],
  };
});
vi.mock('../../session/session-tool-visibility.js', () => ({
  isChannelManagedSession: () => false,
  shouldAutoApproveToolForSessionMetadata: () => false,
}));
vi.mock('../../tools/apply-patch-tools.js', () => ({
  buildApplyPatchPermissionScope: () => 'patch',
}));
vi.mock('../../tools/workspace-tools.js', () => ({
  resolveWorkspaceReviewFilePath: (_root: string, path: string) => path,
}));
vi.mock('../../runtime/plugin-host.js', () => ({ dispatchPermissionEvaluate: mocks.evaluate }));
vi.mock('../../session/permission-decision-log-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PermissionDecisionLogModule>()),
  recordLadderPermissionDecision: mocks.audit,
}));
vi.mock('../../session/session-run-events.js', () => ({ publishSessionRunEvent: vi.fn() }));
vi.mock('../../tools/sandbox/session-context.js', () => ({
  getSessionMetadata: () => ({}),
  getSessionOwnerUserId: () => null,
  getSessionRoleContext: () => null,
  isBackgroundAutoApprovedTeamSession: () => false,
  isReceptionReadOnlyToolAutoApproved: () => false,
  isUnattendedSessionDelegationAutoApproved: () => false,
}));
// Keep real derivation; isolate the context module's unrelated LSP/runtime imports.
vi.mock('../../tools/sandbox/context.js', async () => {
  const { buildToolPermissionRequestContext } =
    await import('../../permission/tool-permission-derivers.js');
  return {
    buildPermissionRequestContext: (sessionId: string, request: ToolCallRequest) =>
      buildToolPermissionRequestContext({
        sessionId,
        toolName: request.toolName,
        rawInput: request.rawInput as Record<string, unknown>,
        sshManaged: false,
      }),
  };
});
vi.mock('../../mcp/mcp-runtime.js', () => ({
  getConfiguredMcpServerForSession: () => ({ id: 'demo' }),
  getMcpServerFingerprint: () => 'fingerprint',
}));

import { ensurePermissionForTool } from '../../tools/sandbox/permission-ladder.js';

interface SafeCall {
  label: string;
  toolName: string;
  rawInput: Record<string, unknown>;
  category: string;
  scope: string;
}

const safeCalls: SafeCall[] = [
  {
    label: 'Skill name',
    toolName: 'skill',
    rawInput: { name: 'programming' },
    category: 'skill',
    scope: 'programming',
  },
  {
    label: 'Skill alias',
    toolName: 'skill',
    rawInput: { skill: 'programming' },
    category: 'skill',
    scope: 'programming',
  },
  {
    label: 'terminal output',
    toolName: 'bash_output',
    rawInput: { terminal_id: 'term-1' },
    category: 'bash',
    scope: 'term-1',
  },
  {
    label: 'terminal stop',
    toolName: 'bash_kill',
    rawInput: { terminal_id: 'term-1' },
    category: 'bash',
    scope: 'term-1',
  },
  {
    label: 'LSP notification',
    toolName: 'lsp_touch',
    rawInput: { path: '/workspace/file.ts' },
    category: 'edit',
    scope: 'file.ts',
  },
  {
    label: 'skill search',
    toolName: 'skill_manage',
    rawInput: { action: 'search', query: 'test' },
    category: 'skill_manage',
    scope: 'search:new',
  },
  {
    label: 'AST default preview',
    toolName: 'ast_grep_replace',
    rawInput: { lang: 'typescript', pattern: 'foo()', rewrite: 'bar()' },
    category: 'edit',
    scope: 'ast:typescript:foo()',
  },
  {
    label: 'AST explicit preview',
    toolName: 'ast_grep_replace',
    rawInput: { lang: 'typescript', pattern: 'foo()', rewrite: 'bar()', dryRun: true },
    category: 'edit',
    scope: 'ast:typescript:foo()',
  },
  {
    label: 'current title',
    toolName: 'session_rename',
    rawInput: { title: '标题' },
    category: 'session',
    scope: 'session:current',
  },
  {
    label: 'explicit current title',
    toolName: 'session_rename',
    rawInput: { sessionID: 'current', title: '标题' },
    category: 'session',
    scope: 'session:current',
  },
  {
    label: 'skill proposal',
    toolName: 'skill_manage',
    rawInput: { scope: 'session', action: 'install', skillId: 'demo' },
    category: 'skill_manage',
    scope: 'install:demo',
  },
  {
    label: 'MCP add proposal',
    toolName: 'mcp_manage_servers',
    rawInput: { scope: 'session', action: 'add', server: { id: 'demo' } },
    category: 'mcp_manage',
    scope: 'add:demo',
  },
  {
    label: 'MCP update proposal',
    toolName: 'mcp_manage_servers',
    rawInput: { scope: 'session', action: 'update', serverId: 'demo', server: { id: 'demo' } },
    category: 'mcp_manage',
    scope: 'update:demo',
  },
];

function run(toolName: string, rawInput: Record<string, unknown>) {
  return ensurePermissionForTool('current', { toolCallId: 'call', toolName, rawInput }, undefined);
}

describe('精确低风险默认批准（真实派生器 + 权限阶梯）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rules = [];
    mocks.evaluate.mockImplementation(async () => undefined);
  });

  it.each(safeCalls)(
    '$label 默认不产生审批且保留插件与审计',
    async ({ toolName, rawInput, scope }) => {
      expect(await run(toolName, rawInput)).toEqual({ kind: 'not_needed' });
      expect(mocks.sqliteRun).not.toHaveBeenCalled();
      expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ toolName, scope, decision: 'allow' }),
      );
      expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          toolName,
          scope,
          outcome: 'not_needed',
          reason: 'deriver_not_required',
        }),
      );
    },
  );

  it.each(safeCalls)('$label 仍受插件否决', async ({ toolName, rawInput }) => {
    mocks.evaluate.mockImplementation(async (event) => {
      event.effect = 'deny';
    });
    expect(await run(toolName, rawInput)).toMatchObject({ kind: 'denied' });
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reason: 'plugin_denied' }),
    );
  });

  describe.each(['deny', 'ask'] as const)('显式 %s 优先', (action) => {
    it.each(safeCalls)('$label 遵循全局通配规则', async ({ toolName, rawInput }) => {
      mocks.rules = [{ permission: '*', pattern: '*', action }];
      expect(await run(toolName, rawInput)).toMatchObject({
        kind: action === 'deny' ? 'denied' : 'pending',
      });
    });

    it.each(safeCalls)('$label 遵循旧类别的通配规则', async ({ toolName, rawInput, category }) => {
      mocks.rules = [{ permission: category, pattern: '*', action }];
      expect(await run(toolName, rawInput)).toMatchObject({
        kind: action === 'deny' ? 'denied' : 'pending',
      });
    });

    it.each(safeCalls)(
      '$label 遵循真实作用域规则',
      async ({ toolName, rawInput, category, scope }) => {
        mocks.rules = [{ permission: category, pattern: scope, action }];
        expect(await run(toolName, rawInput)).toMatchObject({
          kind: action === 'deny' ? 'denied' : 'pending',
        });
      },
    );

    it.each(
      safeCalls.filter(({ toolName }) => toolName === 'lsp_touch' || toolName === 'session_rename'),
    )('$label 保留历史 JSON 作用域限制', async ({ toolName, rawInput, category }) => {
      mocks.rules = [
        {
          permission: category,
          pattern: `${toolName}:${JSON.stringify(rawInput).slice(0, 200)}`,
          action,
        },
      ];
      expect(await run(toolName, rawInput)).toMatchObject({
        kind: action === 'deny' ? 'denied' : 'pending',
      });
    });
  });

  it.each(safeCalls)(
    '$label 不受未匹配的 ask 规则影响',
    async ({ toolName, rawInput, category }) => {
      mocks.rules = [{ permission: category, pattern: 'unrelated-scope', action: 'ask' }];
      expect(await run(toolName, rawInput)).toEqual({ kind: 'not_needed' });
    },
  );

  it.each([
    ['skill_mcp', { mcp_name: 'demo', tool_name: 'read' }],
    ['bash', { command: 'pwd' }],
    ['interactive_bash', { tmux_command: 'list-sessions' }],
    ['run_bash_in_background', { command: 'pwd' }],
    ['ast_grep_replace', { lang: 'typescript', pattern: 'foo()', rewrite: 'bar()', dryRun: false }],
    [
      'ast_grep_replace',
      { lang: 'typescript', pattern: 'foo()', rewrite: 'bar()', dryRun: 'false' },
    ],
    ['session_rename', { sessionID: 'other', title: '标题' }],
    ['session_move', { directory: '/workspace/other' }],
    ['skill_manage', { action: 'install', skillId: 'demo' }],
    ['skill_manage', { scope: 'user', action: 'install', skillId: 'demo' }],
    ['skill_manage', { scope: 'session', action: 'disable', skillId: 'demo' }],
    ['mcp_manage_servers', { action: 'add', server: { id: 'demo' } }],
    ['mcp_manage_servers', { scope: 'user', action: 'update', serverId: 'demo' }],
    ['mcp_manage_servers', { scope: 'session', action: 'remove', serverId: 'demo' }],
    ['mcp_call', { serverId: 'demo', toolName: 'read', arguments: {} }],
    ['mcp__demo__read', {}],
    ['repo_overview', { path: '/workspace' }],
    ['extract_media_info', { source: '/workspace/file.mp4' }],
    ['convert_media', { source: '/workspace/file.mp4', targetFormat: 'mp3' }],
    ['extract_video_frame', { source: '/workspace/file.mp4' }],
    ['task_create', { subject: 'task' }],
    ['task_update', { id: 'task' }],
    ['unknown_tool', {}],
  ] satisfies Array<[string, Record<string, unknown>]>)(
    '%s 相邻高风险或未证实安全操作仍 ask %#',
    async (toolName, rawInput) => {
      expect(await run(toolName, rawInput)).toMatchObject({ kind: 'pending' });
      expect(mocks.evaluate).toHaveBeenCalledWith(expect.objectContaining({ decision: 'ask' }));
    },
  );
});
