import type { RunEvent, ToolResultContent } from '@openAwork/shared';

export interface ToolResultPayloadInput {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  pendingPermissionRequestId?: string;
}

export function buildToolResultContent(input: ToolResultPayloadInput): ToolResultContent {
  return {
    type: 'tool_result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output: input.output,
    isError: input.isError,
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
    output: input.output,
    isError: input.isError,
    ...(input.pendingPermissionRequestId
      ? { pendingPermissionRequestId: input.pendingPermissionRequestId }
      : {}),
    ...input.eventMeta,
  };
}
