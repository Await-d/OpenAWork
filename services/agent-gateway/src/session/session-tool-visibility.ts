import type { DialogueMode } from '@openAwork/shared';
import type { GatewayToolDefinition } from '../tools/tool-definitions.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { parseFlatMcpToolName } from '../mcp/mcp-tool-naming.js';
import { isTaskToolName } from '../task/task-tools.js';
import {
  CHANNEL_SEND_TOOL_NAMES,
  FEISHU_CHANNEL_TOOL_NAMES,
  WEIXIN_CHANNEL_TOOL_NAMES,
} from './channel-tool-visibility-policy.js';
import { isClarifyModeToolAllowed } from './clarify-mode-tool-policy.js';
import { MCP_MANAGE_SERVERS_TOOL_NAME } from '../mcp/mcp-manage-tool-name.js';
import { MEMORY_MANAGE_TOOL_NAME } from '../memory/memory-manage-tool-name.js';
import { SKILL_MANAGE_TOOL_NAME } from '../skill/skill-manage-tool-name.js';
import { PLUGIN_MANAGE_TOOL_NAME } from '../plugin/plugin-manage-tool-name.js';
import { SCHEDULE_MANAGE_TOOL_NAME } from '../cron/schedule-manage-tool-name.js';
import { AGENT_MANAGE_TOOL_NAME } from '../agent/agent-manage-tool-name.js';
import { TEAM_WORKSPACE_MANAGE_TOOL_NAME } from '../team/team-workspace-manage-tool-name.js';
import { getChannelActorPolicy } from '../channels/channel-actor-scope.js';

interface ChannelToolPermissionsLike {
  allowShell?: boolean;
  allowSubAgents?: boolean;
}

type ChannelToolsLike = Record<string, boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readChannelToolAllowlist(
  metadata: Record<string, unknown>,
): readonly string[] | null | undefined {
  // 本轮 run 的成员权限优先：`channelToolAllowlist` 存在**同群共享**的会话
  // metadata 上，会被下一个发言的成员覆盖（详见 channel-actor-scope 的说明）。
  const scopedPolicy = getChannelActorPolicy();
  if (scopedPolicy) {
    return scopedPolicy.toolAllowlist;
  }

  const allowlist = metadata['channelToolAllowlist'];
  if (allowlist === null) {
    return null;
  }
  if (!Array.isArray(allowlist)) {
    return undefined;
  }
  return allowlist.filter((entry): entry is string => typeof entry === 'string');
}

function readChannelTools(metadata: Record<string, unknown>): ChannelToolsLike | null {
  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return null;
  }

  const tools = channel['tools'];
  if (!isRecord(tools)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(tools).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
}

function readChannelPermissions(
  metadata: Record<string, unknown>,
): ChannelToolPermissionsLike | null {
  // 与白名单同理：会话 metadata 里的渠道权限是**最后一位发言者**的成员权限，
  // 本轮必须用自己那份快照，否则同群成员交替发言会互相改权限。
  const scopedPolicy = getChannelActorPolicy();
  if (scopedPolicy) {
    return scopedPolicy.permissions;
  }

  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return null;
  }

  const permissions = channel['permissions'];
  return isRecord(permissions) ? permissions : null;
}

function readChannelType(metadata: Record<string, unknown>): string | null {
  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return null;
  }
  return typeof channel['type'] === 'string' ? channel['type'] : null;
}

function resolveChannelToolKey(toolName: string): string | null {
  // Flat MCP tools (PR-C) inherit the legacy `mcp_call` channel/visibility
  // class so per-session toggles for "MCP" continue to apply uniformly,
  // regardless of whether the model called via `mcp_call` or via the
  // flattened `mcp__<server>__<tool>` direct entry point.
  if (parseFlatMcpToolName(toolName)) {
    return 'mcp';
  }
  switch (toolName) {
    case 'websearch':
    case 'codesearch':
    case 'webfetch':
      return 'web_search';
    case 'list':
    case 'read':
    case 'glob':
    case 'grep':
    case 'lsp_diagnostics':
    case 'lsp_touch':
    case 'lsp_goto_definition':
    case 'lsp_goto_implementation':
    case 'lsp_find_references':
    case 'lsp_symbols':
    case 'lsp_prepare_rename':
    case 'lsp_hover':
    case 'lsp_call_hierarchy':
    case 'codegraph_status':
    case 'codegraph_search':
    case 'codegraph_node':
    case 'codegraph_callers':
    case 'codegraph_impact':
    case 'read_tool_output':
    case 'workspace_review_status':
      return 'read';
    case 'edit':
    case 'write':
    case 'patch':
    case 'lsp_rename':
    case 'workspace_create_directory':
    case 'workspace_review_revert':
      return 'edit';
    case 'workspace_review_diff':
      return 'read';
    case 'bash':
    case 'interactive_bash':
    case 'run_bash_in_background':
      return 'bash';
    case 'mcp_list_tools':
    case 'mcp_call':
      return 'mcp';
    case 'task':
      return 'task';
    default:
      return null;
  }
}

