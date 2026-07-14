import type { AssistantTraceToolCall } from '@openAwork/shared';
import { useEffect, useMemo, useState } from 'react';
import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { ToolIcon } from '../display/tool-icon.js';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { extractFilePath, trimPath } from '../shared/input-paths.js';
import { ToolCallDisplay, type ToolCallDisplayProps } from '../display/tool-call-display.js';

/**
 * Cap on how many group items we list inline before falling back to
 * "+N". Three keeps the pill width bounded on mobile while preserving
 * enough context to recognise the run (e.g. "page.tsx, layout.tsx,
 * api.ts +4").
 */
const MAX_PREVIEW_ITEMS = 3;

/**
 * Truncate a bash-style command string for inline preview. Long
 * commands wrap to ~32 chars and the suffix is replaced with an
 * ellipsis so the pill width stays bounded.
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

export function GroupedToolCallPill({
  toolName,
  calls,
}: {
  toolName: string;
  calls: AssistantTraceToolCall[];
}) {
  const toolCallsExpandedByDefault = useDisplayPreferencesStore(
    (s) => s.toolCallsExpandedByDefault,
  );

  const summary = useMemo(() => {
    const items = calls.map((c) => formatGroupItem(toolName, c.input)).filter((s) => s.length > 0);
    const visible = items.slice(0, MAX_PREVIEW_ITEMS);
    const overflow = items.length - visible.length;
    const itemPart = visible.join(', ');
    return overflow > 0 ? `${itemPart} +${overflow}` : itemPart;
  }, [calls, toolName]);

  const errorCount = useMemo(
    () => calls.filter((c) => c.isError === true || c.status === 'failed').length,
    [calls],
  );
  const hasActiveCalls = useMemo(
    () => calls.some((c) => c.status === 'running' || c.status === 'paused'),
    [calls],
  );
  // Visual: a single error inside a group surfaces as red dot. The
  // detailed per-call status is still visible after expansion.
  const visualState: 'completed' | 'failed' = errorCount > 0 ? 'failed' : 'completed';
  const shouldAutoExpand = toolCallsExpandedByDefault || hasActiveCalls || errorCount > 0;
  const [expanded, setExpanded] = useState(shouldAutoExpand);

  useEffect(() => {
    if (shouldAutoExpand) {
      setExpanded(true);
    }
  }, [shouldAutoExpand]);

  return (
    <div className="tool-call-grouped" data-tool-status={visualState}>
      <button
        type="button"
        className="tool-call-grouped-header"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <ToolIcon toolName={toolName} status={visualState} size={13} />
        <span className="tool-call-grouped-name" data-tool-category={getToolCategory(toolName)}>
          {toolName}
        </span>
        <span className="tool-call-grouped-count">{calls.length} 个</span>
        {errorCount > 0 && <span className="tool-call-grouped-errors">{errorCount} 失败</span>}
        <span className="tool-call-grouped-summary">{colorizeSummary(summary)}</span>
        <span className="tool-call-grouped-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="tool-call-grouped-children">
          {calls.map((c, idx) => {
            // `ToolCallDisplay` only includes optional fields that are
            // actually defined — passing `undefined` is fine, but the
            // downstream `isInlineTool` / `BatchToolCallCard` paths
            // re-route based on toolName so we don't filter here.
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
