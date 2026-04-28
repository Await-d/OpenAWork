import type { ToolResultContent } from '@openAwork/shared';
import type { ToolPart } from './message-v2-schema.js';

export function buildFallbackToolResultContentFromToolPart(
  toolPart: ToolPart,
): ToolResultContent | null {
  if (toolPart.state.status === 'completed') {
    return {
      type: 'tool_result',
      toolCallId: toolPart.callID,
      toolName: toolPart.tool,
      output: toolPart.state.output,
      isError: false,
      reason: 'completed',
      fileDiffs: [],
    };
  }

  if (toolPart.state.status === 'error') {
    const interruptedOutput =
      toolPart.state.metadata?.interrupted === true ? toolPart.state.metadata.output : undefined;
    if (typeof interruptedOutput === 'string') {
      return {
        type: 'tool_result',
        toolCallId: toolPart.callID,
        toolName: toolPart.tool,
        output: interruptedOutput,
        isError: false,
        reason: 'interrupted_output',
      };
    }

    return {
      type: 'tool_result',
      toolCallId: toolPart.callID,
      toolName: toolPart.tool,
      output: toolPart.state.error,
      isError: true,
      reason: 'error',
    };
  }

  if (toolPart.state.status === 'pending') {
    return {
      type: 'tool_result',
      toolCallId: toolPart.callID,
      toolName: toolPart.tool,
      output: `Tool "${toolPart.tool}" is waiting for approval.`,
      isError: false,
      reason: 'pending_approval',
      pendingPermissionRequestId: toolPart.callID,
    };
  }

  return null;
}

export function buildUiToolPartReadState(toolPart: ToolPart): {
  errorText?: string;
  output?: string;
  state: 'output-available' | 'output-error';
} {
  if (toolPart.state.status === 'completed') {
    return {
      state: 'output-available',
      output: toolPart.state.time.compacted
        ? '[Old tool result content cleared]'
        : toolPart.state.output,
    };
  }

  if (toolPart.state.status === 'error') {
    const interruptedOutput =
      toolPart.state.metadata?.interrupted === true ? toolPart.state.metadata.output : undefined;
    if (typeof interruptedOutput === 'string') {
      return {
        state: 'output-available',
        output: interruptedOutput,
      };
    }

    return {
      state: 'output-error',
      errorText: toolPart.state.error,
    };
  }

  if (toolPart.state.status === 'pending') {
    return {
      state: 'output-error',
      errorText: `Tool "${toolPart.tool}" is waiting for approval.`,
    };
  }

  return {
    state: 'output-error',
    errorText: '[Tool execution was interrupted]',
  };
}
