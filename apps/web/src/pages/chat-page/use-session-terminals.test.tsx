// @vitest-environment jsdom
/**
 * Coverage for the `useSessionTerminals` hook reducer behaviour.
 *
 * We don't try to simulate the real fetch hydration here (that's
 * exercised by the integration tests in agent-gateway). Instead we
 * verify the in-memory state machine that handles `terminal_*`
 * RunEvents — this is the path the chat-stream loop hits the most.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSessionTerminals } from './use-session-terminals.js';

const SESSION_ID = 'session-test';
const TOKEN = 'test-token';
const GATEWAY = 'https://gateway.test';

beforeEach(() => {
  // Stub fetch so the initial GET hydration resolves with no terminals;
  // we're testing the event reducer, not the network path.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ terminals: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSessionTerminals.applyRunEvent', () => {
  it('inserts a new terminal on terminal_started', () => {
    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_started',
        terminalId: 'term_a',
        sessionId: SESSION_ID,
        toolName: 'bash',
        kind: 'foreground',
        command: 'echo hi',
        cwd: '/tmp',
        startedAtMs: 1_700_000_000_000,
      });
    });

    expect(result.current.terminals.length).toBe(1);
    expect(result.current.runningCount).toBe(1);
    expect(result.current.terminals[0]?.terminalId).toBe('term_a');
    expect(result.current.terminals[0]?.command).toBe('echo hi');
  });

  it('updates outputTail on terminal_output for an existing terminal', () => {
    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_started',
        terminalId: 'term_b',
        sessionId: SESSION_ID,
        toolName: 'bash',
        kind: 'foreground',
        command: 'sleep 1; echo done',
        cwd: '/tmp',
        startedAtMs: 1_700_000_000_000,
      });
    });
    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_output',
        terminalId: 'term_b',
        outputTail: 'partial line',
        outputBytesTotal: 12,
      });
    });

    expect(result.current.terminals[0]?.outputTail).toBe('partial line');
    expect(result.current.terminals[0]?.outputBytesTotal).toBe(12);
  });

  it('flips status and decrements runningCount on terminal_exited', () => {
    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_started',
        terminalId: 'term_c',
        sessionId: SESSION_ID,
        toolName: 'bash',
        kind: 'foreground',
        command: 'true',
        cwd: '/tmp',
        startedAtMs: 1_700_000_000_000,
      });
    });
    expect(result.current.runningCount).toBe(1);

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_exited',
        terminalId: 'term_c',
        status: 'exited',
        exitCode: 0,
        endedAtMs: 1_700_000_000_500,
      });
    });

    expect(result.current.runningCount).toBe(0);
    expect(result.current.terminals[0]?.status).toBe('exited');
    expect(result.current.terminals[0]?.exitCode).toBe(0);
    expect(result.current.terminals[0]?.endedAtMs).toBe(1_700_000_000_500);
  });

  it('ignores terminal_started events from a different session', () => {
    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_started',
        terminalId: 'term_other',
        sessionId: 'a-different-session',
        toolName: 'bash',
        kind: 'foreground',
        command: 'echo other',
        cwd: '/tmp',
        startedAtMs: 1_700_000_000_000,
      });
    });
    expect(result.current.terminals.length).toBe(0);
  });

  it('ignores terminal_output for an unknown terminalId', () => {
    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );
    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_output',
        terminalId: 'term_ghost',
        outputTail: 'noise',
        outputBytesTotal: 5,
      });
    });
    expect(result.current.terminals.length).toBe(0);
  });
});
