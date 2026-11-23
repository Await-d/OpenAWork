import type { InputImageContent } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from '../infra/db.js';
import { approveToolPermission, listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import { hasPendingSessionInteraction } from '../session/session-runtime-state.js';
import {
  createDefaultSandbox,
  recordBlockedToolCallsForPendingRequest,
} from '../tools/tool-sandbox.js';
import {
  type ApprovedPermissionResumePayload,
  type BlockedToolCallResumeEntry,
  createStreamExecutionContext,
  streamRequestSchema,
} from './stream.js';
import { buildSingleToolPartialOutputWriter } from './single-tool-live-output.js';

export interface ResumedToolResult {
  attachments?: InputImageContent[];
  isError: boolean;
  output: unknown;
  toolCallId: string;
  toolName: string;
}

/** 将未执行尾部交给仍待决的交互，保留该交互自己的锚点（包括 deciding）。 */
export function deferBlockedToolCalls(input: {
  calls: BlockedToolCallResumeEntry[];
  sessionId: string;
}): void {
  if (input.calls.length === 0) return;
  for (const table of ['question_requests', 'permission_requests'] as const) {
    const rows = sqliteAll<{ id: string; request_payload_json: string | null }>(
      `SELECT id, request_payload_json FROM ${table}
       WHERE session_id = ? AND status IN ('pending', 'deciding')`,
      [input.sessionId],
    );
    for (const row of rows) {
      if (!row.request_payload_json) continue;
      const payload = JSON.parse(row.request_payload_json) as ApprovedPermissionResumePayload;
      const calls = new Map<string, BlockedToolCallResumeEntry>();
      calls.set(payload.toolCallId, {
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        rawInput: payload.rawInput,
      });
      for (const call of payload.blockedToolCalls ?? []) calls.set(call.toolCallId, call);
      for (const call of input.calls) calls.set(call.toolCallId, call);
      sqliteRun(
        `UPDATE ${table} SET request_payload_json = ?
         WHERE id = ? AND status IN ('pending', 'deciding')`,
        [JSON.stringify({ ...payload, blockedToolCalls: [...calls.values()] }), row.id],
      );
    }
  }
}

/** 批准和回答共用同一沙箱、权限阶梯和实时输出通道，遇到下一交互即交接尾部。 */
export async function replayBlockedToolCalls(input: {
  calls: BlockedToolCallResumeEntry[];
  payload: ApprovedPermissionResumePayload;
  sessionId: string;
  userId: string;
  onResult: (result: ResumedToolResult) => Promise<void>;
  signal: AbortSignal;
}): Promise<ResumedToolResult[]> {
  const completed = new Set<string>();
  for (const message of listSessionMessagesV2(input)) {
    for (const part of message.content) {
      if (part.type === 'tool_result' && !part.pendingPermissionRequestId && !part.isError) {
        completed.add(part.toolCallId);
      }
    }
  }
  const calls = input.calls.filter((call) => !completed.has(call.toolCallId));
  if (calls.length === 0) return [];
  const sandbox = createDefaultSandbox([], { userId: input.userId });
  const executionContext = createStreamExecutionContext(
    input.payload.clientRequestId,
    input.payload.nextRound,
    streamRequestSchema.parse(input.payload.requestData),
    input.userId,
  );
  const results: ResumedToolResult[] = [];
  for (const [index, call] of calls.entries()) {
    if (completed.has(call.toolCallId)) continue;
    input.signal.throwIfAborted();
    if (hasPendingSessionInteraction(input.sessionId)) {
      deferBlockedToolCalls({ calls: calls.slice(index), sessionId: input.sessionId });
      break;
    }
    approveToolPermission({
      sessionId: input.sessionId,
      userId: input.userId,
      callID: call.toolCallId,
      title: call.toolName,
    });
    let result;
    try {
      result = await sandbox.execute(call, input.signal, input.sessionId, {
        ...executionContext,
        onPartialOutput: buildSingleToolPartialOutputWriter({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          clientRequestId: input.payload.clientRequestId,
          writeChunk: (chunk) => {
            publishSessionRunEvent(input.sessionId, chunk, {
              clientRequestId: input.payload.clientRequestId,
            });
          },
        }),
      });
    } catch (error) {
      // 只结算实际失败的调用；已经成功的调用和未开始的尾部均不能被覆盖。
      await input.onResult({
        isError: true,
        output: error instanceof Error ? error.message : String(error),
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      });
      throw error;
    }
    if (result.pendingPermissionRequestId) {
      recordBlockedToolCallsForPendingRequest(
        result.pendingPermissionRequestId,
        calls.slice(index),
      );
      break;
    }
    const resumedResult: ResumedToolResult = {
      ...(result.attachments ? { attachments: result.attachments } : {}),
      isError: result.isError,
      output: result.output,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
    };
    await input.onResult(resumedResult);
    results.push(resumedResult);
    completed.add(call.toolCallId);
  }
  return results;
}
