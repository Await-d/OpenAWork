// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useChatStopActiveMessage } from './use-chat-stop-active-message.js';

const stopActiveStream = vi.fn<(...args: unknown[]) => Promise<boolean>>();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({ stopActiveStream })),
}));

afterEach(() => {
  cleanup();
  stopActiveStream.mockReset();
});

function renderStopHook(overrides: Partial<Parameters<typeof useChatStopActiveMessage>[0]> = {}) {
  const loadCurrentSessionSnapshot = vi.fn(async () => undefined);
  const requestSessionListRefresh = vi.fn();
  const logger = { error: vi.fn() };
  const client = { stopStream: vi.fn(async () => true) };

  const hook = renderHook(() => {
    const currentSessionViewRef = useRef({ epoch: 7 });
    const pendingStreamRevealFrameRef = useRef<number | null>(null);
    const streamRevealTargetRef = useRef('');
    const streamRevealVisibleRef = useRef('hello');
    const streamRevealTargetCodePointsRef = useRef<string[]>([]);
    const streamRevealVisibleCodePointCountRef = useRef(0);
    const streamRevealNextAllowedAtRef = useRef(0);
    const stoppingStreamRef = useRef(false);
    const [stoppingStream, setStoppingStream] = useState(false);
    const [streamError, setStreamError] = useState<string | null>('old');

    return {
      state: { stoppingStream, streamError, stoppingStreamRef, streamRevealTargetRef },
      switchSessionView: (epoch: number) => {
        currentSessionViewRef.current = { epoch };
        stoppingStreamRef.current = false;
        setStoppingStream(false);
      },
      api: useChatStopActiveMessage({
        client,
        currentSessionId: 's1',
        gatewayUrl: 'https://gw.test',
        token: 'tok',
        stopCapability: 'best_effort',
        stoppingStream,
        streaming: false,
        initialTurnLimit: 10,
        currentSessionViewRef,
        pendingStreamRevealFrameRef,
        streamRevealTargetRef,
        streamRevealVisibleRef,
        streamRevealTargetCodePointsRef,
        streamRevealVisibleCodePointCountRef,
        streamRevealNextAllowedAtRef,
        stoppingStreamRef,
        setStoppingStream,
        setStreamError,
        loadCurrentSessionSnapshot,
        requestSessionListRefresh,
        logger,
        ...overrides,
      }),
    };
  });

  return { hook, loadCurrentSessionSnapshot, requestSessionListRefresh, logger, client };
}

describe('useChatStopActiveMessage', () => {
  it('best_effort 停止失败时会刷新快照并写入错误', async () => {
    stopActiveStream.mockResolvedValue(false);
    const { hook, loadCurrentSessionSnapshot, requestSessionListRefresh } = renderStopHook();

    await act(async () => {
      await hook.result.current.api.stopActiveMessage();
    });

    expect(loadCurrentSessionSnapshot).toHaveBeenCalledWith('s1', {
      expectedSessionViewEpoch: 7,
      messageLimit: 10,
    });
    expect(requestSessionListRefresh).not.toHaveBeenCalled();
    expect(hook.result.current.state.streamError).toBe(
      '当前会话没有可停止的活动运行，正在刷新状态。',
    );
    expect(hook.result.current.state.stoppingStream).toBe(false);
    expect(hook.result.current.state.stoppingStreamRef.current).toBe(false);
  });

  it('precise 停止异常时会记录日志并回填错误', async () => {
    const error = new Error('boom');
    const { hook, logger, client } = renderStopHook({ stopCapability: 'precise', streaming: true });
    client.stopStream.mockRejectedValue(error);

    await act(async () => {
      await hook.result.current.api.stopActiveMessage();
    });

    expect(logger.error).toHaveBeenCalledWith('stop stream failed', error);
    expect(hook.result.current.state.streamError).toBe('boom');
    expect(hook.result.current.state.stoppingStreamRef.current).toBe(false);
  });

  it.each(['rejected', 'not-stopped', 'stopped'] as const)(
    '切换会话后忽略旧停止结果：%s',
    async (outcome) => {
      const { client, hook, loadCurrentSessionSnapshot, requestSessionListRefresh } =
        renderStopHook({
          stopCapability: 'precise',
        });
      let finishOldStop: (() => void) | undefined;
      let finishNewStop: (() => void) | undefined;
      client.stopStream
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve, reject) => {
              finishOldStop = () => {
                if (outcome === 'rejected') reject(new Error('旧请求失败'));
                else resolve(outcome === 'stopped');
              };
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finishNewStop = () => resolve(true);
            }),
        );

      let oldResult: Promise<void> | undefined;
      let newResult: Promise<void> | undefined;
      act(() => {
        oldResult = hook.result.current.api.stopActiveMessage();
        hook.result.current.switchSessionView(8);
      });
      act(() => {
        newResult = hook.result.current.api.stopActiveMessage();
      });
      expect(client.stopStream).toHaveBeenCalledTimes(2);
      await act(async () => {
        finishOldStop?.();
        await oldResult;
      });

      expect(hook.result.current.state.stoppingStream).toBe(true);
      expect(hook.result.current.state.stoppingStreamRef.current).toBe(true);
      expect(hook.result.current.state.streamError).toBeNull();
      expect(loadCurrentSessionSnapshot).not.toHaveBeenCalled();
      expect(requestSessionListRefresh).not.toHaveBeenCalled();

      await act(async () => {
        finishNewStop?.();
        await newResult;
      });
      expect(hook.result.current.state.stoppingStream).toBe(false);
    },
  );
});
