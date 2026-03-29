import type { Message } from '@openAwork/shared';

export type AgentStatus = 'idle' | 'running' | 'tool-calling' | 'retry' | 'interrupted' | 'error';

export interface IdleState {
  status: 'idle';
}

export interface RunningState {
  status: 'running';
  abortController: AbortController;
  requestId: string;
}

export interface ToolCallingState {
  status: 'tool-calling';
  abortController: AbortController;
  pendingToolCallIds: string[];
}

export interface RetryState {
  status: 'retry';
  attempt: number;
  nextRetryAt: number;
  reason: string;
}

export interface InterruptedState {
  status: 'interrupted';
  resumable: boolean;
}

export interface ErrorState {
  status: 'error';
  code: string;
  message: string;
  recoverable: boolean;
}

export type AgentState =
  | IdleState
  | RunningState
  | ToolCallingState
  | RetryState
  | InterruptedState
  | ErrorState;

export type AgentEvent =
  | { type: 'START'; requestId: string; abortController: AbortController }
  | { type: 'TOOL_CALL_STARTED'; toolCallIds: string[] }
  | { type: 'TOOL_CALL_COMPLETED'; nextRequestId: string }
  | { type: 'RETRY'; attempt: number; reason: string; nextRetryAt: number }
  | { type: 'INTERRUPT' }
  | { type: 'RESUME' }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; code: string; message: string; recoverable: boolean }
  | { type: 'RESET' };

export interface ConversationSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  state: AgentState;
  metadata: Record<string, unknown>;
}

export interface SessionCheckpoint {
  sessionId: string;
  checkpointAt: number;
  messages: Message[];
  stateStatus: AgentStatus;
  metadata: Record<string, unknown>;
}
