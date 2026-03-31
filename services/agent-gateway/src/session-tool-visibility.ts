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

function isChannelManagedSession(metadata: Record<string, unknown>): boolean {
  return metadata['source'] === 'channel';
}

function isChannelPolicyToolEnabled(metadata: Record<string, unknown>, toolName: string): boolean {
  if (!isChannelManagedSession(metadata)) {
    return true;
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
  if (toolName === 'task') {
    return isTaskToolEnabledForSessionMetadata(metadata);
  }

  if (toolName === 'question') {
    return isQuestionToolEnabledForSessionMetadata(metadata);
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
