import { PRESENTED_TO_CANONICAL } from '../claude-code/claude-code-tool-surface-profiles.js';
import { stripFunctionsNamespacePrefix } from '../tools/legacy-tool-name-rewrite.js';

const LEGACY_ENABLED_TOOL_NAME_MAP = {
  // 子代理工具的历史别名（canonical 为上游名 `subagent`）。
  // 全仓唯一保留的运行期双名：存量会话与历史 tool_call 仍会带 `task`，
  // 删掉会让这些调用被启用门禁拒绝（见 tools/legacy-tool-name-rewrite.ts
  // 的说明——改名表已清空，这里只做「同一工具的两个历史名字」归一）。
  task: 'subagent',
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
