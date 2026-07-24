import { useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import type { SessionsClientWithActiveStop } from '../conversation/render/chat-page-utils.js';

export interface UseChatStopActiveMessageOptions {
  client: { stopStream: () => Promise<boolean> };
  currentSessionId: string | null;
  gatewayUrl: string;
  token: string | null;
  stopCapability: 'none' | 'precise' | 'best_effort' | 'observe_only';
  stoppingStream: boolean;
  streaming: boolean;
  initialTurnLimit: number;
  currentSessionViewRef: React.MutableRefObject<{ epoch: number }>;
  pendingStreamRevealFrameRef: React.MutableRefObject<number | null>;
  streamRevealTargetRef: React.MutableRefObject<string>;
  streamRevealVisibleRef: React.MutableRefObject<string>;
  streamRevealTargetCodePointsRef: React.MutableRefObject<string[]>;
  streamRevealVisibleCodePointCountRef: React.MutableRefObject<number>;
  streamRevealNextAllowedAtRef: React.MutableRefObject<number>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  loadCurrentSessionSnapshot: (
    sessionId: string,
    options?: { expectedSessionViewEpoch?: number; messageLimit?: number },
  ) => Promise<unknown>;
  requestSessionListRefresh: () => void;
  logger: { error: (message: string, error?: unknown) => void };
}

export function useChatStopActiveMessage(options: UseChatStopActiveMessageOptions) {
  const {
    client,
    currentSessionId,
    gatewayUrl,
    token,
    stopCapability,
    stoppingStream,
    streaming,
    initialTurnLimit,
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
  } = options;

  const stopActiveMessage = useCallback(async () => {
    if (stopCapability === 'none' || stoppingStream) {
      return;
    }

    stoppingStreamRef.current = true;
    const stopSessionViewEpoch = currentSessionViewRef.current.epoch;
    if (pendingStreamRevealFrameRef.current !== null) {
      cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      pendingStreamRevealFrameRef.current = null;
    }
    streamRevealTargetRef.current = streamRevealVisibleRef.current;
    streamRevealTargetCodePointsRef.current = Array.from(streamRevealVisibleRef.current);
    streamRevealVisibleCodePointCountRef.current = streamRevealTargetCodePointsRef.current.length;
    streamRevealNextAllowedAtRef.current = 0;
    setStoppingStream(true);
    setStreamError(null);
    try {
      const sessionsClient = createSessionsClient(gatewayUrl) as SessionsClientWithActiveStop;
      const useRemoteStop = stopCapability === 'best_effort' || stopCapability === 'observe_only';
      const stopped = useRemoteStop
        ? Boolean(
            currentSessionId &&
            token &&
            (await sessionsClient.stopActiveStream(token, currentSessionId)),
          )
        : await client.stopStream();
      if (!stopped) {
        stoppingStreamRef.current = false;
        setStoppingStream(false);
        void (currentSessionId
          ? loadCurrentSessionSnapshot(currentSessionId, {
              expectedSessionViewEpoch: stopSessionViewEpoch,
              messageLimit: initialTurnLimit,
            }).catch(() => undefined)
          : Promise.resolve());
        if (useRemoteStop) {
          setStreamError('当前会话没有可停止的活动运行，正在刷新状态。');
        } else {
          setStreamError('当前运行控制句柄已失效，正在刷新会话状态。');
        }
        return;
      }

      if (useRemoteStop || !streaming) {
        stoppingStreamRef.current = false;
        setStoppingStream(false);
        void (currentSessionId
          ? loadCurrentSessionSnapshot(currentSessionId, {
              expectedSessionViewEpoch: stopSessionViewEpoch,
              messageLimit: initialTurnLimit,
            }).catch(() => undefined)
          : Promise.resolve());
        requestSessionListRefresh();
      }
    } catch (error) {
      stoppingStreamRef.current = false;
      logger.error('stop stream failed', error);
      setStoppingStream(false);
      setStreamError(error instanceof Error ? error.message : '停止对话失败');
    }
  }, [
    client,
    currentSessionId,
    currentSessionViewRef,
    gatewayUrl,
    initialTurnLimit,
    loadCurrentSessionSnapshot,
    logger,
    pendingStreamRevealFrameRef,
    requestSessionListRefresh,
    setStoppingStream,
    setStreamError,
    stopCapability,
    stoppingStream,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streaming,
    token,
  ]);

  return { stopActiveMessage };
}
