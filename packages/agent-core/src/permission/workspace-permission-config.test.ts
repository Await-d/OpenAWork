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
    expect(resolvePermissionCategory('apply_patch')).toBe('edit');
    expect(resolvePermissionCategory('write')).toBe('write');
    expect(resolvePermissionCategory('bash')).toBe('bash');
    expect(resolvePermissionCategory('interactive_bash')).toBe('bash');
    expect(resolvePermissionCategory('task')).toBe('task_run');
    expect(resolvePermissionCategory('skill')).toBe('skill');
    expect(resolvePermissionCategory('skill_mcp')).toBe('skill');
    expect(resolvePermissionCategory('mcp_call')).toBe('mcp_call');
    expect(resolvePermissionCategory('lsp_rename')).toBe('lsp');
    expect(resolvePermissionCategory('desktop_automation')).toBe('desktop_automation');
    expect(resolvePermissionCategory('workspace_review_revert')).toBe('edit');
    expect(resolvePermissionCategory('ast_grep_replace')).toBe('edit');
  });

  it('maps custom_ prefix tools to the custom category', () => {
    expect(resolvePermissionCategory('custom_foo')).toBe('custom');
    expect(resolvePermissionCategory('custom_my_tool_doStuff')).toBe('custom');
  });

  it('falls through to the raw tool name for unmapped tools', () => {
    // `task_get`, `task_list`, `mcp_list_tools`, `look_at`, etc.
    // intentionally have no entry — read-only / metadata-only tools
    // are fine being auto-allowed.
    expect(resolvePermissionCategory('task_list')).toBe('task_list');
    expect(resolvePermissionCategory('look_at')).toBe('look_at');
    expect(resolvePermissionCategory('mcp_list_tools')).toBe('mcp_list_tools');
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

  it("keeps 'ask' for the originally-mapped categories", () => {
    expect(effectiveActionFor('edit')).toBe('ask');
    expect(effectiveActionFor('write')).toBe('ask');
    expect(effectiveActionFor('bash')).toBe('ask');
    expect(effectiveActionFor('skill_mcp')).toBe('ask');
    expect(effectiveActionFor('mcp_call')).toBe('ask');
    expect(effectiveActionFor('lsp_rename')).toBe('ask');
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
