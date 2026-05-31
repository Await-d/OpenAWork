import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { ToolIcon } from '../display/tool-icon';
import { formatElapsed } from '../shared/format.js';
import { extractFilePath } from '../shared/input-paths.js';
import { buildGenericInputSummary, summarizeMcpCallInput } from '../shared/input-summary.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';

/* ── BatchToolCallCard ── */

export interface BatchSubResultLike {
  index: number;
  tool: string;
  status: 'running' | 'completed' | 'error' | 'skipped';
  output?: unknown;
  /**
   * Live, growing stdout snapshot for streaming sub-tools (bash). Mirrors
   * BatchSubToolProgress.partialOutput from the backend. Only meaningful
   * while status === 'running'; once the sub-tool finishes the final
   * result lands in `output` and partialOutput is dropped.
   */
  partialOutput?: string;
  isError?: boolean;
  durationMs?: number;
}

export type BatchSubVisualState = 'running' | 'completed' | 'failed' | 'skipped';

export function batchSubVisualState(
  result: BatchSubResultLike | undefined,
  parentTerminalState?: 'completed' | 'failed',
): BatchSubVisualState {
  // No per-sub result data: this happens after a refresh when the batch
  // output was persisted as a truncated string we couldn't parse back into
  // `{ results: [...] }`. Fall back to the parent batch's terminal state so
  // the sub-row doesn't show a perpetual spinner for an already-finished
  // batch. Only default to `running` when the parent itself is still running.
  if (!result) return parentTerminalState ?? 'running';
  if (result.status === 'skipped') return 'skipped';
  if (result.status === 'error' || result.isError === true) return 'failed';
  if (result.status === 'completed') return 'completed';
  return 'running';
}

/**
 * Compact summary string for one batch sub-call shown in the disclosure row.
 * Uses domain-aware helpers so we never leak raw JSON, mirrors what the
 * single-tool inline/block titles do but in a tighter form.
 */
export function batchSubInputSummary(tool: string, input: Record<string, unknown>): string {
  const normalized = tool.trim().toLowerCase();
  if (normalized === 'bash') {
    const command = typeof input.command === 'string' ? (input.command as string) : '';
    if (command) {
      const oneLine = command.replace(/\s+/g, ' ').trim();
      return `$ ${oneLine.length > 64 ? `${oneLine.slice(0, 64)}…` : oneLine}`;
    }
  }
  if (
    normalized === 'workspace_search' ||
    normalized === 'grep' ||
    normalized === 'workspace_grep'
  ) {
    const pattern = input.pattern ?? input.query;
    if (typeof pattern === 'string' && pattern) return pattern;
  }
  if (normalized === 'workspace_glob' || normalized === 'glob') {
    const pattern = input.pattern;
    if (typeof pattern === 'string' && pattern) return pattern;
  }
  const filePath = extractFilePath(input);
  if (filePath) return filePath;
  if (normalized.startsWith('mcp_')) {
    return summarizeMcpCallInput(input) || '';
  }
  return buildGenericInputSummary(input) || '';
}

/**
 * Parse a persisted batch `output` string back into its structured object.
 *
 * The storage layer serializes large tool outputs to a JSON string (and may
 * append a truncation notice when the output exceeds the size cap). When the
 * string is a clean, complete JSON object we can recover the full
 * `{ results: [...] }` shape. When it was truncated mid-string, `JSON.parse`
 * throws — we return `null` so the caller falls back to the empty-results
 * path (the sub-rows still render from the declared `tool_calls` list, just
 * without per-row output/status, which is the best we can do for a
 * truncated payload).
 */
