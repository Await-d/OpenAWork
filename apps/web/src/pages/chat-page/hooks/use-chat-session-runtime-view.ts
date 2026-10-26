import { useLayoutEffect, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';

import type { UpstreamStreamSummary } from '@openAwork/shared';
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
  SessionActiveStream,
  SessionTask,
} from '@openAwork/web-client';

import type { GatewayClient } from '../../../hooks/gateway/useGatewayClient.js';
import type { ChatMessagePart } from '../../../components/conversation-runtime/messages/support.js';
import {
  resolveSessionStopCapability,
  shouldPollSessionRuntime,
  type SessionStateStatus,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import {
  recoveredStreamHasVisibleContent,
  type RecoveredActiveAssistantStream,
} from '../../../components/conversation-runtime/stream/stream-recovery.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import {
  extractStreamingThinkingTexts,
  joinStreamingThinkingTexts,
  type StreamingThinkingBlock,
} from '../../../components/conversation-runtime/stream/streaming-thinking.js';

type UseChatSessionRuntimeViewDeps = {
  readonly activeStreamRoundStartedAt: number | null;
  readonly activeStreamStartedAt: number | null;
  readonly attachRetryScheduledSessionId: string | null;
  readonly client: GatewayClient;
  readonly currentAssistantStreamMessageIdRef: MutableRefObject<string | null>;
  readonly currentSessionId: string | null;
  readonly inlinePermissionPendingDecision: { readonly requestId: string } | null;
  readonly inlineQuestionReplyStatus: string | null;
  readonly isPageActive: boolean;
  readonly isSessionLoading: boolean;
  readonly isSessionSnapshotReady: boolean;
  readonly latestUpstreamSummary: UpstreamStreamSummary | null;
  readonly pendingPermissions: PendingPermissionRequest[];
  readonly pendingQuestions: PendingQuestionRequest[];
  readonly recoveredStreamSnapshot: RecoveredActiveAssistantStream | null;
  readonly recoveryActiveStream: SessionActiveStream | null;
  readonly reportedStreamUsage: ChatBackendUsageSnapshot | null;
  readonly sessionModesHydrated: boolean;
  readonly sessionStateStatus: SessionStateStatus | null | undefined;
  readonly sessionTasks: SessionTask[];
  readonly streamBuffer: string;
  readonly streamThinkingBlocks: StreamingThinkingBlock[];
  readonly streamThinkingBuffer: string;
  readonly streaming: boolean;
  readonly streamingSegments: ChatMessagePart[];
  readonly token: string | null;
};

/**
 * 会话运行态派生域：流式展示态、停止能力、轮询门控与实时气泡 id。
 *
 * 从 `ChatPage` 抽出的纯派生层（只读入参 + 一个镜像 state），正文逐字保留。
 */