export function isChannelManagedSession(metadata: Record<string, unknown>): boolean {
  return metadata['source'] === 'channel';
}

/**
 * 自助管理类工具（MCP / 记忆 / 技能 / 插件 / Agent / 团队）的会话可见性：
 * 个人会话（含 task 子代理）可见；team / cron / channel 会话不可见。
 */
function isSelfServiceManageToolEnabledForSessionMetadata(
  metadata: Record<string, unknown>,
): boolean {
  const source = metadata['source'];
  if (source === 'cron' || source === 'channel') {
    return false;
  }
  if (typeof metadata['teamWorkspaceId'] === 'string') {
    return false;
  }
  if (isRecord(metadata['teamRoleInstance'])) {
    return false;
  }
  return true;
}

/**
 * `schedule_manage` 的会话可见性。
 *
 * 比其它自助管理工具**多放通一类：渠道会话**。定时任务在渠道场景是刚需
 * （「每天早上把日报发到这个群」），而渠道会话此前被一刀切隐藏该工具，于是
 * 用户只能在设置页手动建任务、无法在群里让 AI 建 / 删，渠道侧配置的
 * `plugin_id` + `plugin_chat_id` 投递字段也就永远填不上。
 *
 * 放通的边界由工具自身守卫承担（`resolveScheduleManageSessionDenial`
 * + `resolveScheduleManageChannelScope`）：渠道会话只能操作**本渠道本会话**
 * 创建的任务，新建时强制把投递目标钉回当前会话。cron（自我复制 / 无人扩权）与
 * team（后台无人审批）仍然拒绝，与原设计一致。
 */
function isScheduleManageToolEnabledForSessionMetadata(metadata: Record<string, unknown>): boolean {
  const source = metadata['source'];
  if (source === 'cron') {
    return false;
  }
  if (typeof metadata['teamWorkspaceId'] === 'string' || isRecord(metadata['teamRoleInstance'])) {
    return false;
  }
  if (source === 'channel') {
    // 渠道会话必须同时通过**两道既有闸门**，不能只看是否启用过 LLM 工具：
    //   1. `channelLlmToolsEnabled`——渠道是否开了 LLM 工具（与其它渠道工具一致）；
    //   2. `channelToolAllowlist`——渠道级白名单。用户在渠道里显式限缩过工具时
    //      （如只留 `PluginSendMessage`），新放通的 `schedule_manage` 不得绕过它，
    //      否则等于给一个「被限制的渠道」偷偷加了管理定时任务的权限。
    if (!areChannelLlmToolDeclarationsEnabled(metadata)) {
      return false;
    }
    return isToolAllowedByChannelAllowlist(
      readChannelToolAllowlist(metadata),
      SCHEDULE_MANAGE_TOOL_NAME,
      resolveChannelToolKey(SCHEDULE_MANAGE_TOOL_NAME),
    );
  }
  return true;
}

function areChannelLlmToolDeclarationsEnabled(metadata: Record<string, unknown>): boolean {
  return !isChannelManagedSession(metadata) || metadata['channelLlmToolsEnabled'] === true;
}

function isToolAllowedByChannelAllowlist(
  allowlist: readonly string[] | null | undefined,
  toolName: string,
  toolKey?: string | null,
): boolean {
  if (allowlist === undefined || allowlist === null) {
    return true;
  }

  return (
    allowlist.includes('*') ||
    allowlist.includes('all') ||
    allowlist.includes(toolName) ||
    (toolKey !== null && toolKey !== undefined && allowlist.includes(toolKey))
  );
}

