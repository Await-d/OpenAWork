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
  observability?: ToolCallObservabilityAnnotation;
}

export function buildToolResultContent(input: ToolResultPayloadInput): ToolResultContent {
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
    ...input.eventMeta,
  };
}
