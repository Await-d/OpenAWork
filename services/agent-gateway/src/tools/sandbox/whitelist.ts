/**
 * 工具白名单与输入归一域(261009-tool-sandbox 拆分 P1 / T-04)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:工具参数校验输出格式化、
 * workspace_* legacy 输入归一、文件 / 只读 / 安全兄弟白名单、
 * 会话工作区必备工具、默认权限规则与 `TOOL_WHITELIST` / `DEFAULT_TOOL_TIMEOUT_MS`。
 *
 * 依赖方向:`tool-sandbox.ts` → 本模块(单向)。
 */

import type { ToolCallRequest } from '@openAwork/agent-core';
import { PERMISSION_CATEGORIES } from '@openAwork/agent-core';
import { agentManageToolDefinition } from '../../agent/agent-admin-tools.js';
import { scheduleManageToolDefinition } from '../../cron/schedule-admin-tools.js';
import { mcpManageServersToolDefinition } from '../../mcp/mcp-admin-tools.js';
import type {} from '../../mcp/mcp-server-authorization.js';
import { memoryManageToolDefinition } from '../../memory/memory-admin-tools.js';
import { type PermissionRule } from '../../permission/permission-rules.js';
import { pluginManageToolDefinition } from '../../plugin/plugin-admin-tools.js';
import {
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from '../../session/session-manager-tools.js';
import { skillManageToolDefinition } from '../../skill/skill-admin-tools.js';
import { skillMcpToolDefinition } from '../../skill/skill-mcp-tools.js';
import { teamWorkspaceManageToolDefinition } from '../../team/team-workspace-admin-tools.js';
import {
  assertSessionWorkingDirectory,
  assertSessionWorkspacePath,
} from '../../workspace/workspace-safety.js';
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from '../ast-grep-tools.js';
import { callOmoAgentToolDefinition } from '../call-omo-agent-tools.js';
import { CHANNEL_TOOL_DEFINITIONS } from '../channel-tools.js';
import { CODEGRAPH_TOOL_DEFINITIONS } from '../codegraph-tools.js';
import { convertMediaToolDefinition } from '../convert-media-tool.js';
import { desktopAutomationToolDefinition } from '../desktop-automation.js';
import { desktopControlToolDefinition } from '../desktop-control.js';
import { extractMediaInfoToolDefinition } from '../extract-media-info-tool.js';
import { extractVideoFrameToolDefinition } from '../extract-video-frame-tool.js';
import { generateAudioToolDefinition } from '../generate-audio-tool.js';
import { computerUseToolDefinition } from '../gui/computer-use-tool.js';
import { interactiveBashToolDefinition } from '../interactive-bash-tools.js';
import { lookAtToolDefinition } from '../look-at-tools.js';
import { modelSearchToolDefinition } from '../model-search-tools.js';
import { enterPlanModeToolDefinition, exitPlanModeToolDefinition } from '../plan-mode-tools.js';
import { repoCloneToolDefinition } from '../repo-clone-tools.js';
import { repoOverviewToolDefinition } from '../repo-overview-tools.js';
import {
  bashKillToolDefinition,
  bashOutputToolDefinition,
  runBashInBackgroundToolDefinition,
} from '../run-background-bash-tools.js';
import {
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from '../session-management-tools.js';
import { subTodoReadTool, subTodoWriteTool, todoReadTool, todoWriteTool } from '../todo-tools.js';
import { websearchTool } from '../tool-aliases.js';
import { TOOL_INVOKE_TOOL_NAME, TOOL_SEARCH_TOOL_NAME } from '../tool-folding.js';
import { readToolPathInput } from '../tool-path-aliases.js';
import { webfetchTool } from '../web-tools.js';
import {
  globTool,
  grepTool,
  listTool,
  readTool,
  WORKSPACE_TOOL_NAMES,
} from '../workspace-tools.js';

export function formatToolInputValidationOutput(
  toolName: string,
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): string {
  const details = issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : null;
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
  return `工具 "${toolName}" 参数校验失败：${details}`;
}

export function normalizeWorkspaceManagedRawInput(
  sessionId: string,
  request: ToolCallRequest,
): ToolCallRequest | null {
  if (request.toolName === listTool.name) {
    const parsed = listTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    const path = readToolPathInput(parsed.data);
    if (!path) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        path: assertSessionWorkspacePath({ path, sessionId, allowSkillResourceRead: true }),
      },
    };
  }

  if (request.toolName === readTool.name) {
    const parsed = readTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    const path = readToolPathInput(parsed.data);
    if (!path) {
      return null;
    }
    const normalizedPath = assertSessionWorkspacePath({
      path,
      sessionId,
      allowSkillResourceRead: true,
    });
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        path: normalizedPath,
        ...(parsed.data.filePath !== undefined ? { filePath: normalizedPath } : {}),
      },
    };
  }

  if (request.toolName === globTool.name) {
    const parsed = globTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        ...(parsed.data.path
          ? {
              path: assertSessionWorkspacePath({
                path: parsed.data.path,
                sessionId,
                allowSkillResourceRead: true,
              }),
            }
          : { path: assertSessionWorkingDirectory(sessionId) }),
      },
    };
  }

  if (request.toolName === grepTool.name) {
    const parsed = grepTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        ...(parsed.data.path
          ? {
              path: assertSessionWorkspacePath({
                path: parsed.data.path,
                sessionId,
                allowSkillResourceRead: true,
              }),
            }
          : { path: assertSessionWorkingDirectory(sessionId) }),
      },
    };
  }

  return null;
}

