import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATEGORIES,
  evaluateWorkspacePermissionRules,
  listEffectiveWorkspacePermissionRules,
  resolvePermissionCategory,
  upsertWorkspacePermanentPermission,
  type WorkspacePermissionConfig,
  type WorkspacePermissionRule,
} from './workspace-permission-config.js';

// Mirror of `DEFAULT_PERMISSION_RULES` in tool-sandbox.ts. Recreating
// the derivation here avoids cross-package imports while still
// asserting the contract the gateway evaluates against — if either
// side drifts, this test should fail.
const DEFAULT_PERMISSION_RULES: WorkspacePermissionRule[] = [
  { permission: '*', pattern: '*', action: 'allow' },
  ...PERMISSION_CATEGORIES.filter((cat) => cat.defaultAction !== 'allow').map((cat) => ({
    permission: cat.id,
    pattern: '*',
    action: cat.defaultAction,
  })),
];

const FEISHU_CHANNEL_TOOL_NAMES = [
  'FeishuSendImage',
  'FeishuSendFile',
  'FeishuListChatMembers',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuBitableListApps',
  'FeishuBitableListTables',
  'FeishuBitableListFields',
  'FeishuBitableGetRecords',
  'FeishuBitableCreateRecords',
  'FeishuBitableUpdateRecords',
  'FeishuBitableDeleteRecords',
] as const;

function effectiveActionFor(toolName: string): string {
  const category = resolvePermissionCategory(toolName);
  return evaluateWorkspacePermissionRules(category, '*', DEFAULT_PERMISSION_RULES).action;
}

describe('resolvePermissionCategory', () => {
  it('routes write-style tools to ask-by-default categories', () => {
    // These were silently auto-allowed before the audit fix because
    // they were missing from TOOL_TO_CATEGORY and fell through to the
    // wildcard `*` allow rule.
    expect(resolvePermissionCategory('multi_edit')).toBe('edit');
    expect(resolvePermissionCategory('task_create')).toBe('task');
    expect(resolvePermissionCategory('task_update')).toBe('task');
    expect(resolvePermissionCategory('call_omo_agent')).toBe('task_run');

    // Already covered before the audit — guard against accidental
    // regressions while we're in the same area.
    expect(resolvePermissionCategory('edit')).toBe('edit');
    expect(resolvePermissionCategory('patch')).toBe('edit');
    expect(resolvePermissionCategory('write')).toBe('write');
    expect(resolvePermissionCategory('bash')).toBe('bash');
    expect(resolvePermissionCategory('interactive_bash')).toBe('bash');
    expect(resolvePermissionCategory('task')).toBe('task_run');
    expect(resolvePermissionCategory('skill')).toBe('skill');
    expect(resolvePermissionCategory('skill_mcp')).toBe('skill');
    expect(resolvePermissionCategory('mcp_call')).toBe('mcp_call');
    expect(resolvePermissionCategory('lsp_rename')).toBe('lsp');
    expect(resolvePermissionCategory('desktop_automation')).toBe('desktop_automation');
    expect(resolvePermissionCategory('desktop_control')).toBe('desktop_control');
    expect(resolvePermissionCategory('workspace_review_revert')).toBe('edit');
    expect(resolvePermissionCategory('ast_grep_replace')).toBe('edit');
    expect(resolvePermissionCategory('PluginSendMessage')).toBe('channel');
    expect(resolvePermissionCategory('PluginReplyMessage')).toBe('channel');
    expect(resolvePermissionCategory('PluginSendImage')).toBe('channel');
    expect(resolvePermissionCategory('WeixinSendImage')).toBe('channel');
    expect(resolvePermissionCategory('WeixinSendFile')).toBe('channel');
    for (const toolName of FEISHU_CHANNEL_TOOL_NAMES) {
      expect(resolvePermissionCategory(toolName)).toBe('channel');
    }
  });

  it('maps custom_ prefix tools to the custom category', () => {
    expect(resolvePermissionCategory('custom_foo')).toBe('custom');
    expect(resolvePermissionCategory('custom_my_tool_doStuff')).toBe('custom');
  });

  it('keeps the raw tool name only for explicitly allow-listed read-only tools', () => {
    // 行为变更说明：历史实现是“未映射 → 原样返回工具名”，而网关
    // DEFAULT_PERMISSION_RULES 的首条通配符 allow 会匹配任意 category，
    // 等价于静默放行——这正是 run_bash_in_background 免审批漏洞的根因。
    // 现在只有 ALLOW_BY_DEFAULT_TOOL_NAMES 显式枚举的只读/会话状态类工具
    // 保留原样返回（同样只命中通配符 allow），其余未知工具一律 fail-closed。
    expect(resolvePermissionCategory('task_list')).toBe('task_list');
    expect(resolvePermissionCategory('look_at')).toBe('look_at');
    expect(resolvePermissionCategory('mcp_list_tools')).toBe('mcp_list_tools');
  });

  it('fails closed to the ask-by-default custom category for unknown tools', () => {
    // 回归锁：任何未注册、也不在显式白名单里的工具（含未来新增工具）都必须
    // 落到 custom（默认 ask），而不是伪装成只读工具被通配符 allow 静默放行。
    expect(resolvePermissionCategory('some_future_tool')).toBe('custom');
    expect(resolvePermissionCategory('run_arbitrary_shell')).toBe('custom');
  });

  it('registers the formerly-unmapped side-effectful tools with ask-by-default categories', () => {
    // 安全审计修复：以下工具此前不在 TOOL_TO_PERMISSION_CATEGORY 中，却能命中
    // 通配符 allow 而免审批。逐个断言，防止再次漏注册。
    expect(resolvePermissionCategory('run_bash_in_background')).toBe('bash');
    expect(resolvePermissionCategory('bash_output')).toBe('bash');
    expect(resolvePermissionCategory('bash_kill')).toBe('bash');
    expect(resolvePermissionCategory('lsp_touch')).toBe('edit');
    expect(resolvePermissionCategory('generate_image')).toBe('custom');
    expect(resolvePermissionCategory('generate_audio')).toBe('custom');
    expect(resolvePermissionCategory('convert_media')).toBe('custom');
    expect(resolvePermissionCategory('extract_media_info')).toBe('custom');
    expect(resolvePermissionCategory('extract_video_frame')).toBe('custom');
    expect(resolvePermissionCategory('repo_clone')).toBe('custom');
    expect(resolvePermissionCategory('repo_overview')).toBe('custom');
  });
});

