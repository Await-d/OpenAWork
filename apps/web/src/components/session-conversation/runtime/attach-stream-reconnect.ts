import type { ModifiedFilesSummaryContent } from '@openAwork/shared';
import type { SessionStateStatus } from './session-runtime.js';
import type { RecoveredActiveAssistantStream } from './stream-recovery.js';
import type { ChatBackendUsageSnapshot } from './stream-usage.js';
import type { StreamingThinkingBlock } from './streaming-thinking.js';
import type { AssistantTraceToolCall } from './support.js';

export interface InterruptedAttachStreamState {
  accumulatedText: string;
  accumulatedThinkingBlocks: StreamingThinkingBlock[];
  accumulatedUsage: ChatBackendUsageSnapshot | null;
  attachStateInitialized: boolean;
  currentAssistantStreamMessageId: string | null;
  recoveredModifiedFilesSummary?: ModifiedFilesSummaryContent;
  requestStartedAt: number;
  toolCalls: AssistantTraceToolCall[];
}

export interface InterruptedAttachStreamActions {
  cancelPendingRevealAnimation: () => void;
  clearCurrentAssistantStreamMessageId: () => void;
  clearStreamingBuffers: () => void;
  isCurrentSessionRequest: (sessionId: string, expectedEpoch: number) => boolean;
  loadCurrentSessionSnapshot: (
    sessionId: string,
    options: { expectedSessionViewEpoch: number },
  ) => Promise<void>;
  requestSessionListRefresh: () => void;
  resetAttachAttempt: () => void;
  resetRevealState: () => void;
  scheduleAttachRetry: (input: { beforeRetry?: () => boolean | void; delayMs: number }) => void;
  setActiveStreamFirstTokenLatencyMs: (value: number | null) => void;
  setActiveStreamStartedAt: (value: number | null) => void;
  setRecoveredStreamSnapshot: (value: RecoveredActiveAssistantStream) => void;
  setSessionStateStatus: (value: SessionStateStatus) => void;
  setStoppingStream: (value: boolean) => void;
  setStreaming: (value: boolean) => void;
}

export interface InterruptedAttachStreamInput {
  actions: InterruptedAttachStreamActions;
  attachSessionViewEpoch: number;
  sessionId: string;
  state: InterruptedAttachStreamState;
}

const INTERRUPTED_ATTACH_RETRY_DELAY_MS = 400;

export function handleInterruptedAttachStream(input: InterruptedAttachStreamInput): void {
  const { actions, attachSessionViewEpoch, sessionId, state } = input;

  if (!actions.isCurrentSessionRequest(sessionId, attachSessionViewEpoch)) {
    return;
  }

  if (state.attachStateInitialized) {
    actions.cancelPendingRevealAnimation();
    actions.resetRevealState();
    actions.setRecoveredStreamSnapshot({
      messageId: state.currentAssistantStreamMessageId,
      ...(state.recoveredModifiedFilesSummary
        ? { modifiedFilesSummary: state.recoveredModifiedFilesSummary }
        : {}),
      startedAt: state.requestStartedAt,
      text: state.accumulatedText,
      thinkingBlocks: state.accumulatedThinkingBlocks,
      toolCalls: state.toolCalls,
      usage: state.accumulatedUsage,
    });
    actions.clearStreamingBuffers();
    actions.setStreaming(false);
    actions.setStoppingStream(false);
    actions.setActiveStreamStartedAt(null);
    actions.setActiveStreamFirstTokenLatencyMs(null);
    actions.clearCurrentAssistantStreamMessageId();
  }

  actions.setSessionStateStatus('running');
  actions.scheduleAttachRetry({
    delayMs: INTERRUPTED_ATTACH_RETRY_DELAY_MS,
    beforeRetry: () => {
      if (!actions.isCurrentSessionRequest(sessionId, attachSessionViewEpoch)) {
        return false;
      }

      actions.resetAttachAttempt();
    },
  });
  void actions
    .loadCurrentSessionSnapshot(sessionId, {
      expectedSessionViewEpoch: attachSessionViewEpoch,
    })
    .catch(() => undefined);
  actions.requestSessionListRefresh();
}

export { INTERRUPTED_ATTACH_RETRY_DELAY_MS };