export function parseBatchOutputString(output: string): unknown {
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Build a BashExecutionResult-shaped synthetic output from partialOutput so
 * BashTerminalCard renders the live, growing stdout while the sub-tool is
 * still running. We mark `mode: 'live'` and leave `exitCode` unset — the
 * card uses these signals to skip the "exit code 0" footer + render a
 * spinner-friendly header.
 */
export function buildPartialBashOutput(
  input: Record<string, unknown>,
  partialOutput: string,
): Record<string, unknown> {
  const command = typeof input.command === 'string' ? (input.command as string) : '';
  return {
    command,
    output: partialOutput,
    mode: 'live',
    truncated: false,
  };
}

/**
 * Renderer for a single batch sub-call row. The actual nested ToolCallDisplay
 * is injected by the parent to avoid a circular import (BatchToolCallCard →
 * ToolCallDisplay → BatchToolCallCard).
 */
type RenderToolCallDisplay = (props: {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: ToolCallCardProps['status'];
  isError: boolean;
  kind?: ToolCallCardProps['kind'];
  durationMs?: number;
}) => React.ReactNode;

function BatchSubCallRow({
  tool,
  input,
  output,
  result,
  kind,
  parentTerminalState,
  renderToolCallDisplay,
}: {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
  result: BatchSubResultLike | undefined;
  kind?: ToolCallCardProps['kind'];
  parentTerminalState?: 'completed' | 'failed';
  renderToolCallDisplay: RenderToolCallDisplay;
}) {
  const [open, setOpen] = useState(false);
  const visualState = batchSubVisualState(result, parentTerminalState);
  const summary = useMemo(() => batchSubInputSummary(tool, input), [tool, input]);
  const childStatus: ToolCallCardProps['status'] =
    visualState === 'running' ? 'running' : 'completed';
  const childIsError = visualState === 'failed';

  // Output we hand to ToolCallDisplay:
  //   - completed: real output (string / structured result)
  //   - running + bash w/ partial: synthetic BashExecutionResult so the
  //     terminal card renders streaming stdout
  //   - running + no partial: undefined → BlockToolCall shows a spinner
  const effectiveOutput = useMemo(() => {
    if (output !== undefined) return output;
    if (
      visualState === 'running' &&
      tool.trim().toLowerCase() === 'bash' &&
      typeof result?.partialOutput === 'string' &&
      result.partialOutput.length > 0
    ) {
      return buildPartialBashOutput(input, result.partialOutput);
    }
    return output;
  }, [output, visualState, tool, result?.partialOutput, input]);

  // Auto-expand a sub-call once it starts streaming partial output, so the
  // user immediately sees the live terminal without having to click. We
  // only flip from closed → open (never re-collapse) so manual collapses
  // by the user are honored.
  useEffect(() => {
    if (
      !open &&
      visualState === 'running' &&
      tool.trim().toLowerCase() === 'bash' &&
      typeof result?.partialOutput === 'string' &&
      result.partialOutput.length > 0
    ) {
      setOpen(true);
    }
  }, [open, visualState, tool, result?.partialOutput]);

  return (
    <div className="tool-call-batch-child" data-batch-sub-status={visualState}>
      <button
        type="button"
        className="tool-call-batch-child-row"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="tool-call-batch-child-status" aria-hidden>
          {visualState === 'running' && <span className="tool-call-batch-spinner" />}
          {visualState === 'completed' && '✓'}
          {visualState === 'failed' && '✗'}
          {visualState === 'skipped' && '⊘'}
        </span>
        <ToolIcon kind={kind} toolName={tool} status={childStatus} size={12} />
        <span className="tool-call-batch-child-tool">{tool}</span>
        {summary && <span className="tool-call-batch-child-summary">{summary}</span>}
        {result?.durationMs != null && result.durationMs > 0 && (
          <span className="tool-call-batch-child-duration">{formatElapsed(result.durationMs)}</span>
        )}
        <span className="tool-call-batch-child-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="tool-call-batch-child-detail">
          {renderToolCallDisplay({
            toolName: tool,
            input,
            output: effectiveOutput,
            status: childStatus,
            isError: childIsError,
            kind,
            ...(result?.durationMs != null ? { durationMs: result.durationMs } : {}),
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Render a `batch` tool call as a parent card whose children are disclosure
 * rows (collapsed by default). Clicking a row reveals the full nested
 * ToolCallDisplay — so a batched bash shows the BashTerminalCard, a batched
 * edit shows the diff, etc, but only on demand. This mirrors opencode's
 * task-tool pattern where sub-work lives behind a single line summary.
 *
 * The nested tool renderer is passed in via `renderToolCallDisplay` to avoid
 * a circular import between ToolCallDisplay and this card.
 */
export function BatchToolCallCard({
  approvalActions,
  kind,
  input,
  output,
  status,
  isError,
  renderToolCallDisplay,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  kind?: ToolCallCardProps['kind'];
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  renderToolCallDisplay: RenderToolCallDisplay;
}) {
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });

  // Sub-call inputs come from the model-side input.tool_calls list.
  const toolCalls = useMemo(() => {
    const raw = input.tool_calls ?? input.calls ?? input.invocations;
    return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  }, [input]);

  // Sub-call outputs are either streamed live via _batchProgress or
  // recovered from the persisted output.results array after a refresh.
  const subResults = useMemo<BatchSubResultLike[]>(() => {
    const progress = input._batchProgress;
    if (
      progress &&
      typeof progress === 'object' &&
      Array.isArray((progress as Record<string, unknown>).subTools)
    ) {
      return (progress as { subTools: BatchSubResultLike[] }).subTools;
    }
    // After a refresh `output` is whatever the gateway persisted. Live runs
    // hand us the structured `{ results: [...] }` object directly, but the
    // storage layer (`normalizeToolResultOutputForStorage`) serializes the
    // output to a JSON *string* whenever it exceeds the size cap — which is
    // common for batch calls that bundle several bash diffs / long stdout.
    // Parse the string back into an object so the sub-call rows recover
    // their completed/failed status instead of defaulting to a perpetual
    // "running" spinner.
    const normalizedOutput = typeof output === 'string' ? parseBatchOutputString(output) : output;
    if (
      normalizedOutput &&
      typeof normalizedOutput === 'object' &&
      !Array.isArray(normalizedOutput)
    ) {
      const results = (normalizedOutput as Record<string, unknown>).results;
      if (Array.isArray(results)) {
        return results.map((r, idx) => {
          const rec = (r ?? {}) as Record<string, unknown>;
          const errFlag = rec.isError === true;
          const dur = rec.durationMs;
          return {
            index: idx,
            tool: typeof rec.tool === 'string' ? (rec.tool as string) : 'unknown',
            status: errFlag ? 'error' : 'completed',
            output: rec.output,
            isError: errFlag,
            durationMs: typeof dur === 'number' ? dur : undefined,
          };
        });
      }
    }
    return [];
  }, [input, output]);

  // Merge declared sub-calls with their results so we can render even when
  // tool_calls is missing (very early stream) or when a result outpaces the
  // declared list (defensive).
  const subCalls = useMemo(() => {
    const length = Math.max(toolCalls.length, subResults.length);
    const merged: Array<{
      key: string;
      tool: string;
      input: Record<string, unknown>;
      output?: unknown;
      result: BatchSubResultLike | undefined;
    }> = [];
    for (let i = 0; i < length; i += 1) {
      const declared = toolCalls[i];
      const result = subResults[i];
      const declaredTool =
        declared && typeof declared.tool === 'string' ? (declared.tool as string) : '';
      const tool = declaredTool || result?.tool || 'unknown';
      const params =
        declared?.parameters &&
        typeof declared.parameters === 'object' &&
        !Array.isArray(declared.parameters)
          ? (declared.parameters as Record<string, unknown>)
          : {};
      merged.push({
        key: `${i}-${tool}`,
        tool,
        input: params,
        output: result?.output,
        result,
      });
    }
    return merged;
  }, [toolCalls, subResults]);

  const completedCount = subResults.filter(
    (r) => r.status === 'completed' || r.status === 'error' || r.status === 'skipped',
  ).length;
  const totalCount = Math.max(toolCalls.length, subResults.length);
  const errorCount = subResults.filter((r) => r.status === 'error' || r.isError === true).length;

  // The parent batch tool's own terminal state. When the batch tool result
  // is itself completed/failed (e.g. after a refresh) but we have no per-sub
  // results to count — typically because the persisted output was a
  // truncated JSON string we couldn't parse — treat the whole batch as done
  // so the header + sub-rows show a terminal state instead of a permanent
  // "进行中…" spinner.
  const parentTerminalState: 'completed' | 'failed' | undefined =
    visualState === 'completed' ? 'completed' : visualState === 'failed' ? 'failed' : undefined;
  const allDone =
    parentTerminalState !== undefined || (totalCount > 0 && completedCount >= totalCount);

  // Aggregate run-time across completed sub-calls (parallel batch -> max,
  // but max ≈ wall-clock; sum is misleading). Show wall-clock = max.
  const wallClockMs = subResults.reduce(
    (acc, r) => (typeof r.durationMs === 'number' && r.durationMs > acc ? r.durationMs : acc),
    0,
  );

  // Progress label numerator: when we have parsed sub-results use the real
  // completed count; otherwise (truncated output) fall back to "all done"
  // once the parent batch itself reached a terminal state.
  const progressCompleted =
    completedCount > 0 || subResults.length > 0
      ? completedCount
      : parentTerminalState !== undefined
        ? totalCount
        : 0;

  return (
    <div className="tool-call-batch" data-tool-status={visualState}>
      <div className="tool-call-batch-header">
        <ToolIcon kind={kind} toolName="batch" status={visualState} size={13} />
        <span className="tool-call-batch-name">batch</span>
        {!allDone && <span className="tool-call-batch-spinner" aria-hidden />}
        <span className="tool-call-batch-progress">
          {totalCount === 0
            ? '准备中…'
            : allDone
              ? `${progressCompleted}/${totalCount} 完成`
              : `${completedCount}/${totalCount} 进行中…`}
        </span>
        {allDone && errorCount > 0 && (
          <span className="tool-call-batch-errors">{errorCount} 失败</span>
        )}
        {allDone && wallClockMs > 0 && (
          <span className="tool-call-batch-elapsed">{formatElapsed(wallClockMs)}</span>
        )}
      </div>
      {subCalls.length > 0 && (
        <div className="tool-call-batch-children">
          {subCalls.map((sub) => (
            <BatchSubCallRow
              key={sub.key}
              tool={sub.tool}
              input={sub.input}
              output={sub.output}
              result={sub.result}
              kind={kind}
              parentTerminalState={parentTerminalState}
              renderToolCallDisplay={renderToolCallDisplay}
            />
          ))}
        </div>
      )}
      <ToolApprovalActions approvalActions={approvalActions} />
    </div>
  );
}
