import type { DialogueMode } from '@openAwork/shared';
import type { GatewayToolDefinition } from './tool-definitions.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';

interface ChannelToolPermissionsLike {
  allowShell?: boolean;
  allowSubAgents?: boolean;
}

type ChannelToolsLike = Record<string, boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return null;
  }

  const permissions = channel['permissions'];
  return isRecord(permissions) ? permissions : null;
}

function resolveChannelToolKey(toolName: string): string | null {
  switch (toolName) {
    case 'websearch':
    case 'codesearch':
    case 'webfetch':
      return 'web_search';
    case 'list':
    case 'read':
    case 'file_read':
    case 'read_file':
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
    case 'read_tool_output':
    case 'workspace_tree':
    case 'workspace_read_file':
    case 'workspace_search':
    case 'workspace_review_status':
      return 'read';
    case 'edit':
    case 'write':
    case 'file_write':
    case 'write_file':
    case 'apply_patch':
    case 'lsp_rename':
    case 'workspace_write_file':
    case 'workspace_create_file':
    case 'workspace_create_directory':
    case 'workspace_review_revert':
      return 'edit';
    case 'workspace_review_diff':
      return 'read';
    case 'bash':
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

const CLARIFY_MODE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  // Read-only file tools
  'list',
  'read',
  'glob',
  'grep',
  'read_tool_output',
  // Read-only workspace tools
  'workspace_review_status',
  'workspace_review_diff',
  // Read-only LSP tools
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_hover',
  'lsp_call_hierarchy',
  // Code search
  'codesearch',
  // Web search/fetch
  'websearch',
  'webfetch',
  // Interactive questioning
  'question',
  'AskUserQuestion',
  // Plan mode
  'EnterPlanMode',
  'ExitPlanMode',
  // Session read-only
  'session_list',
  'session_read',
  'session_search',
  'session_info',
  // Todo read-only
  'todoReadTool',
  'subTodoReadTool',
  // Task read-only
  'task_list',
  'task_get',
  // Look at (image/file viewing)
  'look_at',
  // Sub-task/agent for analysis (child sessions inherit clarify restrictions)
  'task',
  'Agent',
]);

function isClarifyModeToolAllowed(toolName: string): boolean {
  return CLARIFY_MODE_ALLOWED_TOOLS.has(toolName);
}

function isChannelManagedSession(metadata: Record<string, unknown>): boolean {
  return metadata['source'] === 'channel';
}

function isChannelPolicyToolEnabled(metadata: Record<string, unknown>, toolName: string): boolean {
  if (!isChannelManagedSession(metadata)) {
    return true;
  }

  if (toolName === 'desktop_automation') {
    return false;
  }

  const channelTools = readChannelTools(metadata);
  const toolKey = resolveChannelToolKey(toolName);
  if (channelTools && toolKey && channelTools[toolKey] !== true) {
    return false;
  }

  const permissions = readChannelPermissions(metadata);
  if (toolName === 'bash' && permissions?.allowShell === false) {
    return false;
  }

  if (toolName === 'task' && permissions?.allowSubAgents === false) {
    return false;
  }

  return true;
}

export function isTaskToolEnabledForSessionMetadata(metadata: Record<string, unknown>): boolean {
  const explicitTaskToolEnabled = metadata['taskToolEnabled'];
  if (typeof explicitTaskToolEnabled === 'boolean') {
    return explicitTaskToolEnabled;
  }

  if (isChannelManagedSession(metadata)) {
    return isChannelPolicyToolEnabled(metadata, 'task');
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

  if (toolName === 'task') {
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

  return tools.filter((tool) =>
    isGatewayToolEnabledForSessionMetadata(tool.function.name, metadata),
  );
}

export function filterEnabledGatewayToolsForDialogueMode(
  tools: GatewayToolDefinition[],
  dialogueMode: DialogueMode,
): GatewayToolDefinition[] {
  if (dialogueMode !== 'clarify') {
    return tools;
  }

  return tools.filter((tool) => isClarifyModeToolAllowed(tool.function.name));
}
