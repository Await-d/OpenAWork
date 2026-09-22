import type { InputImageContent } from '@openAwork/shared';
import type { ChatMessagePart } from '../../../../components/conversation-runtime/messages/support.js';
import { applyToolResultToStreamingSegment } from '../../../../components/conversation-runtime/stream/streaming-segments.js';
import type { LiveToolCallState } from './chat-page-utils.js';

export interface ApplyStreamToolProgressInput {
  event: {
    completedCount: number;
    occurredAt?: number;
    subTools: import('@openAwork/shared').BatchSubToolProgress[];
    toolCallId: string;
    toolName: string;
    totalCount: number;
  };
  liveToolCalls: Map<string, LiveToolCallState>;
}

export function applyStreamToolProgress(input: ApplyStreamToolProgressInput): void {
  const { event, liveToolCalls } = input;
  const previous = liveToolCalls.get(event.toolCallId);
  liveToolCalls.set(event.toolCallId, {
    createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
    inputText: previous?.inputText ?? '',
    output: previous?.output,
    isError: previous?.isError,
    toolCallId: event.toolCallId,
    status: 'streaming',
    toolName: event.toolName,
    batchProgress: {
      subTools: event.subTools,
      completedCount: event.completedCount,
      totalCount: event.totalCount,
    },
  });
}

export interface ApplyStreamToolResultInput {
  accumulatedSegments: ChatMessagePart[];
  event: {
    isError?: boolean;
    occurredAt?: number;
    output?: unknown;
    pendingPermissionRequestId?: string;
    resumedAfterApproval?: boolean;
    toolCallId: string;
    toolName: string;
    /** tool result 的图片附件（`computer_use` 最终截图）；其它工具为空。 */
    attachments?: InputImageContent[];
  };
  hasPendingPermission: boolean;
  liveToolCalls: Map<string, LiveToolCallState>;
}

export interface AppliedStreamToolResult {
  accumulatedSegments: ChatMessagePart[];
  rawPendingPermissionRequestId?: string;
}

export function applyStreamToolResult(input: ApplyStreamToolResultInput): AppliedStreamToolResult {
  const { accumulatedSegments, event, hasPendingPermission, liveToolCalls } = input;
  const previous = liveToolCalls.get(event.toolCallId);
  const rawPendingPermissionRequestId = event.pendingPermissionRequestId;

  liveToolCalls.set(event.toolCallId, {
    createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
    completedAt: event.occurredAt ?? Date.now(),
    inputText: previous?.inputText ?? '',
    output: event.output,
    isError: hasPendingPermission ? false : event.isError,
    pendingPermissionRequestId: hasPendingPermission ? event.pendingPermissionRequestId : undefined,
    resumedAfterApproval: event.resumedAfterApproval,
    // 附件只在本次 result 携带时覆盖；否则沿用上一次的（避免后续事件把它抹掉）。
    ...(event.attachments && event.attachments.length > 0
      ? { attachments: event.attachments }
      : previous?.attachments
        ? { attachments: previous.attachments }
        : {}),
    toolCallId: event.toolCallId,
    status: hasPendingPermission ? 'paused' : event.isError ? 'error' : 'completed',
    toolName: event.toolName,
  });

  return {
    accumulatedSegments: applyToolResultToStreamingSegment(accumulatedSegments, {
      toolCallId: event.toolCallId,
      output: event.output,
      isError: hasPendingPermission ? false : event.isError,
      status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
      ...(event.attachments && event.attachments.length > 0
        ? { attachments: event.attachments }
        : {}),
      ...(hasPendingPermission && rawPendingPermissionRequestId
        ? { pendingPermissionRequestId: rawPendingPermissionRequestId }
        : {}),
      ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    }),
    ...(rawPendingPermissionRequestId ? { rawPendingPermissionRequestId } : {}),
  };
}