describe('default permission rule evaluation', () => {
  it("forces 'ask' for the formerly-leaky tool names", () => {
    expect(effectiveActionFor('multi_edit')).toBe('ask');
    expect(effectiveActionFor('task_create')).toBe('ask');
    expect(effectiveActionFor('task_update')).toBe('ask');
    expect(effectiveActionFor('ast_grep_replace')).toBe('ask');
  });

  it("forces 'ask' for custom_ dynamic tools", () => {
    expect(effectiveActionFor('custom_foo')).toBe('ask');
    expect(effectiveActionFor('custom_my_tool_doStuff')).toBe('ask');
  });

  it("keeps 'allow' for read-only / metadata tools", () => {
    expect(effectiveActionFor('read')).toBe('allow');
    expect(effectiveActionFor('glob')).toBe('allow');
    expect(effectiveActionFor('grep')).toBe('allow');
    expect(effectiveActionFor('websearch')).toBe('allow');
    expect(effectiveActionFor('webfetch')).toBe('allow');
    expect(effectiveActionFor('codesearch')).toBe('allow');
    expect(effectiveActionFor('task_list')).toBe('allow');
    expect(effectiveActionFor('mcp_list_tools')).toBe('allow');
  });

  it("forces 'ask' for the formerly-unmapped side-effectful tools", () => {
    // 这些工具此前落到通配符 allow（静默免审批），修复后必须按 ask 走人工确认。
    expect(effectiveActionFor('run_bash_in_background')).toBe('ask');
    expect(effectiveActionFor('bash_output')).toBe('ask');
    expect(effectiveActionFor('bash_kill')).toBe('ask');
    expect(effectiveActionFor('lsp_touch')).toBe('ask');
    expect(effectiveActionFor('generate_image')).toBe('ask');
    expect(effectiveActionFor('generate_audio')).toBe('ask');
    expect(effectiveActionFor('convert_media')).toBe('ask');
    expect(effectiveActionFor('extract_media_info')).toBe('ask');
    expect(effectiveActionFor('extract_video_frame')).toBe('ask');
    expect(effectiveActionFor('repo_clone')).toBe('ask');
    expect(effectiveActionFor('repo_overview')).toBe('ask');
  });

  it("forces 'ask' for unknown tools — fail-closed regression lock", () => {
    // 漏洞回归锁：未注册工具伪装成原始 category 时曾命中通配符 allow；
    // 现在必须回退到 custom 并返回 ask，绝不能是 allow。
    expect(effectiveActionFor('some_future_tool')).toBe('ask');
    expect(effectiveActionFor('run_arbitrary_shell')).toBe('ask');
  });

  it("keeps 'allow' for every explicitly allow-listed benign tool", () => {
    // 显式白名单审计清单：新增/删除条目都必须同时更新这里，防止有人顺手
    // 把只读工具塞进白名单或把白名单工具移出后无人察觉。
    const allowByDefaultTools = [
      'question',
      'background_output',
      'background_cancel',
      'session_list',
      'session_read',
      'session_search',
      'session_info',
      'ast_grep_search',
      'EnterPlanMode',
      'ExitPlanMode',
      'look_at',
      'read_tool_output',
      'batch',
      'lsp_diagnostics',
      'lsp_goto_definition',
      'lsp_goto_implementation',
      'lsp_find_references',
      'lsp_symbols',
      'lsp_prepare_rename',
      'lsp_hover',
      'lsp_call_hierarchy',
      'task_get',
      'task_list',
      'todoread',
      'todowrite',
      'subtodoread',
      'subtodowrite',
      'mcp_list_tools',
      'codegraph_status',
      'codegraph_index',
      'codegraph_search',
      'codegraph_node',
      'codegraph_callers',
      'codegraph_impact',
      'list',
      'workspace_review_status',
      'workspace_review_diff',
    ] as const;

    for (const toolName of allowByDefaultTools) {
      expect(effectiveActionFor(toolName)).toBe('allow');
    }
  });

  it("keeps 'ask' for the originally-mapped categories", () => {
    expect(effectiveActionFor('edit')).toBe('ask');
    expect(effectiveActionFor('write')).toBe('ask');
    expect(effectiveActionFor('bash')).toBe('ask');
    expect(effectiveActionFor('skill_mcp')).toBe('ask');
    expect(effectiveActionFor('mcp_call')).toBe('ask');
    expect(effectiveActionFor('lsp_rename')).toBe('ask');
    expect(effectiveActionFor('desktop_control')).toBe('ask');
  });

  it("forces 'ask' for messaging channel send tools", () => {
    expect(effectiveActionFor('PluginSendMessage')).toBe('ask');
    expect(effectiveActionFor('PluginReplyMessage')).toBe('ask');
    expect(effectiveActionFor('PluginSendImage')).toBe('ask');
    expect(effectiveActionFor('WeixinSendImage')).toBe('ask');
    expect(effectiveActionFor('WeixinSendFile')).toBe('ask');
    for (const toolName of FEISHU_CHANNEL_TOOL_NAMES) {
      expect(effectiveActionFor(toolName)).toBe('ask');
    }
  });
});