function isChannelPolicyToolEnabled(metadata: Record<string, unknown>, toolName: string): boolean {
  const isChannelTool = CHANNEL_SEND_TOOL_NAMES.has(toolName);
  const isChannelSession = isChannelManagedSession(metadata);
  if (!isChannelSession) {
    if (isChannelTool) {
      return false;
    }
    return true;
  }

  if (isChannelTool) {
    const channelTools = readChannelTools(metadata);
    if (channelTools?.[toolName] === false) {
      return false;
    }
    if (WEIXIN_CHANNEL_TOOL_NAMES.has(toolName)) {
      return readChannelType(metadata) === 'weixin';
    }
    if (FEISHU_CHANNEL_TOOL_NAMES.has(toolName)) {
      return readChannelType(metadata) === 'feishu';
    }
    return isToolAllowedByChannelAllowlist(readChannelToolAllowlist(metadata), toolName);
  }

  if (toolName === 'desktop_automation' || toolName === 'desktop_control') {
    return false;
  }

  if (!areChannelLlmToolDeclarationsEnabled(metadata)) {
    return false;
  }

  const channelTools = readChannelTools(metadata);
  const toolKey = resolveChannelToolKey(toolName);
  if (!toolKey || channelTools?.[toolKey] !== true) {
    return false;
  }

  if (!isToolAllowedByChannelAllowlist(readChannelToolAllowlist(metadata), toolName, toolKey)) {
    return false;
  }

  const permissions = readChannelPermissions(metadata);
  if (toolKey === 'bash' && permissions?.allowShell !== true) {
    return false;
  }

  if (toolKey === 'task' && permissions?.allowSubAgents !== true) {
    return false;
  }

  return true;
}

export function isTaskToolEnabledForSessionMetadata(metadata: Record<string, unknown>): boolean {
  const explicitTaskToolEnabled = metadata['taskToolEnabled'];
  if (isChannelManagedSession(metadata)) {
    return explicitTaskToolEnabled !== false && isChannelPolicyToolEnabled(metadata, 'task');
  }

  if (typeof explicitTaskToolEnabled === 'boolean') {
    return explicitTaskToolEnabled;
  }

  return metadata['createdByTool'] !== 'task';
}

export function isAgentToolEnabledForSessionMetadata(metadata: Record<string, unknown>): boolean {
  if (isChannelManagedSession(metadata)) {
    return isChannelPolicyToolEnabled(metadata, 'task');
  }

  return metadata['createdByTool'] !== 'task';
}

export function isQuestionToolEnabledForSessionMetadata(
  metadata: Record<string, unknown>,
): boolean {
  // Team 成员 session 在后台运行，无法与用户交互——强制禁用 AskUserQuestion。
  // 判定标准（满足任一即为 team session）：
  //   1. metadata.teamWorkspaceId 存在（watcher 从父 session 继承）
  //   2. metadata.teamRoleInstance 存在（team-session-create.ts 创建时必定写入）
  // 即使 questionToolEnabled 被显式设为 true 也不放行。
  if (typeof metadata['teamWorkspaceId'] === 'string' || isRecord(metadata['teamRoleInstance'])) {
    return false;
  }

  const explicitQuestionToolEnabled = metadata['questionToolEnabled'];
  if (typeof explicitQuestionToolEnabled === 'boolean') {
    return explicitQuestionToolEnabled;
  }

  if (isChannelManagedSession(metadata)) {
    return false;
  }

  return metadata['createdByTool'] !== 'task';
}

export function isPlanModeToolEnabledForSessionMetadata(
  metadata: Record<string, unknown>,
): boolean {
  if (isChannelManagedSession(metadata)) {
    return false;
  }

  return metadata['createdByTool'] !== 'task';
}

export function isTaskToolEnabledForSession(metadataJson: string): boolean {
  return isTaskToolEnabledForSessionMetadata(parseSessionMetadataJson(metadataJson));
}

export function isQuestionToolEnabledForSession(metadataJson: string): boolean {
  return isQuestionToolEnabledForSessionMetadata(parseSessionMetadataJson(metadataJson));
}