export function useChatSessionRuntimeView(deps: UseChatSessionRuntimeViewDeps) {
  const {
    activeStreamRoundStartedAt,
    activeStreamStartedAt,
    attachRetryScheduledSessionId,
    client,
    currentAssistantStreamMessageIdRef,
    currentSessionId,
    inlinePermissionPendingDecision,
    inlineQuestionReplyStatus,
    isPageActive,
    isSessionLoading,
    isSessionSnapshotReady,
    latestUpstreamSummary,
    pendingPermissions,
    pendingQuestions,
    recoveredStreamSnapshot,
    recoveryActiveStream,
    reportedStreamUsage,
    sessionModesHydrated,
    sessionStateStatus,
    sessionTasks,
    streamBuffer,
    streamThinkingBlocks,
    streamThinkingBuffer,
    streaming,
    streamingSegments,
    token,
  } = deps;

  const remoteSessionBusyState = useMemo<Extract<
    SessionStateStatus,
    'running' | 'paused'
  > | null>(() => {
    if (streaming) {
      return null;
    }

    // 如果刚发送消息（5秒内），不显示"正在重新接入"提示
    // 这是正常的发送流程，不是远程流恢复场景
    const timeSinceStreamStart =
      activeStreamStartedAt !== null ? Date.now() - activeStreamStartedAt : Infinity;
    if (timeSinceStreamStart < 5000) {
      return null;
    }

    // 有待处理交互（权限/提问）时，会话实质处于 paused；必须在这里返回，
    // 否则下面的 idle 提前返回会让 remoteSessionBusyState 变成 null，
    // 进而关闭 /recovery 轮询（见下方 useEffect 的门控），前端就再也学不到
    // 服务端的 paused 状态，只能整页刷新。
    if (pendingPermissions.length > 0 || pendingQuestions.length > 0) {
      return 'paused';
    }

    // 如果会话状态是 idle 且没有 active stream，不应该显示忙碌状态
    if (sessionStateStatus === 'idle' && recoveryActiveStream === null) {
      return null;
    }

    if (sessionStateStatus === 'running' || sessionStateStatus === 'paused') {
      return sessionStateStatus;
    }

    if (recoveryActiveStream !== null) {
      return 'running';
    }

    return null;
  }, [
    activeStreamStartedAt,
    pendingPermissions,
    pendingQuestions,
    recoveryActiveStream,
    sessionStateStatus,
    streaming,
  ]);

  /**
   * composer 专用的占用态：只回答「现在能不能发消息」，与上面的展示态分离。
   *
   * `remoteSessionBusyState` 在有待办交互时**无条件**收敛成 `'paused'`，即使
   * `sessionStateStatus` 仍是 `'running'`（批量审批续跑中 / 另一端发起了新一轮，都是
   * 真实存在的瞬态——见 `resolveSessionStopCapability` 的同款注释）。
   *
   * 那种双轨态下网关**确实**持有单飞锁，硬发必被拒成 SESSION_ALREADY_RUNNING：用户消息
   * 只有乐观气泡、不会落库，等于白丢一条。所以这里把「paused 且 running」升级回
   * `'running'` 交回禁用/排队语义。
   *
   * 展示侧不跟着变：状态条要继续说「等待审批 / 等待回答」，而不是「持续运行中」。
   */
  const composerSessionBusyState = useMemo<'running' | 'paused' | null>(() => {
    // 回复问题 / 权限的 HTTP 请求尚未完成时，后台续跑即将启动。
    // 先按 running 处理，避免用户在状态刷新竞态窗口里抢发消息。
    if (inlineQuestionReplyStatus !== null || inlinePermissionPendingDecision !== null) {
      return 'running';
    }

    if (remoteSessionBusyState === 'paused' && sessionStateStatus === 'running') {
      return 'running';
    }
    return remoteSessionBusyState;
  }, [
    inlinePermissionPendingDecision,
    inlineQuestionReplyStatus,
    remoteSessionBusyState,
    sessionStateStatus,
  ]);

  // 有 attach 重试待触发且归属当前会话 = 客户端正在重新接入；用于状态条显示「恢复中」。
  const sessionReconnecting =
    currentSessionId !== null &&
    attachRetryScheduledSessionId !== null &&
    attachRetryScheduledSessionId === currentSessionId;
  const activeGatewayStreamSessionId = client.getActiveStreamSessionId();
  const isCurrentSessionRunning = sessionStateStatus === 'running';
  const canStopCurrentSessionStream = Boolean(
    currentSessionId &&
    activeGatewayStreamSessionId === currentSessionId &&
    (streaming || isCurrentSessionRunning),
  );
  const stopCapability = useMemo<'none' | 'precise' | 'best_effort' | 'observe_only'>(() => {
    return resolveSessionStopCapability({
      canStopCurrentSessionStream,
      currentSessionId,
      remoteSessionBusyState,
      sessionStateStatus,
      streaming,
    });
  }, [
    canStopCurrentSessionStream,
    currentSessionId,
    remoteSessionBusyState,
    sessionStateStatus,
    streaming,
  ]);

  // `visibleStreaming` 保持「**流式态**」语义（滚动跟随 / 输入框形态 / 停止按钮都用它）：
  // 只要本端在流式，或网关还有活跃流快照，就仍算流式。
  const visibleStreaming = streaming || recoveredStreamSnapshot !== null;

  /**
   * 是否应该渲染**实时气泡**。
   *
   * 与 `visibleStreaming` 分开：恢复快照在「上一轮已落库、下一轮还没开始」时是空的
   * （只带 `usage` / `upstreamSummary`）。若拿它撑起实时气泡，渲染层会造一条
   * `status: 'streaming'` 的空消息，`mergeStreamingEntryIntoHistoricalEntries` 再按
   * `clientRequestId` 精确匹配到历史上刚结束的那一轮并**用它替换** —— 内容是瞬间消失的。
   * 所以气泡是否出现必须以快照里**有没有可见内容**为准，而流式态不受影响。
   */
  const visibleStreamRenderable =
    streaming ||
    (recoveredStreamSnapshot !== null && recoveredStreamHasVisibleContent(recoveredStreamSnapshot));
  const visibleStreamBuffer = streaming ? streamBuffer : (recoveredStreamSnapshot?.text ?? '');
  const visibleStreamThinkingBlocks = streaming
    ? extractStreamingThinkingTexts(streamThinkingBlocks)
    : extractStreamingThinkingTexts(recoveredStreamSnapshot?.thinkingBlocks ?? []);
  const visibleStreamThinkingBuffer = streaming
    ? streamThinkingBuffer
    : joinStreamingThinkingTexts(recoveredStreamSnapshot?.thinkingBlocks ?? []);
  const visibleStreamStartedAt = streaming
    ? activeStreamStartedAt
    : (recoveredStreamSnapshot?.startedAt ?? null);
  // 实时气泡的 createdAt 必须落在**本轮**（网关按轮持久化），否则同请求内已提交的
  // 轮次时间戳更晚，排序会把实时气泡顶到最上面。恢复快照的 startedAt 就是本轮起点。
  const activeStreamRoundStart =
    streaming && activeStreamRoundStartedAt !== null
      ? activeStreamRoundStartedAt
      : visibleStreamStartedAt;
  const visibleReportedStreamUsage = reportedStreamUsage ?? recoveredStreamSnapshot?.usage ?? null;
  const visibleLatestUpstreamSummary =
    latestUpstreamSummary ?? recoveredStreamSnapshot?.upstreamSummary ?? null;
  // Surfaces the wire-faithful ordered parts during an active stream so the
  // live render reflects gateway event order. During recovery (before the
  // live attach completes) the real segment list is still empty, so we
  // synthesize ordered parts from the snapshot's thinking blocks + text.
  // This preserves `startedAt` / `endedAt` on reasoning parts so the UI
  // correctly marks ended thinking blocks instead of showing an infinite
  // streaming cursor.
  const visibleStreamingSegments = streaming
    ? streamingSegments
    : recoveredStreamSnapshot
      ? recoveredStreamSnapshot.parts
      : [];

  /**
   * 实时助手占位消息 id。真源是 `currentAssistantStreamMessageIdRef`（由
   * `start-standard-chat-stream` / `commit-streaming-round` / attach effect 在异步
   * 回调里改写），但渲染期（`useChatRenderData` 的 id 与排序判定）需要它的值，
   * 而渲染期读 ref 会被 React Compiler 判定为 "Cannot access refs during render"
   * 并放弃优化调用方组件。故镜像到 state：layout effect 无依赖、每次提交后同步
   * 读取 ref，值变化时才 setState——值变化必定伴随一次渲染，而下一次渲染由
   * layout effect 在**绘制前**同步冲刷，因此首帧可见输出与改前一致。
   *
   * 用**先比对、再 setState**而不是只依赖同值 updater 兜底：
   * `setState(prev => prev === next ? prev : next)` 在同值时的确会被 React 的 eager
   * bailout 丢弃，但那次比较本身仍有成本，且依赖 bailout 生效的**前提**（fiber 无
   * 待办 lane）在并发渲染下不显然；先比对能直接省掉这次 dispatch。
   */
  const [activeStreamMessageId, setActiveStreamMessageId] = useState<string | null>(null);
  useLayoutEffect(() => {
    const nextActiveStreamMessageId =
      currentAssistantStreamMessageIdRef.current ?? recoveredStreamSnapshot?.messageId ?? null;
    if (activeStreamMessageId === nextActiveStreamMessageId) {
      return;
    }
    setActiveStreamMessageId(nextActiveStreamMessageId);
  });

  const shouldPollSessionSubresources = useMemo(
    () =>
      Boolean(
        currentSessionId &&
        token &&
        isPageActive &&
        isSessionSnapshotReady &&
        !isSessionLoading &&
        remoteSessionBusyState === null &&
        sessionModesHydrated &&
        shouldPollSessionRuntime({
          pendingPermissions,
          sessionStateStatus,
          sessionTasks,
          streaming,
        }),
      ),
    [
      currentSessionId,
      isPageActive,
      isSessionLoading,
      isSessionSnapshotReady,
      pendingPermissions,
      remoteSessionBusyState,
      sessionModesHydrated,
      sessionStateStatus,
      sessionTasks,
      streaming,
      token,
    ],
  );

  return {
    activeStreamMessageId,
    activeStreamRoundStart,
    canStopCurrentSessionStream,
    composerSessionBusyState,
    isCurrentSessionRunning,
    remoteSessionBusyState,
    sessionReconnecting,
    shouldPollSessionSubresources,
    stopCapability,
    visibleLatestUpstreamSummary,
    visibleReportedStreamUsage,
    visibleStreamBuffer,
    visibleStreamRenderable,
    visibleStreamStartedAt,
    visibleStreamThinkingBlocks,
    visibleStreamThinkingBuffer,
    visibleStreaming,
    visibleStreamingSegments,
  };
}
