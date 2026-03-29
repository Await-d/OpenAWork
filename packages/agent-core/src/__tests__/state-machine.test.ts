import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  transition,
  canTransition,
  isTerminal,
  isActive,
} from '../state-machine.js';
import type { AgentState, AgentEvent } from '../types.js';

const ac = () => new AbortController();
const now = 1000000;

describe('createInitialState', () => {
  it('returns idle state', () => {
    expect(createInitialState()).toEqual({ status: 'idle' });
  });
});

describe('transition: idle', () => {
  it('idle + START -> running', () => {
    const ctrl = ac();
    const state = createInitialState();
    const event: AgentEvent = { type: 'START', requestId: 'r1', abortController: ctrl };
    const next = transition(state, event);
    expect(next).toEqual({ status: 'running', requestId: 'r1', abortController: ctrl });
  });

  it('idle + unrelated event -> idle (no change)', () => {
    const state = createInitialState();
    const next = transition(state, { type: 'COMPLETE' });
    expect(next).toBe(state);
  });
});

describe('transition: running', () => {
  const ctrl = ac();
  const running: AgentState = { status: 'running', abortController: ctrl, requestId: 'r1' };

  it('running + TOOL_CALL_STARTED -> tool-calling', () => {
    const event: AgentEvent = { type: 'TOOL_CALL_STARTED', toolCallIds: ['tc1', 'tc2'] };
    const next = transition(running, event);
    expect(next).toEqual({
      status: 'tool-calling',
      abortController: ctrl,
      pendingToolCallIds: ['tc1', 'tc2'],
    });
  });

  it('running + COMPLETE -> idle', () => {
    expect(transition(running, { type: 'COMPLETE' })).toEqual({ status: 'idle' });
  });

  it('running + RETRY -> retry', () => {
    const event: AgentEvent = { type: 'RETRY', attempt: 1, reason: 'timeout', nextRetryAt: now };
    const next = transition(running, event);
    expect(next).toEqual({ status: 'retry', attempt: 1, reason: 'timeout', nextRetryAt: now });
  });

  it('running + INTERRUPT -> interrupted', () => {
    expect(transition(running, { type: 'INTERRUPT' })).toEqual({
      status: 'interrupted',
      resumable: true,
    });
  });

  it('running + ERROR -> error', () => {
    const event: AgentEvent = { type: 'ERROR', code: 'E01', message: 'fail', recoverable: true };
    expect(transition(running, event)).toEqual({
      status: 'error',
      code: 'E01',
      message: 'fail',
      recoverable: true,
    });
  });

  it('running + unrelated event -> no change', () => {
    const next = transition(running, { type: 'RESET' });
    expect(next).toBe(running);
  });
});

describe('transition: tool-calling', () => {
  const ctrl = ac();
  const toolCalling: AgentState = {
    status: 'tool-calling',
    abortController: ctrl,
    pendingToolCallIds: ['tc1'],
  };

  it('tool-calling + TOOL_CALL_COMPLETED -> running with nextRequestId', () => {
    const event: AgentEvent = { type: 'TOOL_CALL_COMPLETED', nextRequestId: 'r2' };
    const next = transition(toolCalling, event);
    expect(next).toEqual({ status: 'running', abortController: ctrl, requestId: 'r2' });
  });

  it('tool-calling + INTERRUPT -> interrupted', () => {
    expect(transition(toolCalling, { type: 'INTERRUPT' })).toEqual({
      status: 'interrupted',
      resumable: true,
    });
  });

  it('tool-calling + ERROR -> error', () => {
    const event: AgentEvent = {
      type: 'ERROR',
      code: 'E02',
      message: 'tool error',
      recoverable: false,
    };
    expect(transition(toolCalling, event)).toEqual({
      status: 'error',
      code: 'E02',
      message: 'tool error',
      recoverable: false,
    });
  });

  it('tool-calling + unrelated event -> no change', () => {
    expect(transition(toolCalling, { type: 'COMPLETE' })).toBe(toolCalling);
  });
});

