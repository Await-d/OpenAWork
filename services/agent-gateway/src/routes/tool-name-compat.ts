import { PRESENTED_TO_CANONICAL } from '../claude-code/claude-code-tool-surface-profiles.js';
import { stripFunctionsNamespacePrefix } from '../tools/legacy-tool-name-rewrite.js';

const LEGACY_ENABLED_TOOL_NAME_MAP = {
  execute_shell: 'bash',
  web_search: 'websearch',
  workspace_tree: 'list',
  workspace_read_file: 'read',
  workspace_search: 'grep',
  workspace_write_file: 'write',
  workspace_create_file: 'write',
} as const;

export function normalizeToolNameForEnablement(toolName: string): string {
  // Legacy OpenAI function-calling payloads namespace names as `functions.<name>`;
  // mirror the sandbox rewrite here so the enablement gate accepts them too.
  const unprefixedName = stripFunctionsNamespacePrefix(toolName);
  const canonicalName = PRESENTED_TO_CANONICAL[unprefixedName] ?? unprefixedName;
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