describe('upsertWorkspacePermanentPermission', () => {
  it('writes the permanent grant exclusively to `rules` so the settings panel sees it', () => {
    const before: WorkspacePermissionConfig = {};
    const after = upsertWorkspacePermanentPermission(before, {
      toolName: 'bash',
      scope: 'ls *',
    });

    expect(after.rules).toEqual([{ permission: 'bash', pattern: 'ls *', action: 'allow' }]);
    // No longer also writes to the legacy `permanentGrants` array.
    expect(after.permanentGrants ?? []).toEqual([]);
  });

  it('is idempotent — repeated calls do not duplicate the rule', () => {
    let cfg: WorkspacePermissionConfig = {};
    cfg = upsertWorkspacePermanentPermission(cfg, { toolName: 'bash', scope: 'ls *' });
    cfg = upsertWorkspacePermanentPermission(cfg, { toolName: 'bash', scope: 'ls *' });
    cfg = upsertWorkspacePermanentPermission(cfg, { toolName: 'bash', scope: 'ls *' });

    expect(cfg.rules).toEqual([{ permission: 'bash', pattern: 'ls *', action: 'allow' }]);
  });

  it('preserves unrelated pre-existing rules', () => {
    const before: WorkspacePermissionConfig = {
      rules: [{ permission: 'edit', pattern: 'src/**', action: 'ask' }],
    };
    const after = upsertWorkspacePermanentPermission(before, {
      toolName: 'bash',
      scope: 'ls *',
    });

    expect(after.rules).toEqual([
      { permission: 'edit', pattern: 'src/**', action: 'ask' },
      { permission: 'bash', pattern: 'ls *', action: 'allow' },
    ]);
  });

  it('preserves (does not migrate or mutate) legacy permanentGrants on the input config', () => {
    // Migration is the PUT handler's job, not this helper's.
    const before: WorkspacePermissionConfig = {
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'read',
          scope: 'docs/**',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
    };
    const after = upsertWorkspacePermanentPermission(before, {
      toolName: 'bash',
      scope: 'ls *',
    });

    expect(after.permanentGrants).toEqual(before.permanentGrants);
    expect(after.rules).toEqual([{ permission: 'bash', pattern: 'ls *', action: 'allow' }]);
  });
});