describe('transition: retry', () => {
  const retryState: AgentState = { status: 'retry', attempt: 1, nextRetryAt: now, reason: 'net' };
  const ctrl = ac();

  it('retry + START -> running', () => {
    const event: AgentEvent = { type: 'START', requestId: 'r3', abortController: ctrl };
    expect(transition(retryState, event)).toEqual({
      status: 'running',
      requestId: 'r3',
      abortController: ctrl,
    });
  });

  it('retry + INTERRUPT -> interrupted', () => {
    expect(transition(retryState, { type: 'INTERRUPT' })).toEqual({
      status: 'interrupted',
      resumable: true,
    });
  });

  it('retry + ERROR -> error', () => {
    const event: AgentEvent = { type: 'ERROR', code: 'E03', message: 'err', recoverable: false };
    expect(transition(retryState, event)).toEqual({
      status: 'error',
      code: 'E03',
      message: 'err',
      recoverable: false,
    });
  });

  it('retry + unrelated event -> no change', () => {
    expect(transition(retryState, { type: 'COMPLETE' })).toBe(retryState);
  });
});

describe('transition: interrupted', () => {
  const interrupted: AgentState = { status: 'interrupted', resumable: true };

  it('interrupted + RESUME -> idle', () => {
    expect(transition(interrupted, { type: 'RESUME' })).toEqual({ status: 'idle' });
  });

  it('interrupted + RESET -> idle', () => {
    expect(transition(interrupted, { type: 'RESET' })).toEqual({ status: 'idle' });
  });

  it('non-resumable interrupted + RESUME -> no change', () => {
    const nonResumable: AgentState = { status: 'interrupted', resumable: false };
    expect(transition(nonResumable, { type: 'RESUME' })).toBe(nonResumable);
  });
});

describe('transition: error', () => {
  const recoverableError: AgentState = {
    status: 'error',
    code: 'E1',
    message: 'err',
    recoverable: true,
  };
  const fatalError: AgentState = {
    status: 'error',
    code: 'E2',
    message: 'fatal',
    recoverable: false,
  };

  it('recoverable error + RESET -> idle', () => {
    expect(transition(recoverableError, { type: 'RESET' })).toEqual({ status: 'idle' });
  });

  it('recoverable error + RETRY -> retry', () => {
    const event: AgentEvent = { type: 'RETRY', attempt: 2, reason: 're', nextRetryAt: now };
    expect(transition(recoverableError, event)).toEqual({
      status: 'retry',
      attempt: 2,
      reason: 're',
      nextRetryAt: now,
    });
  });

  it('fatal error + RETRY -> no change', () => {
    const event: AgentEvent = { type: 'RETRY', attempt: 1, reason: 're', nextRetryAt: now };
    expect(transition(fatalError, event)).toBe(fatalError);
  });

  it('fatal error + RESET -> idle', () => {
    expect(transition(fatalError, { type: 'RESET' })).toEqual({ status: 'idle' });
  });
});

describe('canTransition', () => {
  it('returns true when state changes', () => {
    const ctrl = ac();
    const state = createInitialState();
    expect(canTransition(state, { type: 'START', requestId: 'r1', abortController: ctrl })).toBe(
      true,
    );
  });

  it('returns false when state does not change', () => {
    const state = createInitialState();
    expect(canTransition(state, { type: 'COMPLETE' })).toBe(false);
  });
});

describe('isTerminal', () => {
  it('returns true for non-recoverable error', () => {
    const state: AgentState = { status: 'error', code: 'E', message: 'm', recoverable: false };
    expect(isTerminal(state)).toBe(true);
  });

  it('returns false for recoverable error', () => {
    const state: AgentState = { status: 'error', code: 'E', message: 'm', recoverable: true };
    expect(isTerminal(state)).toBe(false);
  });

  it('returns false for non-error states', () => {
    expect(isTerminal({ status: 'idle' })).toBe(false);
  });
});

describe('isActive', () => {
  it('returns true for running', () => {
    const state: AgentState = { status: 'running', abortController: ac(), requestId: 'r' };
    expect(isActive(state)).toBe(true);
  });

  it('returns true for tool-calling', () => {
    const state: AgentState = {
      status: 'tool-calling',
      abortController: ac(),
      pendingToolCallIds: [],
    };
    expect(isActive(state)).toBe(true);
  });

  it('returns false for idle', () => {
    expect(isActive({ status: 'idle' })).toBe(false);
  });

  it('returns false for error', () => {
    expect(isActive({ status: 'error', code: 'E', message: 'm', recoverable: false })).toBe(false);
  });
});
