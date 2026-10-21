import { useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
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

/**
 * 停止当前对话运行的统一包装：run 全流程留在 try 内，catch 交给 onError（无 finally）。
 *
 * 必须留在模块级：try 内的逻辑 / 三元 / Boolean(...) 都是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个 hook（实测）。
 * 语义逐字照搬。
 */
async function runStopActiveMessageOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
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

    // 本 hook 的 ref 全部由调用方（ChatPage 共享 ref 池）创建后作为参数传入，
    // 直接写 .current 会被 React Compiler 判为「修改 hook 参数」并放弃优化整个
    // hook——写入统一走收敛函数（见 utils/ref/ref-current.ts）。
    writeRefCurrent(stoppingStreamRef, true);
    const stopSessionViewEpoch = currentSessionViewRef.current.epoch;
    if (pendingStreamRevealFrameRef.current !== null) {
      cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      writeRefCurrent(pendingStreamRevealFrameRef, null);
    }
    writeRefCurrent(streamRevealTargetRef, streamRevealVisibleRef.current);
    const targetCodePoints = Array.from(streamRevealVisibleRef.current);
    writeRefCurrent(streamRevealTargetCodePointsRef, targetCodePoints);
    writeRefCurrent(streamRevealVisibleCodePointCountRef, targetCodePoints.length);
    writeRefCurrent(streamRevealNextAllowedAtRef, 0);
    setStoppingStream(true);
    setStreamError(null);
    await runStopActiveMessageOnce({
      onError: (error) => {
        writeRefCurrent(stoppingStreamRef, false);
        logger.error('stop stream failed', error);
        setStoppingStream(false);
        setStreamError(error instanceof Error ? error.message : '停止对话失败');
      },
      run: async () => {
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
          writeRefCurrent(stoppingStreamRef, false);
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
          writeRefCurrent(stoppingStreamRef, false);
          setStoppingStream(false);
          void (currentSessionId
            ? loadCurrentSessionSnapshot(currentSessionId, {
                expectedSessionViewEpoch: stopSessionViewEpoch,
                messageLimit: initialTurnLimit,
              }).catch(() => undefined)
            : Promise.resolve());
          requestSessionListRefresh();
        }
      },
    });
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