describe('listEffectiveWorkspacePermissionRules (legacy compatibility)', () => {
  it('surfaces legacy permanentGrants entries as allow rules so they remain editable', () => {
    const config: WorkspacePermissionConfig = {
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
      rules: [],
    };

    expect(listEffectiveWorkspacePermissionRules(config)).toEqual([
      { permission: 'bash', pattern: 'ls *', action: 'allow' },
    ]);
  });

  it('deduplicates a legacy permanentGrants entry against an equivalent `rules` entry', () => {
    const config: WorkspacePermissionConfig = {
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
      rules: [{ permission: 'bash', pattern: 'ls *', action: 'allow' }],
    };

    expect(listEffectiveWorkspacePermissionRules(config)).toEqual([
      { permission: 'bash', pattern: 'ls *', action: 'allow' },
    ]);
  });

  it('migration round-trip: GET-merged rules + cleared permanentGrants preserves grants', () => {
    // Simulates the GET → PUT round-trip the settings panel performs:
    // 1. Backend GET returns merged effective rules.
    // 2. User saves without changes — UI POSTs that merged list back.
    // 3. PUT handler writes `{ rules, permanentGrants: [] }`.
    // After the round-trip, every previously-granted scope is still
    // honoured, but the file no longer contains the legacy field.
    const legacy: WorkspacePermissionConfig = {
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
    };

    const merged = listEffectiveWorkspacePermissionRules(legacy);
    const afterPut: WorkspacePermissionConfig = {
      ...legacy,
      rules: merged,
      permanentGrants: [],
    };

    expect(afterPut.permanentGrants).toEqual([]);
    expect(listEffectiveWorkspacePermissionRules(afterPut)).toEqual([
      { permission: 'bash', pattern: 'ls *', action: 'allow' },
    ]);
  });

  it('deletion round-trip: clearing rules + permanentGrants removes the grant entirely', () => {
    const legacy: WorkspacePermissionConfig = {
      permanentGrants: [
        {
          id: 'legacy-1',
          toolName: 'bash',
          scope: 'ls *',
          grantedAt: 1700000000000,
          decision: 'permanent',
        },
      ],
    };

    const afterDeletion: WorkspacePermissionConfig = {
      ...legacy,
      rules: [],
      permanentGrants: [],
    };

    expect(listEffectiveWorkspacePermissionRules(afterDeletion)).toEqual([]);
  });
});
