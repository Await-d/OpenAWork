// @vitest-environment jsdom
/**
 * `useSessionSnapshotLoader` 的增量续读**接线**测试。
 *
 * 纯逻辑（何时带游标 / 何时重载）已由 `recovery-run-event-buffer.test.ts` 覆盖；这里只钉
 * 三件只能在这一层验证的事：
 *  1. 开关开启时，冷启动不带 `runEventAfterSeq`，其后每拍带上一拍交付到的游标；
 *  2. 增量拼装后的完整序列真的喂给了下游（`recoverActiveAssistantStream` 重建出的文本
 *     等于「前缀 + 增量」）—— 这是本优化「对下游无感」的承诺；
 *  3. 换了 run 时**额外**发一次不带游标的全量请求，并且最终下游拿到的是新 run 的内容
 *     （不是把两个 run 的事件拼在一起）。
 */
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import type { RunEvent } from '@openAwork/shared';
import type { RecoveredActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';
import type { Session, SessionRecoveryReadModel } from '@openAwork/web-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRecovery = vi.fn();
const getStatus = vi.fn();

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    // 只替换会话客户端：同模块的纯转换函数（toPendingPermissionRequests 等）必须保持真实，
    // 否则 prepareSessionRecoveryState 这条真实路径会因缺导出而直接抛错。
    createSessionsClient: () => ({ getRecovery, getStatus }),
  };
});

const { useSessionSnapshotLoader } = await import('./use-session-snapshot-loader.js');
type SessionSnapshotLoaderReturn =
  import('./use-session-snapshot-loader.js').SessionSnapshotLoaderReturn;

const SESSION_ID = 'session-1';
const TOKEN = 'token-1';

function textDelta(delta: string): RunEvent {
  return {
    type: 'text_delta',
    delta,
    eventId: `evt-${delta}`,
    runId: 'run-1',
    occurredAt: 500,
  } as RunEvent;
}

function makeRecovery(input: {
  clientRequestId: string;
  lastSeq: number;
  runEventCursor?: number | null;
  runEvents: RunEvent[];
}): SessionRecoveryReadModel {
  return {
    activeStream: {
      clientRequestId: input.clientRequestId,
      heartbeatAtMs: 1,
      lastSeq: input.lastSeq,
      sessionId: SESSION_ID,
      startedAtMs: 0,
    },
    children: [],
    pendingPermissions: [],
    pendingQuestions: [],
    ratings: [],
    runEventCursor: input.runEventCursor ?? null,
    session: { id: SESSION_ID, messages: [], runEvents: input.runEvents } as unknown as Session,
    tasks: [],
    todoLanes: { main: [], temp: [] },
  };
}

function createSetters() {
  return {
    setChildSessions: vi.fn(),
    setIsSessionSnapshotReady: vi.fn(),
    setLatestUpstreamSummary: vi.fn(),
    setMessageRatings: vi.fn(),
    setMessages: vi.fn(),
    setPendingPermissions: vi.fn(),
    setPendingQuestions: vi.fn(),
    setRecoveredStreamSnapshot: vi.fn(),
    setRightPanelState: vi.fn(),
    setSessionStateStatus: vi.fn(),
    setSessionTasks: vi.fn(),
    setSessionTodos: vi.fn(),
    setSubagentNotices: vi.fn(),
    setWorkflowRuntime: vi.fn(),
    setRecoveryActiveStream: vi.fn(),
  };
}

function mountLoader() {
  const setters = createSetters();
  let loader: SessionSnapshotLoaderReturn | null = null;

  function Harness() {
    const currentSessionViewRef = useRef({ epoch: 1, sessionId: SESSION_ID });
    const streamingRef = useRef(false);
    loader = useSessionSnapshotLoader(
      'http://gateway.test',
      TOKEN,
      () => true,
      { currentSessionViewRef, streamingRef },
      setters,
    );
    return null;
  }

  render(<Harness />);
  return { loader: loader as SessionSnapshotLoaderReturn | null, setters };
}

function optionsOf(callIndex: number): Record<string, unknown> {
  const args = getRecovery.mock.calls[callIndex];
  return (args?.[2] ?? {}) as Record<string, unknown>;
}

function recoveredText(setters: ReturnType<typeof createSetters>): string | undefined {
  const last = setters.setRecoveredStreamSnapshot.mock.calls.at(-1)?.[0] as
    RecoveredActiveAssistantStream | null | undefined;
  return last?.text;
}

