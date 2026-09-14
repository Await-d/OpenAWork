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
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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

/**
 * 兜底同步（reconcile）覆盖。
 *
 * 这些用例针对的是"RunEvent 没送到"的现实场景：聊天流断线、后台标签页
 * 被节流、后端重启。断言的是本地状态能否靠服务端快照自行收敛，而不是
 * 依赖某条具体事件。
 */
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeServerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    terminalId: 'term_sync',
    sessionId: SESSION_ID,
    toolName: 'bash',
    kind: 'foreground',
    command: 'npm run dev',
    cwd: '/tmp',
    status: 'running',
    startedAtMs: now,
    lastActivityMs: now,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

describe('useSessionTerminals 兜底同步', () => {
  it('静默同步把服务端最新状态对齐回本地', async () => {
    let rows: unknown[] = [makeServerRow()];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ terminals: rows })),
    );

    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    await waitFor(() => expect(result.current.terminals.length).toBe(1));
    expect(result.current.lastSyncedAtMs).not.toBeNull();

    // 服务端侧已经结束，但没有任何 terminal_exited 事件到达。
    rows = [makeServerRow({ status: 'exited', exitCode: 0, endedAtMs: Date.now() })];
    act(() => {
      result.current.refreshSilently();
    });

    await waitFor(() => expect(result.current.terminals[0]?.status).toBe('exited'));
  });

  it('页面切回前台时立即对齐一次', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ terminals: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );

    await waitFor(() => expect(result.current.lastSyncedAtMs).not.toBeNull());
    const callsAfterHydration = fetchMock.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterHydration));
  });

  it('刚启动的终端不会被一次滞后的空快照抹掉', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ terminals: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.applyRunEvent({
        type: 'terminal_started',
        terminalId: 'term_just_started',
        sessionId: SESSION_ID,
        toolName: 'bash',
        kind: 'foreground',
        command: 'npm run dev',
        cwd: '/tmp',
        startedAtMs: Date.now(),
      });
    });
    expect(result.current.terminals.length).toBe(1);

    const callsBefore = fetchMock.mock.calls.length;
    act(() => {
      result.current.refreshSilently();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));

    // 服务端快照还没看到这条刚插入的记录，本地行必须保留，避免闪烁。
    expect(result.current.terminals.length).toBe(1);
  });

  it('同步失败时留下错误信息，且不破坏已有快照', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ terminals: [makeServerRow()] })),
    );

    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );
    await waitFor(() => expect(result.current.terminals.length).toBe(1));
    const syncedAt = result.current.lastSyncedAtMs;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    act(() => {
      result.current.refreshSilently();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.terminals.length).toBe(1);
    expect(result.current.lastSyncedAtMs).toBe(syncedAt);
  });

  it('killTerminals 逐条命中终止接口', async () => {
    const killedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/kill')) {
          killedUrls.push(url);
          return jsonResponse({
            result: { found: true, alreadyClosed: false, killed: true },
            terminal: null,
          });
        }
        return jsonResponse({ terminals: [] });
      }),
    );

    const { result } = renderHook(() =>
      useSessionTerminals({ currentSessionId: SESSION_ID, gatewayUrl: GATEWAY, token: TOKEN }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.killTerminals(['term_a', 'term_b']);
    });

    expect(killedUrls.length).toBe(2);
    expect(killedUrls.some((url) => url.includes('term_a'))).toBe(true);
    expect(killedUrls.some((url) => url.includes('term_b'))).toBe(true);
  });
});