export function isGatewayToolEnabledForSessionMetadata(
  toolName: string,
  metadata: Record<string, unknown>,
): boolean {
  // Clarify mode: only allow read-only + questioning tools
  const dialogueMode = metadata['dialogueMode'];
  if (dialogueMode === 'clarify' && !isClarifyModeToolAllowed(toolName)) {
    return false;
  }

  if (
    (toolName === SKILL_MANAGE_TOOL_NAME || toolName === MCP_MANAGE_SERVERS_TOOL_NAME) &&
    isChannelManagedSession(metadata)
  ) {
    return (
      metadata['channelExtensionManagementEnabled'] === true &&
      areChannelLlmToolDeclarationsEnabled(metadata) &&
      typeof metadata['teamWorkspaceId'] !== 'string' &&
      !isRecord(metadata['teamRoleInstance']) &&
      isToolAllowedByChannelAllowlist(readChannelToolAllowlist(metadata), toolName)
    );
  }

  // 自助管理类工具（mcp_manage_servers / memory_manage / skill_manage / plugin_manage /
  // agent_manage / team_workspace_manage）：团队会话后台免审批、cron 无人审批、
  // 渠道会话按最小授权——三类都不该让模型改用户级配置，直接不可见。
  // `schedule_manage` 单独走 `isScheduleManageToolEnabledForSessionMetadata`
  // （渠道会话放通，作用域由工具自身守卫收敛）。
  if (
    toolName === MCP_MANAGE_SERVERS_TOOL_NAME ||
    toolName === MEMORY_MANAGE_TOOL_NAME ||
    toolName === SKILL_MANAGE_TOOL_NAME ||
    toolName === PLUGIN_MANAGE_TOOL_NAME ||
    toolName === AGENT_MANAGE_TOOL_NAME ||
    toolName === TEAM_WORKSPACE_MANAGE_TOOL_NAME
  ) {
    return isSelfServiceManageToolEnabledForSessionMetadata(metadata);
  }

  if (toolName === SCHEDULE_MANAGE_TOOL_NAME) {
    return isScheduleManageToolEnabledForSessionMetadata(metadata);
  }

  if (isTaskToolName(toolName)) {
    return isTaskToolEnabledForSessionMetadata(metadata);
  }

  if (toolName === 'call_omo_agent' || toolName === 'Agent') {
    return isAgentToolEnabledForSessionMetadata(metadata);
  }

  if (toolName === 'question' || toolName === 'AskUserQuestion') {
    return isQuestionToolEnabledForSessionMetadata(metadata);
  }

  if (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode') {
    return isPlanModeToolEnabledForSessionMetadata(metadata);
  }

  return isChannelPolicyToolEnabled(metadata, toolName);
}

export function isGatewayToolEnabledForSession(toolName: string, metadataJson: string): boolean {
  return isGatewayToolEnabledForSessionMetadata(toolName, parseSessionMetadataJson(metadataJson));
}

export function shouldAutoApproveToolForSessionMetadata(
  toolName: string,
  metadata: Record<string, unknown>,
): boolean {
  return (
    isChannelManagedSession(metadata) && isGatewayToolEnabledForSessionMetadata(toolName, metadata)
  );
}

export function filterEnabledGatewayToolsForSession(
  tools: GatewayToolDefinition[],
  metadataJson: string,
): GatewayToolDefinition[] {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (!areChannelLlmToolDeclarationsEnabled(metadata)) {
    return [];
  }

  return tools.filter((tool) =>
    isGatewayToolEnabledForSessionMetadata(tool.function.name, metadata),
  );
}

/**
 * 按本轮有效对话模式收敛工具面（`dialogueMode` 未指定时不施加额外过滤）。
 *
 * 与 `filterEnabledGatewayToolsForSessionMetadata` 的分工：后者读会话元数据里的
 * `dialogueMode`（持久态 / 工具清单类读取路径），本函数按**本轮实际使用的模式**
 * （请求优先、元数据兜底）过滤，保证"提示词用哪个模式，工具面就是哪个模式"。
 */
export function filterEnabledGatewayToolsForDialogueMode(
  tools: GatewayToolDefinition[],
  dialogueMode: DialogueMode | undefined,
): GatewayToolDefinition[] {
  if (dialogueMode !== 'clarify') {
    return tools;
  }

  return tools.filter((tool) => isClarifyModeToolAllowed(tool.function.name));
}