beforeEach(() => {
  getRecovery.mockReset();
  getStatus.mockReset();
});

describe('useSessionSnapshotLoader 增量续读接线', () => {
  it('冷启动不带游标，其后每拍带上上一拍交付到的游标，且下游拿到拼接后的完整序列', async () => {
    getRecovery
      .mockResolvedValueOnce(
        makeRecovery({
          clientRequestId: 'req-1',
          lastSeq: 2,
          runEvents: [textDelta('a'), textDelta('b')],
        }),
      )
      .mockResolvedValueOnce(
        makeRecovery({
          clientRequestId: 'req-1',
          lastSeq: 3,
          runEventCursor: 3,
          runEvents: [textDelta('c')],
        }),
      );
    const { loader, setters } = mountLoader();

    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });

    expect(optionsOf(0)).toMatchObject({ messageLimit: 10 });
    expect(optionsOf(0)).not.toHaveProperty('runEventAfterSeq');
    expect(recoveredText(setters)).toBe('ab');

    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });

    expect(optionsOf(1)).toMatchObject({ messageLimit: 10, runEventAfterSeq: 2 });
    expect(recoveredText(setters)).toBe('abc');
  });

  it('本次没有新事件（游标为 null）时保持原游标，不触发重载', async () => {
    getRecovery
      .mockResolvedValueOnce(
        makeRecovery({ clientRequestId: 'req-1', lastSeq: 2, runEvents: [textDelta('a')] }),
      )
      .mockResolvedValueOnce(
        makeRecovery({ clientRequestId: 'req-1', lastSeq: 2, runEventCursor: null, runEvents: [] }),
      );
    const { loader } = mountLoader();

    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });
    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });

    expect(getRecovery).toHaveBeenCalledTimes(2);
    expect(optionsOf(1)).toMatchObject({ runEventAfterSeq: 2 });
  });

  it('换了 run 时额外发一次无游标全量请求，且不把两个 run 的事件拼在一起', async () => {
    getRecovery
      .mockResolvedValueOnce(
        makeRecovery({ clientRequestId: 'req-1', lastSeq: 2, runEvents: [textDelta('a')] }),
      )
      // 第二拍：新一轮 run（scope 变了），服务端只能给新 scope 的增量
      .mockResolvedValueOnce(
        makeRecovery({
          clientRequestId: 'req-2',
          lastSeq: 1,
          runEventCursor: 1,
          runEvents: [textDelta('z')],
        }),
      )
      // 重载：新 run 的全量
      .mockResolvedValueOnce(
        makeRecovery({
          clientRequestId: 'req-2',
          lastSeq: 1,
          runEvents: [textDelta('x'), textDelta('y')],
        }),
      );
    const { loader, setters } = mountLoader();

    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });
    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, {
        incrementalRunEvents: true,
        messageLimit: 10,
      });
    });

    expect(getRecovery).toHaveBeenCalledTimes(3);
    expect(optionsOf(1)).toMatchObject({ runEventAfterSeq: 2 });
    // 重载那一拍不带游标，且下游拿到的是新 run 的完整序列（不含上一个 run 的 'a'）
    expect(optionsOf(2)).not.toHaveProperty('runEventAfterSeq');
    expect(recoveredText(setters)).toBe('xy');
  });

  it('未开启增量开关时永不带游标（既有调用方语义不变）', async () => {
    getRecovery
      .mockResolvedValueOnce(
        makeRecovery({ clientRequestId: 'req-1', lastSeq: 2, runEvents: [textDelta('a')] }),
      )
      .mockResolvedValueOnce(
        makeRecovery({
          clientRequestId: 'req-1',
          lastSeq: 3,
          runEvents: [textDelta('a'), textDelta('b')],
        }),
      );
    const { loader } = mountLoader();

    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, { messageLimit: 10 });
    });
    await act(async () => {
      await loader?.loadCurrentSessionSnapshot(SESSION_ID, { messageLimit: 10 });
    });

    expect(getRecovery).toHaveBeenCalledTimes(2);
    expect(optionsOf(0)).not.toHaveProperty('runEventAfterSeq');
    expect(optionsOf(1)).not.toHaveProperty('runEventAfterSeq');
  });
});
