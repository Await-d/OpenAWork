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
});
