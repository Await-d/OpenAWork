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

export function isEnabledToolName(
  toolName: string,
  enabledToolNames: ReadonlySet<string>,
): boolean {
  if (enabledToolNames.has(toolName)) {
    return true;
  }

  const mappedToolName =
    LEGACY_ENABLED_TOOL_NAME_MAP[toolName as keyof typeof LEGACY_ENABLED_TOOL_NAME_MAP];
  if (!mappedToolName) {
    return false;
  }

  return enabledToolNames.has(mappedToolName);
}
