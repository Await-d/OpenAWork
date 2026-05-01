import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GrantedPermission } from './index.js';

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
    grantedAt?: number;
    scope: string;
    toolName: string;
  },
): WorkspacePermissionConfig {
  const grantedAt = input.grantedAt ?? Date.now();
  const permanentGrants = [...(config.permanentGrants ?? [])];
  const rules = [...(config.rules ?? [])];

  const hasGrant = permanentGrants.some(
    (grant) =>
      grant.toolName === input.toolName &&
      grant.scope === input.scope &&
      grant.decision === 'permanent',
  );
  if (!hasGrant) {
    permanentGrants.push({
      id: `${input.toolName}:${input.scope}:${grantedAt}`,
      toolName: input.toolName,
      scope: input.scope,
      grantedAt,
      decision: 'permanent',
    });
  }

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

  return { ...config, permanentGrants, rules };
}

// ---------------------------------------------------------------------------
// Permission category metadata — defines built-in tool permission categories.
// Matches opencode's config schema: tools self-declare their permission needs,
// and users can override per-category via workspace config.
// ---------------------------------------------------------------------------

export interface PermissionCategoryMeta {
  /** Permission category key (matches rule `permission` field). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Short description of what this category covers. */
  description: string;
  /** Built-in default action when no user rule matches. */
  defaultAction: WorkspacePermissionAction;
  /** Whether this category supports pattern-based sub-rules. */
  supportsPatterns: boolean;
}

export const PERMISSION_CATEGORIES: PermissionCategoryMeta[] = [
  {
    id: 'read',
    label: '读取文件',
    description: '读取工作区文件内容',
    defaultAction: 'allow',
    supportsPatterns: true,
  },
  {
    id: 'edit',
    label: '编辑文件',
    description: '修改现有文件（edit、apply_patch）',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'write',
    label: '写入文件',
    description: '创建或覆盖写入文件',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'bash',
    label: '执行命令',
    description: '运行 Shell 命令',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'glob',
    label: '文件列表',
    description: '列举工作区文件结构',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'grep',
    label: '内容搜索',
    description: '搜索文件内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'task',
    label: '子任务',
    description: '创建和委派子任务',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'skill',
    label: '技能调用',
    description: '执行已安装的技能',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'mcp_call',
    label: 'MCP 工具',
    description: '调用外部 MCP 服务工具',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'lsp',
    label: 'LSP 操作',
    description: '语言服务协议操作（重命名等）',
    defaultAction: 'ask',
    supportsPatterns: true,
  },
  {
    id: 'websearch',
    label: '网页搜索',
    description: '搜索互联网内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'webfetch',
    label: '网页抓取',
    description: '抓取网页内容',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'codesearch',
    label: '代码搜索',
    description: '语义化代码搜索',
    defaultAction: 'allow',
    supportsPatterns: false,
  },
  {
    id: 'desktop_automation',
    label: '桌面自动化',
    description: '控制桌面浏览器操作',
    defaultAction: 'ask',
    supportsPatterns: false,
  },
];

/** Map a tool name to its permission category (like opencode's ctx.ask permission field). */
export function resolvePermissionCategory(toolName: string): string {
  const TOOL_TO_CATEGORY: Record<string, string> = {
    read: 'read',
    workspace_read_file: 'read',
    edit: 'edit',
    multi_edit: 'edit',
    apply_patch: 'edit',
    write: 'write',
    workspace_write_file: 'write',
    workspace_create_file: 'write',
    workspace_create_directory: 'write',
    bash: 'bash',
    interactive_bash: 'bash',
    glob: 'glob',
    grep: 'grep',
    task: 'task',
    task_create: 'task',
    task_update: 'task',
    call_omo_agent: 'task',
    skill: 'skill',
    skill_mcp: 'skill',
    mcp_call: 'mcp_call',
    lsp_rename: 'lsp',
    websearch: 'websearch',
    webfetch: 'webfetch',
    codesearch: 'codesearch',
    workspace_review_revert: 'edit',
    desktop_automation: 'desktop_automation',
  };
  return TOOL_TO_CATEGORY[toolName] ?? toolName;
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
