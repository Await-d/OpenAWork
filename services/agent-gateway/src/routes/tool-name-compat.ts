import { PRESENTED_TO_CANONICAL } from '../claude-code-tool-surface-profiles.js';

const LEGACY_ENABLED_TOOL_NAME_MAP = {
  web_search: 'websearch',
  workspace_tree: 'list',
  workspace_read_file: 'read',
  workspace_search: 'grep',
  workspace_write_file: 'write',
  workspace_create_file: 'write',
  file_read: 'read',
  read_file: 'read',
  file_write: 'write',
  write_file: 'write',
} as const;

export function normalizeToolNameForEnablement(toolName: string): string {
  const canonicalName = PRESENTED_TO_CANONICAL[toolName] ?? toolName;
  return (
    LEGACY_ENABLED_TOOL_NAME_MAP[canonicalName as keyof typeof LEGACY_ENABLED_TOOL_NAME_MAP] ??
    canonicalName
  );
}

export function isEnabledToolName(
  toolName: string,
  enabledToolNames: ReadonlySet<string>,
): boolean {
  if (enabledToolNames.has(toolName)) {
    return true;
  }

  const normalizedToolName = normalizeToolNameForEnablement(toolName);
  if (enabledToolNames.has(normalizedToolName)) {
    return true;
  }

  for (const enabledToolName of enabledToolNames) {
    if (normalizeToolNameForEnablement(enabledToolName) === normalizedToolName) {
      return true;
    }
  }

  return false;
}
