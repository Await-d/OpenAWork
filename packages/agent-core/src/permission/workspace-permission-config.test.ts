import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATEGORIES,
  evaluateWorkspacePermissionRules,
  resolvePermissionCategory,
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
