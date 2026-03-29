import type { StreamDoneChunk } from '@openAwork/shared';

type StopReason = StreamDoneChunk['stopReason'];

export function resolveEofStopReason(input: {
  sawFinishReason: boolean;
  stopReason: StopReason;
  toolCallCount: number;
}): { stopReason: StopReason; truncated: boolean } {
  if (input.sawFinishReason) {
    return { stopReason: input.stopReason, truncated: false };
  }

  if (input.toolCallCount > 0) {
    return { stopReason: 'tool_use', truncated: false };
  }

  return { stopReason: input.stopReason, truncated: true };
}

export function resolveEofRoundDecision(input: {
  sawFinishReason: boolean;
  stopReason: StopReason;
  toolCallCount: number;
}): { shouldContinue: boolean; shouldStop: boolean; stopReason: StopReason; truncated: boolean } {
  const resolution = resolveEofStopReason(input);
  const shouldContinue = resolution.stopReason === 'tool_use' && input.toolCallCount > 0;
  return {
    shouldContinue,
    shouldStop: !shouldContinue,
    stopReason: resolution.stopReason,
    truncated: resolution.truncated,
  };
}
