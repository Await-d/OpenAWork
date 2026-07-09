import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GrantedPermission } from './index.js';
import { TOOL_TO_PERMISSION_CATEGORY } from './tool-category-map.js';

export const WORKSPACE_PERMISSION_FILE = '.openawork.permissions.json';

export type WorkspacePermissionAction = 'allow' | 'deny' | 'ask';

export interface WorkspacePermissionRule {
  permission: string;
  pattern: string;
  action: WorkspacePermissionAction;
}

export interface WorkspacePermissionConfig {
  permanentGrants?: GrantedPermission[];
  rules?: WorkspacePermissionRule[];
}

export function wildcardMatch(str: string, pattern: string): boolean {
  const normalizedStr = (str || '').replaceAll('\\', '/');
  const normalizedPattern = (pattern || '').replaceAll('\\', '/');

  let escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  if (escaped.endsWith(' .*')) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  return new RegExp(`^${escaped}$`, 's').test(normalizedStr);
}

export function evaluateWorkspacePermissionRules(
  permission: string,
  pattern: string,
  ...rulesets: WorkspacePermissionRule[][]
): WorkspacePermissionRule {
  const rules = rulesets.flat();
  let match: WorkspacePermissionRule | undefined;
  for (const rule of rules) {
    if (wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern)) {
      match = rule;
    }
  }
  return match ?? { action: 'ask', permission, pattern: '*' };
}

export function loadWorkspacePermissionConfig(workspaceRoot: string): WorkspacePermissionConfig {
  const filePath = join(workspaceRoot, WORKSPACE_PERMISSION_FILE);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as WorkspacePermissionConfig;
  } catch {
    return {};
  }
}

export function writeWorkspacePermissionConfig(
  workspaceRoot: string,
  value: WorkspacePermissionConfig,
): void {
  writeFileSync(
    join(workspaceRoot, WORKSPACE_PERMISSION_FILE),
    JSON.stringify(value, null, 2),
    'utf8',
  );
}

export function listEffectiveWorkspacePermissionRules(
  config: WorkspacePermissionConfig,
): WorkspacePermissionRule[] {
  const legacyRules = (config.permanentGrants ?? [])
    .filter((grant) => grant.decision === 'permanent')
    .map((grant) => ({
      permission: grant.toolName,
      pattern: grant.scope,
      action: 'allow' as const,
    }));

  return dedupeWorkspacePermissionRules([...legacyRules, ...(config.rules ?? [])]);
}

export function loadWorkspacePermissionRules(workspaceRoot: string): WorkspacePermissionRule[] {
  return listEffectiveWorkspacePermissionRules(loadWorkspacePermissionConfig(workspaceRoot));
}

export function resolveWorkspacePermissionAction(
  toolName: string,
  scope: string,
  rules: WorkspacePermissionRule[],
): WorkspacePermissionAction {
  if (rules.length === 0) {
    return 'ask';
  }
  return evaluateWorkspacePermissionRules(toolName, scope, rules).action;
}

export function hasWorkspacePersistentPermission(
  config: WorkspacePermissionConfig,
  toolName: string,
  scope: string,
): boolean {
  return (
    resolveWorkspacePermissionAction(
      toolName,
      scope,
      listEffectiveWorkspacePermissionRules(config),
    ) === 'allow'
  );
}

export function upsertWorkspacePermanentPermission(
  config: WorkspacePermissionConfig,
  input: {
    /** @deprecated Kept for backwards compat with callers; ignored. */
    grantedAt?: number;
    scope: string;
    toolName: string;
  },
): WorkspacePermissionConfig {
  // Permanent grants are stored exclusively in `rules` so the settings
  // panel (which reads/writes `rules`) is the single source of truth.
  // Legacy `permanentGrants` entries from older config files are still
  // honoured via `listEffectiveWorkspacePermissionRules`, and are
  // migrated to `rules` (and the legacy array cleared) the first time
  // the user saves the settings page — see the PUT
  // `/settings/permission-rules` handler.
  void input.grantedAt;
  const rules = [...(config.rules ?? [])];

  const hasRule = rules.some(
    (rule) =>
      rule.permission === input.toolName && rule.pattern === input.scope && rule.action === 'allow',
  );
  if (!hasRule) {
    rules.push({
      permission: input.toolName,
      pattern: input.scope,
      action: 'allow',
    });
  }

  return { ...config, rules };
}

export { PERMISSION_CATEGORIES, type PermissionCategoryMeta } from './permission-categories.js';

/** Map a tool name to its permission category (like opencode's ctx.ask permission field). */
export function resolvePermissionCategory(toolName: string): string {
  if (toolName in TOOL_TO_PERMISSION_CATEGORY) return TOOL_TO_PERMISSION_CATEGORY[toolName]!;
  if (toolName.startsWith('custom_')) return 'custom';
  return toolName;
}

function dedupeWorkspacePermissionRules(
  rules: WorkspacePermissionRule[],
): WorkspacePermissionRule[] {
  const deduped = new Map<string, WorkspacePermissionRule>();
  for (const rule of rules) {
    deduped.set(`${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`, rule);
  }
  return [...deduped.values()];
}
