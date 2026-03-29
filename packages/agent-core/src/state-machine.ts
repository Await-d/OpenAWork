import type { AgentState, AgentEvent } from './types.js';

export function createInitialState(): AgentState {
  return { status: 'idle' };
}

export function transition(state: AgentState, event: AgentEvent): AgentState {
  switch (state.status) {
    case 'idle': {
      if (event.type === 'START') {
        return {
          status: 'running',
          abortController: event.abortController,
          requestId: event.requestId,
        };
      }
      return state;
    }

    case 'running': {
      if (event.type === 'TOOL_CALL_STARTED') {
        return {
          status: 'tool-calling',
          abortController: state.abortController,
          pendingToolCallIds: event.toolCallIds,
        };
      }
      if (event.type === 'COMPLETE') {
        return { status: 'idle' };
      }
      if (event.type === 'RETRY') {
        return {
          status: 'retry',
          attempt: event.attempt,
          nextRetryAt: event.nextRetryAt,
          reason: event.reason,
        };
      }
      if (event.type === 'INTERRUPT') {
        return { status: 'interrupted', resumable: true };
      }
      if (event.type === 'ERROR') {
        return {
          status: 'error',
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
        };
      }
      return state;
    }

    case 'tool-calling': {
      if (event.type === 'TOOL_CALL_COMPLETED') {
        return {
          status: 'running',
          abortController: state.abortController,
          requestId: event.nextRequestId,
        };
      }
      if (event.type === 'INTERRUPT') {
        return { status: 'interrupted', resumable: true };
      }
      if (event.type === 'ERROR') {
        return {
          status: 'error',
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
        };
      }
      return state;
    }

    case 'retry': {
      if (event.type === 'START') {
        return {
          status: 'running',
          abortController: event.abortController,
          requestId: event.requestId,
        };
      }
      if (event.type === 'INTERRUPT') {
        return { status: 'interrupted', resumable: true };
      }
      if (event.type === 'ERROR') {
        return {
          status: 'error',
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
        };
      }
      return state;
    }

    case 'interrupted': {
      if (event.type === 'RESUME' && state.resumable) {
        return { status: 'idle' };
      }
      if (event.type === 'RESET') {
        return { status: 'idle' };
      }
      return state;
    }

    case 'error': {
      if (event.type === 'RESET') {
        return { status: 'idle' };
      }
      if (event.type === 'RETRY' && state.recoverable) {
        return {
          status: 'retry',
          attempt: event.attempt,
          nextRetryAt: event.nextRetryAt,
          reason: event.reason,
        };
      }
      return state;
    }
  }
}

export function canTransition(state: AgentState, event: AgentEvent): boolean {
  const next = transition(state, event);
  return next !== state;
}

export function isTerminal(state: AgentState): boolean {
  return state.status === 'error' && !state.recoverable;
}

export function isActive(state: AgentState): boolean {
  return state.status === 'running' || state.status === 'tool-calling';
}
