import type { AssistantTraceToolCall } from '@openAwork/shared';
import { useMemo } from 'react';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';
import { ToolIcon } from '../display/tool-icon.js';
import { getToolCategory } from '../shared/colorize-summary.js';
import { extractFilePath, trimPath } from '../shared/input-paths.js';
import { naturalLanguageGroupSummary } from '../shared/natural-language-summary.js';
import { ToolCallDisplay, type ToolCallDisplayProps } from '../display/tool-call-display.js';

/**
 * Truncate a bash-style command string for inline preview.
 */
function trimCommand(cmd: string, max = 32): string {
  const collapsed = cmd.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Build a single-line label for one call inside a group. The label
 * trades full fidelity for compactness — the user can always expand
 * the pill to see the original tool card.
 *
 * Per-tool shaping rules:
 *   - read / list           → trimmed path
 *   - grep / glob           → "path · 'pattern'" (whichever is present)
 *   - bash                  → trimmed command
 *   - edit / multiedit / write → trimmed path
 */
export function formatGroupItem(toolName: string, input: Record<string, unknown>): string {
  const lower = toolName.trim().toLowerCase();
  const path = extractFilePath(input);

  if (lower === 'bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    return cmd ? trimCommand(cmd) : '';
  }

  if (lower === 'grep' || lower === 'glob') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    if (path && pattern) return `${trimPath(path)} · "${pattern}"`;
    if (pattern) return `"${pattern}"`;
    return path ? trimPath(path) : '';
  }

  // read / edit / multiedit / write / list — all path-shaped.
  return path ? trimPath(path) : '';
}

/**
 * Pill label shown for each group key. MCP / skill / lsp / session /
 * task / todo / web groups may bundle *different* underlying tool
 * names (e.g. mcp_sequential_thinking + mcp_filesystem_read both
 * bucket under 'mcp'), so the header uses the group key's generic
 * label rather than any single call's toolName.
 */
const GROUP_KEY_LABELS: Record<string, string> = {
  mcp: 'MCP 工具',
  skill: '技能',
  lsp: '语言服务',
  session: '会话',
  task: '任务',
  todo: '待办',
  web: '网络',
};

function resolveGroupLabel(groupKey: string, toolName: string): string {
  return GROUP_KEY_LABELS[groupKey] ?? toolName;
}

export function GroupedToolCallPill({
  groupKey,
  toolName,
  calls,
}: {
  /** Shared bucket key resolved by groupConsecutiveTools (e.g. 'mcp', 'read'). */
  groupKey?: string;
  toolName: string;
  calls: AssistantTraceToolCall[];
}) {
  const effectiveKey = groupKey ?? toolName.trim().toLowerCase();
  const shouldExpandByDefault = useToolExpandDefault()(toolName);

  const summary = useMemo(
    () => naturalLanguageGroupSummary(effectiveKey, calls.length),
    [effectiveKey, calls.length],
  );

  const label = useMemo(() => resolveGroupLabel(effectiveKey, toolName), [effectiveKey, toolName]);

  const errorCount = useMemo(
    () => calls.filter((c) => c.isError === true || c.status === 'failed').length,
    [calls],
  );
  const hasActiveCalls = useMemo(
    () => calls.some((c) => c.status === 'running' || c.status === 'paused'),
    [calls],
  );
  const visualState: 'completed' | 'failed' = errorCount > 0 ? 'failed' : 'completed';
  const shouldAutoExpand = shouldExpandByDefault || hasActiveCalls;
  const [expanded, toggleExpanded] = useToolCallExpandState({
    shouldAutoExpand,
    shouldExpandByDefault,
  });

  return (
    <div className="tool-call-grouped" data-tool-status={visualState}>
      <button
        type="button"
        className="tool-call-grouped-header"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <ToolIcon toolName={toolName} status={visualState} size={13} />
        <span className="tool-call-grouped-name" data-tool-category={getToolCategory(toolName)}>
          {summary || label}
        </span>
        {errorCount > 0 && <span className="tool-call-grouped-errors">{errorCount} 失败</span>}
      </button>
      {expanded && (
        <div className="tool-call-grouped-children">
          {calls.map((c, idx) => {
            const props: ToolCallDisplayProps = {
              toolName: c.toolName,
              input: c.input,
            };
            if (c.kind !== undefined) props.kind = c.kind;
            if (c.output !== undefined) props.output = c.output;
            if (c.status !== undefined) props.status = c.status;
            if (c.isError !== undefined) props.isError = c.isError;
            if (c.durationMs !== undefined) props.durationMs = c.durationMs;
            if (c.toolCallId !== undefined) props.toolCallId = c.toolCallId;
            if (c.resumedAfterApproval !== undefined)
              props.resumedAfterApproval = c.resumedAfterApproval;
            return <ToolCallDisplay key={c.toolCallId ?? `${idx}`} {...props} />;
          })}
        </div>
      )}
    </div>
  );
}
