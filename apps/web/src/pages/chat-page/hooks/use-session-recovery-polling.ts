import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

import { startSequentialPolling } from '../../../components/conversation-runtime/session/sequential-polling.js';
import { SESSION_RECOVERY_MESSAGE_LIMIT } from '../../../utils/session/session-recovery-flight.js';

import { REMOTE_STREAM_RECOVERY_POLL_MS } from '../conversation/render/chat-page-utils.js';

const INITIAL_TURN_LIMIT = SESSION_RECOVERY_MESSAGE_LIMIT;

type LoadSessionRuntimeSnapshot = (
  sessionId: string,
  signal: AbortSignal,
  expectedSessionViewEpoch: number,
) => Promise<unknown>;

type LoadCurrentSessionSnapshot = (
  sessionId: string,
  options: {
    expectedSessionViewEpoch: number;
    incrementalRunEvents?: boolean;
    messageLimit?: number;
    signal?: AbortSignal;
    replaceMessages?: boolean;
  },
) => Promise<unknown>;

type UseSessionRecoveryPollingDeps = {
  readonly attachRetryScheduledSessionId: string | null;
  readonly currentSessionId: string | null;
  readonly currentSessionViewRef: MutableRefObject<{ epoch: number; sessionId: string | null }>;
  readonly isPageActive: boolean;
  readonly isSessionSnapshotReady: boolean;
  readonly loadCurrentSessionSnapshot: LoadCurrentSessionSnapshot;
  readonly loadSessionRuntimeSnapshot: LoadSessionRuntimeSnapshot;
  readonly recoveryActiveStream: object | null;
  readonly remoteSessionBusyState: 'running' | 'paused' | null;
  readonly sessionModesHydrated: boolean;
  readonly shouldPollSessionSubresources: boolean;
  readonly streaming: boolean;
  readonly streamingRef: MutableRefObject<boolean>;
  readonly token: string | null;
};

/**
 * 两档轮询：
 *
 * 1. **空闲补拉**（`shouldPollSessionSubresources`）：只拉运行态快照，用于在没有
 *    活跃流时把服务端状态（任务 / 待办 / 停止能力）同步回来。
 * 2. **远端运行中轮询**（`remoteSessionBusyState`）：每秒一次，流仍在飞时只打轻量
 *    `/status`，流已结束才走全量 recovery —— 否则重连等待期会反复序列化整段会话
 *    （实测单会话约 1.6MB），主线程被打满。
 */
export function useSessionRecoveryPolling(deps: UseSessionRecoveryPollingDeps) {
  const {
    attachRetryScheduledSessionId,
    currentSessionId,
    currentSessionViewRef,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    loadSessionRuntimeSnapshot,
    recoveryActiveStream,
    remoteSessionBusyState,
    sessionModesHydrated,
    shouldPollSessionSubresources,
    streaming,
    streamingRef,
    token,
  } = deps;

  useEffect(() => {
    if (!currentSessionId || !token || !shouldPollSessionSubresources) {
      return;
    }

    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;

    const polling = startSequentialPolling({
      initialDelayMs: streaming ? 0 : 3000,
      intervalMs: 3000,
      run: async (signal) => {
        await loadSessionRuntimeSnapshot(targetSessionId, signal, expectedSessionViewEpoch);
      },
    });

    return () => {
      polling.cancel();
    };
  }, [
    currentSessionId,
    currentSessionViewRef,
    loadSessionRuntimeSnapshot,
    shouldPollSessionSubresources,
    streaming,
    token,
  ]);

  useEffect(() => {
    if (
      !currentSessionId ||
      !token ||
      !remoteSessionBusyState ||
      !isPageActive ||
      !isSessionSnapshotReady ||
      !sessionModesHydrated
    ) {
      return;
    }

    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;
    const polling = startSequentialPolling({
      initialDelayMs: REMOTE_STREAM_RECOVERY_POLL_MS,
      intervalMs: REMOTE_STREAM_RECOVERY_POLL_MS,
      run: async (signal) => {
        // During active streaming, messages arrive via SSE in real-time.
        // Use lightweight /status endpoint instead of full /recovery to
        // avoid redundant full-message queries and serialization.
        //
        // 判定必须用「本轮运行是否结束」，而不是只看 `streamingRef`：
        // attach 断开进入重连时 `handleInterruptedAttachStream` 会把 streaming
        // 置 false（内容转存到 recoveredStreamSnapshot 继续渲染），但**流并没有
        // 结束**。此时若按「非流式」走全量 `/recovery`，就会在重连等待期内反复
        // 序列化整段会话。
        const isStreamInFlight =
          streamingRef.current ||
          recoveryActiveStream !== null ||
          (attachRetryScheduledSessionId !== null &&
            attachRetryScheduledSessionId === targetSessionId);
        if (isStreamInFlight) {
          await loadSessionRuntimeSnapshot(targetSessionId, signal, expectedSessionViewEpoch);
        } else {
          await loadCurrentSessionSnapshot(targetSessionId, {
            expectedSessionViewEpoch,
            // 远端运行中的这条 1s 轮询是全程唯一会「反复」拉取活跃 scope 的调用方：
            // run event 走增量续读，单拍成本从 O(本轮已产生事件数) 降到 O(新增事件数)，
            // 下游累加 reduce 拿到的仍是完整序列（拼接由 loader 内的前缀缓冲完成）。
            incrementalRunEvents: true,
            messageLimit: INITIAL_TURN_LIMIT,
            signal,
          });
        }
      },
    });

    return () => {
      polling.cancel();
    };
  }, [
    attachRetryScheduledSessionId,
    currentSessionId,
    currentSessionViewRef,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    loadSessionRuntimeSnapshot,
    recoveryActiveStream,
    remoteSessionBusyState,
    sessionModesHydrated,
    streamingRef,
    token,
  ]);
}
