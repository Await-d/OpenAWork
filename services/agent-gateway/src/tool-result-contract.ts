import type {
  FileDiffContent,
  RunEvent,
  ToolCallObservabilityAnnotation,
  ToolResultContent,
} from '@openAwork/shared';

export interface ToolResultPayloadInput {
  toolCallId: string;
  toolName: string;
  clientRequestId?: string;
  output: unknown;
  isError: boolean;
  reason?: string;
  fileDiffs?: FileDiffContent[];
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
}

export function buildToolResultContent(input: ToolResultPayloadInput): ToolResultContent {
  const rawOutput = typeof input.output === 'string' ? input.output : JSON.stringify(input.output);
  return {
    type: 'tool_result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    output: input.output,
    rawOutput,
    isError: input.isError,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.fileDiffs && input.fileDiffs.length > 0 ? { fileDiffs: input.fileDiffs } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
    ...(input.pendingPermissionRequestId
      ? { pendingPermissionRequestId: input.pendingPermissionRequestId }
      : {}),
    ...(input.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
  };
}

export function buildToolResultRunEvent(
  input: ToolResultPayloadInput & {
    eventMeta: { eventId: string; runId: string; occurredAt: number };
  },
): Extract<RunEvent, { type: 'tool_result' }> {
  return {
    type: 'tool_result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    output: input.output,
    isError: input.isError,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.fileDiffs && input.fileDiffs.length > 0 ? { fileDiffs: input.fileDiffs } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
    ...(input.pendingPermissionRequestId
      ? { pendingPermissionRequestId: input.pendingPermissionRequestId }
      : {}),
    ...(input.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    ...input.eventMeta,
  };
}