export const FILE_TOOLS = new Set([
  'edit',
  'glob',
  'grep',
  'list',
  'lsp_rename',
  'multi_edit',
  'read',
  'write',
  'workspace_create_directory',
  'workspace_review_diff',
  'workspace_review_status',
  'workspace_review_revert',
]);

/**
 * Workspace tools that only read: these may reach app-owned skill resource
 * roots outside the session workspace. Every other FILE_TOOLS entry keeps the
 * strict session-workspace containment check for both reads and writes.
 */
export const READ_ONLY_WORKSPACE_TOOLS = new Set(['read', 'list', 'glob', 'grep']);

/**
 * Side-effect-free tools that may keep executing after a sibling pauses on a
 * permission request. Read-only siblings are order-independent, so running them
 * early is safe and preserves the user's batch instead of losing them to a
 * synthetic `[Tool execution was interrupted]` result.
 *
 * Everything else (write / edit / bash / task / MCP side effects …) is held back
 * until the pending approval resolves, preserving the model's `tool_use` order
 * semantics for anything that mutates state.
 */
const PERMISSION_SAFE_SIBLING_TOOLS = new Set([
  'read',
  'list',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'look_at',
  'lsp',
]);

export function isPermissionSafeSiblingTool(normalizedToolName: string): boolean {
  return PERMISSION_SAFE_SIBLING_TOOLS.has(normalizedToolName);
}

export const SESSION_WORKSPACE_REQUIRED_TOOLS = new Set([
  'patch',
  'ast_grep_replace',
  'bash',
  'edit',
  'glob',
  'grep',
  'interactive_bash',
  'list',
  'lsp_rename',
  'multi_edit',
  'read',
  'run_bash_in_background',
  'workspace_create_directory',
  'workspace_review_diff',
  'workspace_review_status',
  'workspace_review_revert',
  'write',
]);

// Default permission rules: auto-generated from PERMISSION_CATEGORIES metadata.
// Each category declares its built-in default action (allow/ask/deny).
// Users override via .openawork.permissions.json (last-match-wins).
// Rules use category IDs (not raw tool names); resolvePermissionCategory maps
// tool names → category IDs at evaluation time.
export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  { permission: '*', pattern: '*', action: 'allow' },
  ...PERMISSION_CATEGORIES.filter((cat) => cat.defaultAction !== 'allow').map((cat) => ({
    permission: cat.id,
    pattern: '*',
    action: cat.defaultAction,
  })),
];

export const TOOL_WHITELIST = new Set<string>([
  'patch',
  'bash',
  runBashInBackgroundToolDefinition.name,
  bashOutputToolDefinition.name,
  bashKillToolDefinition.name,
  'codesearch',
  websearchTool.name,
  webfetchTool.name,
  'question',
  'background_output',
  'background_cancel',
  sessionListToolDefinition.name,
  sessionReadToolDefinition.name,
  sessionSearchToolDefinition.name,
  sessionInfoToolDefinition.name,
  sessionRenameToolDefinition.name,
  sessionMoveToolDefinition.name,
  modelSearchToolDefinition.name,
  astGrepSearchToolDefinition.name,
  astGrepReplaceToolDefinition.name,
  interactiveBashToolDefinition.name,
  callOmoAgentToolDefinition.name,
  enterPlanModeToolDefinition.name,
  exitPlanModeToolDefinition.name,
  skillMcpToolDefinition.name,
  lookAtToolDefinition.name,
  'read_tool_output',
  TOOL_SEARCH_TOOL_NAME,
  TOOL_INVOKE_TOOL_NAME,
  'edit',
  // multi_edit 与 edit/write 同属文件编辑家族，之前漏登记（靠 register() 运行时补进
  // 实例白名单才没暴露问题）；静态表补齐，visible/whitelist/category 三者对齐。
  'multi_edit',
  'batch',
  'skill',
  'task',
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  subTodoReadTool.name,
  subTodoWriteTool.name,
  todoReadTool.name,
  todoWriteTool.name,
  'mcp_list_tools',
  'mcp_call',
  mcpManageServersToolDefinition.name,
  memoryManageToolDefinition.name,
  skillManageToolDefinition.name,
  pluginManageToolDefinition.name,
  scheduleManageToolDefinition.name,
  agentManageToolDefinition.name,
  teamWorkspaceManageToolDefinition.name,
  desktopAutomationToolDefinition.name,
  desktopControlToolDefinition.name,
  computerUseToolDefinition.name,
  'generate_image',
  convertMediaToolDefinition.name,
  extractMediaInfoToolDefinition.name,
  extractVideoFrameToolDefinition.name,
  generateAudioToolDefinition.name,
  repoCloneToolDefinition.name,
  repoOverviewToolDefinition.name,
  ...CHANNEL_TOOL_DEFINITIONS.map((tool) => tool.name),
  ...CODEGRAPH_TOOL_DEFINITIONS.map((tool) => tool.name),
  ...WORKSPACE_TOOL_NAMES,
]);
export const DEFAULT_TOOL_TIMEOUT_MS = 30000;
