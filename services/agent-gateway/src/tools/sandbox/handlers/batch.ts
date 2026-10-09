/**
 * batch 域 handler(261009-tool-sandbox 拆分 P2 / T-11)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * batch 分支体逐字保留(子工具递归经 `ctx.executeNestedTool` 走
 * `ToolSandbox.execute` 全路径,不跑后置钩子)。派发顺序仍由门面的 if 链决定
 * (本模块不参与顺序决策)。
 */

import type { ToolCallRequest, ToolCallResult } from '@openAwork/agent-core';
import type { BatchSubToolProgress } from '@openAwork/shared';
import { logGatewayWarn } from '../../../infra/gateway-logger.js';
import { BATCH_TOOL_DISALLOWED, BATCH_TOOL_MAX_CALLS } from '../../batch-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import type { SandboxExecutionContext } from '../session-context.js';

export async function handleBatchTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, rawInput, executionContext } = ctx;
  const toolCallsValue = rawInput.tool_calls;
  if (!Array.isArray(toolCallsValue) || toolCallsValue.length === 0) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: 'batch requires a non-empty tool_calls array',
      isError: true,
      durationMs: 0,
    };
  }

  const selectedToolCalls = toolCallsValue.slice(0, BATCH_TOOL_MAX_CALLS);
  const droppedToolCalls = toolCallsValue.slice(BATCH_TOOL_MAX_CALLS);

  let pendingRequestId: string | undefined;
  const onProgress = executionContext?.onBatchProgress;
  const totalCount = selectedToolCalls.length;

  // Build initial sub-tool status array for progress reporting.
  const subToolStates: BatchSubToolProgress[] = selectedToolCalls.map((entry, index) => {
    const tool =
      entry && typeof entry === 'object' && typeof entry.tool === 'string' ? entry.tool : 'unknown';
    return { index, tool, status: 'running' };
  });

  // Emit initial "all running" snapshot.
  if (onProgress) {
    onProgress([...subToolStates], 0, totalCount);
  }

  const results = await Promise.all(
    selectedToolCalls.map(async (entry, index) => {
      if (!entry || typeof entry !== 'object') {
        const progress: BatchSubToolProgress = {
          index,
          tool: 'unknown',
          status: 'error',
          output: `Invalid batch tool call at index ${index}`,
          isError: true,
        };
        subToolStates[index] = progress;
        if (onProgress) {
          const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
          onProgress([...subToolStates], completedCount, totalCount);
        }
        return {
          tool: 'unknown',
          isError: true,
          output: `Invalid batch tool call at index ${index}`,
        };
      }

      const tool = typeof entry.tool === 'string' ? entry.tool : '';
      const parameters =
        entry.parameters && typeof entry.parameters === 'object' ? entry.parameters : null;
      if (!tool || !parameters) {
        const progress: BatchSubToolProgress = {
          index,
          tool: tool || 'unknown',
          status: 'error',
          output: `Batch entry ${index} requires tool and object-shaped parameters`,
          isError: true,
        };
        subToolStates[index] = progress;
        if (onProgress) {
          const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
          onProgress([...subToolStates], completedCount, totalCount);
        }
        return {
          tool: tool || 'unknown',
          isError: true,
          output: `Batch entry ${index} requires tool and object-shaped parameters`,
        };
      }

      if (BATCH_TOOL_DISALLOWED.has(tool)) {
        const progress: BatchSubToolProgress = {
          index,
          tool,
          status: 'skipped',
          output: `Tool "${tool}" cannot be called from batch`,
          isError: true,
        };
        subToolStates[index] = progress;
        if (onProgress) {
          const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
          onProgress([...subToolStates], completedCount, totalCount);
        }
        return {
          tool,
          isError: true,
          output: `Tool "${tool}" cannot be called from batch`,
        };
      }

      const subStartAt = Date.now();
      const subRequest: ToolCallRequest = {
        toolCallId: `${request.toolCallId}:${index}`,
        toolName: tool,
        rawInput: parameters,
      };
      // Per-sub-call execution context that injects a partial-output
      // wrapper. When a streaming-capable dispatcher (bash) calls
      // onPartialOutput with the rolling stdout snapshot, we stitch
      // that into subToolStates[index].partialOutput and fan out via
      // onProgress so the SSE channel (and ultimately the UI) sees
      // live terminal output for in-flight sub-tools.
      const subExecutionContext: SandboxExecutionContext = {
        ...(executionContext ?? {}),
        onPartialOutput: (text: string) => {
          const current = subToolStates[index];
          // Only patch if the sub-tool is still in `running` state —
          // a late chunk arriving after we've already written the
          // final progress entry must not clobber the completed
          // result.
          if (!current || current.status !== 'running') return;
          subToolStates[index] = { ...current, partialOutput: text };
          if (onProgress) {
            const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
            onProgress([...subToolStates], completedCount, totalCount);
          }
        },
      };
      // Per-sub-call resilience: `sandbox.execute` is a large recursive
      // dispatcher and not every branch normalizes a failure into
      // `{ isError: true }` — some throw (validation, provider, fs, mcp).
      // This runs inside `Promise.all(...)`, so a single throwing sub-tool
      // would reject the whole batch and discard every sibling's result,
      // defeating the batch tool's purpose. Catch per sub-call and degrade
      // to an error result so the rest of the batch still completes.
      let subResult: ToolCallResult;
      try {
        subResult = await ctx.executeNestedTool({
          executionContext: subExecutionContext,
          request: subRequest,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logGatewayWarn(`[batch] 子工具 ${tool}（#${index}）执行抛错，已降级为错误结果：${message}`);
        const failProgress: BatchSubToolProgress = {
          index,
          tool,
          status: 'error',
          output: `Batch sub-tool "${tool}" threw: ${message}`,
          isError: true,
          durationMs: Date.now() - subStartAt,
        };
        subToolStates[index] = failProgress;
        if (onProgress) {
          const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
          onProgress([...subToolStates], completedCount, totalCount);
        }
        return {
          tool,
          isError: true,
          output: `Batch sub-tool "${tool}" threw: ${message}`,
        };
      }
      if (!pendingRequestId && subResult.pendingPermissionRequestId) {
        pendingRequestId = subResult.pendingPermissionRequestId;
      }

      const progress: BatchSubToolProgress = {
        index,
        tool,
        status: subResult.isError ? 'error' : 'completed',
        output: subResult.output,
        // partialOutput intentionally omitted — the final `output`
        // supersedes it and the UI should switch to the real card.
        isError: subResult.isError,
        durationMs: Date.now() - subStartAt,
      };
      subToolStates[index] = progress;
      if (onProgress) {
        const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
        onProgress([...subToolStates], completedCount, totalCount);
      }

      return {
        tool,
        isError: subResult.isError,
        output: subResult.output,
      };
    }),
  );

  for (const [index, droppedEntry] of droppedToolCalls.entries()) {
    const tool =
      droppedEntry && typeof droppedEntry === 'object' && typeof droppedEntry.tool === 'string'
        ? droppedEntry.tool
        : 'unknown';
    results.push({
      tool,
      isError: true,
      output: `Batch accepts at most ${BATCH_TOOL_MAX_CALLS} tool calls; entry ${BATCH_TOOL_MAX_CALLS + index} was ignored`,
    });
  }

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: { results, total: results.length },
    isError: results.some((result) => result.isError),
    durationMs: 0,
    ...(pendingRequestId ? { pendingPermissionRequestId: pendingRequestId } : {}),
  };
}
