import { isNonTerminalStreamErrorCode } from '@openAwork/shared';
import type {
  RunEvent,
  RunEventBookend,
  RunEventCursor,
  RunEventEnvelope,
} from '@openAwork/shared';

export function deriveRunEventBookend(event: RunEvent): RunEventBookend | undefined {
  switch (event.type) {
    case 'done':
      if (event.stopReason === 'tool_use') {
        return {
          kind: 'tool_handoff',
          terminal: false,
          replayable: false,
          stopReason: event.stopReason,
        };
      }

      if (event.stopReason === 'tool_permission') {
        return {
          kind: 'permission_paused',
          terminal: false,
          replayable: true,
          stopReason: event.stopReason,
        };
      }

      if (event.stopReason === 'cancelled') {
        return {
          kind: 'run_cancelled',
          terminal: true,
          replayable: true,
          stopReason: event.stopReason,
          // Forward the optional cascade summary so historical run
          // events keep "stopped by parent / N children cancelled"
          // information after the live `done` chunk is gone
          // (T-CANCEL-07, workflow 260509). Producers that emit a
          // bare `done` (no cascade) leave this undefined and the
          // existing UI path keeps working unchanged.
          ...(event.cancellation ? { cancellation: event.cancellation } : {}),
        };
      }

      return {
        kind: 'run_completed',
        terminal: true,
        replayable: true,
        stopReason: event.stopReason,
      };
    case 'error':
      return {
        kind: 'run_failed',
        terminal: true,
        replayable: true,
      };
    case 'permission_asked':
      return {
        kind: 'interaction_wait',
        terminal: false,
        replayable: true,
        interactionType: 'permission',
        requestId: event.requestId,
      };
    case 'question_asked':
      return {
        kind: 'interaction_wait',
        terminal: false,
        replayable: true,
        interactionType: 'question',
        requestId: event.requestId,
      };
    case 'permission_replied':
      return {
        kind: 'interaction_resumed',
        terminal: false,
        replayable: false,
        interactionType: 'permission',
        requestId: event.requestId,
      };
    case 'question_replied':
      return {
        kind: 'interaction_resumed',
        terminal: false,
        replayable: false,
        interactionType: 'question',
        requestId: event.requestId,
      };
    default:
      return undefined;
  }
}

export function isTerminalRunEvent(event: RunEvent): boolean {
  return deriveRunEventBookend(event)?.terminal === true;
}

/**
 * 这条事件是否**真的**代表本次运行结束——供 `/stream/attach` 的活订阅决定是否收尾。
 *
 * 与 `isTerminalRunEvent` 的差别只在一处：`error` 的通用语义是 `run_failed`
 * （`terminal: true`），但 `NON_TERMINAL_STREAM_ERROR_CODES` 里的错误码（如
 * `TOOL_ERROR`：上游丢弃一次入参畸形的工具调用）只是单次操作失败，run 会继续
 * 产出后续事件与最终的 `done`。客户端对这类错误码明确定义为「只透传提示、不结算、
 * 不断连」（`apps/web/.../stream-error-classification.ts`），因此服务端也**不能**
 * 在此收尾：否则客户端收到的是一段没有 `done` 的普通错误 chunk，随后的正常 EOF
 * 会被它判成「连接在流式传输中中断」，进入重连退避；而 `/stream/active` 始终报告
 * 活跃流（run 确实还在跑），重连永远收敛不了——表现为「attach 成功 → 数秒断开 →
 * 自动重连 → 再断开」的死循环，每出现一次这种错误就循环一次。
 */
export function isStreamEndingRunEvent(event: RunEvent): boolean {
  if (deriveRunEventBookend(event)?.terminal !== true) {
    return false;
  }
  if (event.type === 'error' && isNonTerminalStreamErrorCode(event.code)) {
    return false;
  }
  return true;
}

export function buildRunEventEnvelope(input: {
  aggregateId: string;
  aggregateType: RunEventEnvelope['aggregateType'];
  causationId?: string;
  clientRequestId?: string;
  cursor?: RunEventCursor;
  event: RunEvent;
  outputOffset: number;
  seq: number;
  timestamp: number;
  version?: number;
}): RunEventEnvelope {
  const bookend = deriveRunEventBookend(input.event);
  return {
    eventId: input.event.eventId ?? `${input.aggregateId}:evt:${input.seq}`,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    seq: input.seq,
    version: input.version ?? 1,
    ...(input.causationId ? { causationId: input.causationId } : {}),
    timestamp: input.timestamp,
    payload: {
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      deliveryState: 'delivered',
      outputOffset: input.outputOffset,
      ...(bookend ? { bookend } : {}),
      event: input.event,
    },
  };
}
