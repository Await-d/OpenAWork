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

/**
 * D-1 回归：`reload()` 只负责「重新拉取」，不得清空本地终端快照。
 *
 * 真实场景：打开终端抽屉 → 建第 1 个终端 → 再建第 2 个时
 * `QuickTerminalPanel` 会调用 `onReload()`。若 reload 路径把
 * `terminalsById` 清空，`terminals` 会出现一次「由 N(>0) 变 0」的渲染，
 * `TerminalPanel` 的折叠 effect 就会把整个抽屉收起（清单项 12a FAIL）。
 *
 * 身份变化（session / gateway / token）仍然必须清空，避免泄漏上一个会话
 * 的终端 —— 两个用例分别锁定这两条互相对立的语义。
 */
const NEXT_SESSION_ID = 'session-next';

describe('useSessionTerminals reload 快照连续性（D-1 回归）', () => {
  it('reload() 重新同步期间终端数不会出现 >0 → 0 的渲染', async () => {
    const rows = [
      makeServerRow({ terminalId: 'term_one' }),
      makeServerRow({ terminalId: 'term_two' }),
    ];
    const fetchMock = vi.fn(async () => jsonResponse({ terminals: rows }));
    vi.stubGlobal('fetch', fetchMock);

    // 逐帧记录每次渲染观测到的终端数：任何瞬时空快照都会在这里留下 0。
    const observedCounts: number[] = [];
    const { result } = renderHook(() => {
      const state = useSessionTerminals({
        currentSessionId: SESSION_ID,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      });
      observedCounts.push(state.terminals.length);
      return state;
    });

    await waitFor(() => expect(result.current.terminals.length).toBe(2));

    const observedBeforeReload = observedCounts.length;
    const callsBeforeReload = fetchMock.mock.calls.length;
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeReload));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const afterReload = observedCounts.slice(observedBeforeReload);
    // reload 窗口内确实有渲染帧可断（避免「没渲染所以没塌」的假绿）。
    expect(afterReload.some((count) => count > 0)).toBe(true);

    const drops: string[] = [];
    for (let index = 1; index < afterReload.length; index += 1) {
      const previous = afterReload[index - 1] ?? 0;
      const current = afterReload[index] ?? 0;
      if (previous > 0 && current === 0) {
        drops.push(`#${index}: ${previous} → ${current}`);
      }
    }
    expect(drops).toEqual([]);
    expect(result.current.terminals.length).toBe(2);
  });

  it('切换 currentSessionId 仍然立刻清空旧会话终端', async () => {
    let releaseNextSession: (() => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(NEXT_SESSION_ID)) {
        // 新会话的首轮快照手动延迟交付：先断言「立刻清空」，
        // 而不是被新会话自己的快照掩盖。
        return new Promise<Response>((resolve) => {
          releaseNextSession = () =>
            resolve(
              jsonResponse({
                terminals: [makeServerRow({ terminalId: 'term_next', sessionId: NEXT_SESSION_ID })],
              }),
            );
        });
      }
      return Promise.resolve(
        jsonResponse({
          terminals: [
            makeServerRow({ terminalId: 'term_one' }),
            makeServerRow({ terminalId: 'term_two' }),
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      (props: { sessionId: string }) =>
        useSessionTerminals({
          currentSessionId: props.sessionId,
          gatewayUrl: GATEWAY,
          token: TOKEN,
        }),
      { initialProps: { sessionId: SESSION_ID } },
    );

    await waitFor(() => expect(result.current.terminals.length).toBe(2));

    rerender({ sessionId: NEXT_SESSION_ID });
    expect(result.current.terminals.length).toBe(0);

    await act(async () => {
      releaseNextSession?.();
    });
    await waitFor(() =>
      expect(result.current.terminals.map((terminal) => terminal.terminalId)).toEqual([
        'term_next',
      ]),
    );
  });
});
