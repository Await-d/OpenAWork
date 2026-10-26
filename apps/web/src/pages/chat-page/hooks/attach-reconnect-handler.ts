import { createSessionsClient } from '@openAwork/web-client';

import { handleInterruptedAttachStream } from '../../../components/conversation-runtime/attach/attach-stream-reconnect.js';
import type { AttachStreamCloseReason } from '../../../components/conversation-runtime/attach/attach-stream-reconnect-wiring.js';
import type {
  AssistantTraceToolCall,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import type { RecoveredActiveAssistantStream } from '../../../components/conversation-runtime/stream/stream-recovery.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import { SESSION_RECOVERY_MESSAGE_LIMIT } from '../../../utils/session/session-recovery-flight.js';

import {
  STABLE_ATTACH_WINDOW_MS,
  createInitialAttachProgressState,
  resolveDisconnectRetryDelayMs,
  resolveSilentCloseRetryDelayMs,
} from './attach-effect-retry-policy.js';
import type { SessionAttachDeps } from './session-attach-deps.js';

const INITIAL_TURN_LIMIT = SESSION_RECOVERY_MESSAGE_LIMIT;

/** attach 断开后的收尾决策：先确认流是否仍在，再选择收敛 / 低频等待 / 退避重连。 */
export type AttachReconnectContext = Pick<
  SessionAttachDeps,
  | 'attachAttemptWindowRef'
  | 'attachAttemptedSessionRef'
  | 'attachProgressRef'
  | 'cancelAttachRetry'
  | 'client'
  | 'currentAssistantStreamMessageIdRef'
  | 'gatewayUrl'
  | 'isCurrentSessionRequest'
  | 'loadCurrentSessionSnapshot'
  | 'pendingStreamRevealFrameRef'
  | 'scheduleAttachRetry'
  | 'setActiveStreamFirstTokenLatencyMs'
  | 'setActiveStreamStartedAt'
  | 'setRecoveredStreamSnapshot'
  | 'setSessionStateStatus'
  | 'setStoppingStream'
  | 'setStreamBuffer'
  | 'setStreamError'
  | 'setStreaming'
  | 'setStreamingSegments'
  | 'setStreamThinkingBlocks'
  | 'setStreamThinkingBuffer'
  | 'stoppingStreamRef'
  | 'streamRevealNextAllowedAtRef'
  | 'streamRevealTargetCodePointsRef'
  | 'streamRevealTargetRef'
  | 'streamRevealVisibleCodePointCountRef'
  | 'streamRevealVisibleRef'
  | 'streamingRef'
  | 'visibleLatestUpstreamSummary'
  | 'token'
> & {
  readonly sid: string;
  readonly requestSessionListRefresh: () => void;
  readonly attachSessionViewEpoch: number;
  readonly attachStateInitialized: boolean;
  readonly accumulated: string;
  readonly accumulatedSegments: ChatMessagePart[];
  readonly accumulatedThinkingBlocks: StreamingThinkingBlock[];
  readonly accumulatedUsage: ChatBackendUsageSnapshot | null;
  readonly requestStartedAt: number;
  readonly recoveredModifiedFilesSummary: RecoveredActiveAssistantStream['modifiedFilesSummary'];
  readonly buildAttachToolCalls: () => AssistantTraceToolCall[];
  readonly getActiveSessionId: () => string | null;
};

export function runAttachReconnect(
  ctx: AttachReconnectContext,
  reason?: AttachStreamCloseReason,
  technicalDetail?: string,
): void {
  const {
    attachAttemptWindowRef,
    attachAttemptedSessionRef,
    attachProgressRef,
    cancelAttachRetry,
    client,
    currentAssistantStreamMessageIdRef,
    gatewayUrl,
    isCurrentSessionRequest,
    loadCurrentSessionSnapshot,
    pendingStreamRevealFrameRef,
    requestSessionListRefresh,
    scheduleAttachRetry,
    setActiveStreamFirstTokenLatencyMs,
    setRecoveredStreamSnapshot,
    setSessionStateStatus,
    setStoppingStream,
    setStreamBuffer,
    setStreamError,
    setStreaming,
    setStreamingSegments,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streamingRef,
    token,
    visibleLatestUpstreamSummary,
    setActiveStreamStartedAt,
    sid,
    attachSessionViewEpoch,
    attachStateInitialized,
    accumulated,
    accumulatedSegments,
    accumulatedThinkingBlocks,
    accumulatedUsage,
    requestStartedAt,
    recoveredModifiedFilesSummary,
    buildAttachToolCalls,
    getActiveSessionId,
  } = ctx;
  // 会话已切走（或视图代次已变）：下面所有写入都是「当前会话级」状态，迟到回调
  // 一旦落地就会把别的会话强制打成 idle、清掉它的活跃流快照、弹出属于旧会话的
  // 错误条。传输层无法区分「这个 ES 属于哪个会话」，守卫只能放在这里。
  if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
    return;
  }

  /**
   * 网关权威确认「没有活跃流」后的收尾：这是**正常结束**，不是中断。
   *
   * 刻意不调 `handleInterruptedAttachStream`——那条路径会强制 `running` 并调度
   * 重连，正是死循环的来源。这里清掉本地活跃流快照（否则
   * `activeGatewayStreamSessionId` 恒指向当前会话，attach 判定永不进入终态）、
   * 取消自动重连、把状态收敛到 idle，并做一次快照加载补齐最后一次输出。
   */
  const settleAsEnded = () => {
    cancelAttachRetry();
    attachAttemptedSessionRef.current = sid;
    attachAttemptWindowRef.current = { count: 0, sessionId: sid, startedAt: Date.now() };
    attachProgressRef.current = createInitialAttachProgressState();
    // 只清属于本会话的快照：gateway client 是组件级单例，若快照已经被别的会话
    // 接管（用户切走后又开了新流），这里无条件清空会掐掉那个会话的续接依据。
    if (client.getActiveStreamSessionId() === sid) {
      client.clearActiveStreamSnapshot();
    }
    setStreamError(null);
    setStreaming(false);
    setStoppingStream(false);
    setSessionStateStatus('idle');
    // 同样不用 `replaceMessages`：收尾瞬间上游持久化可能尚未完成，整体替换
    // 会把刚渲染的对话覆盖成更短的历史（表现为「发完消息对话不见了」）。
    void loadCurrentSessionSnapshot(sid, {
      expectedSessionViewEpoch: attachSessionViewEpoch,
      messageLimit: INITIAL_TURN_LIMIT,
    }).catch(() => undefined);
    requestSessionListRefresh();
  };

  const reconnectNow = () => {
    // 双保险：`reconnectNow` 也由 `!token` 分支直接调用，不能依赖调用方守卫。
    if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
      return;
    }
    // 单次中断一律静默重连，不再向用户抛「实时流连接已断开」。
    //
    // attach 是「续接已有运行」的通道，断开后会自动重试并重放游标之后的事件，
    // 大多数情况下用户根本感知不到；而这条错误条是**持久化**的（sessionStorage，
    // 5 分钟内切回来还在），来回切换会话时会被反复看到，正是「老是提示断流重连」
    // 的来源。真正需要用户知晓的是「重连彻底失败」（熔断 / 重试耗尽），那两处
    // 仍然保留提示。这里只留诊断日志。
    if (technicalDetail) {
      console.warn('[ATTACH] reconnect required (silent retry)', {
        detail: technicalDetail,
        sessionId: sid,
      });
    }
    // 重连延迟由**连续中断次数**推导，而不是固定 400ms。
    //
    // `useStreamAttachRetry` 内部的退避基数会在每次 attach 成功后被
    // `cancelAttachRetry()` 清零，所以固定传 400ms 会让「attach → 收到事件 → 又断开」
    // 永远停在第一次尝试，形成 400ms 死循环；每轮 `handleInterruptedAttachStream`
    // 还会全量重载一次会话快照，几秒内就能把主线程占满——这正是最初的卡死成因。
    // `disconnects` 只在连接稳定存活 30s 后才归零（见 `handleAttachReconnect`），
    // 因此偶发抖动仍是快速恢复，反复抖动则指数退避到 30s 封顶。
    const disconnectCount = attachProgressRef.current.disconnects;
    handleInterruptedAttachStream({
      retryDelayMs: resolveDisconnectRetryDelayMs(disconnectCount),
      actions: {
        cancelPendingRevealAnimation: () => {
          if (pendingStreamRevealFrameRef.current !== null) {
            cancelAnimationFrame(pendingStreamRevealFrameRef.current);
            pendingStreamRevealFrameRef.current = null;
          }
        },
        clearCurrentAssistantStreamMessageId: () => {
          currentAssistantStreamMessageIdRef.current = null;
        },
        clearStreamingBuffers: () => {
          setStreamBuffer('');
          setStreamThinkingBuffer('');
          setStreamThinkingBlocks([]);
          setStreamingSegments([]);
        },
        getActiveSessionId,
        isCurrentSessionRequest,
        // 重连时补上 `messageLimit`：不传的话服务端会回一整段历史（实测单会话
        // 363 个 part / 1535KB），而重连会反复触发，主线程被打满。
        //
        // 这里同时在两个层面收敛成本：一是限制返回条数，二是让这次请求与 ChatPage
        // 1s 轮询的在途请求**共用同一 key**（单飞层按 sessionId+messageLimit 复用），
        // 从而不再额外多发一次完整往返。重连真正需要的是活跃流的 run events，
        // 历史消息只是背景。
        loadCurrentSessionSnapshot: (targetSessionId, options) =>
          loadCurrentSessionSnapshot(targetSessionId, {
            ...options,
            messageLimit: INITIAL_TURN_LIMIT,
          }),
        requestSessionListRefresh,
        resetAttachAttempt: () => {
          attachAttemptedSessionRef.current = null;
        },
        resetRevealState: () => {
          stoppingStreamRef.current = false;
          streamRevealTargetRef.current = '';
          streamRevealVisibleRef.current = '';
          streamRevealTargetCodePointsRef.current = [];
          streamRevealVisibleCodePointCountRef.current = 0;
          streamRevealNextAllowedAtRef.current = 0;
          streamingRef.current = false;
        },
        scheduleAttachRetry,
        setActiveStreamFirstTokenLatencyMs,
        setActiveStreamStartedAt,
        setRecoveredStreamSnapshot,
        setSessionStateStatus,
        setStoppingStream,
        setStreaming,
      },
      attachSessionViewEpoch,
      sessionId: sid,
      state: {
        accumulatedText: accumulated,
        accumulatedThinkingBlocks,
        accumulatedUsage,
        attachStateInitialized,
        currentAssistantStreamMessageId: currentAssistantStreamMessageIdRef.current,
        parts: accumulatedSegments,
        ...(visibleLatestUpstreamSummary
          ? { latestUpstreamSummary: visibleLatestUpstreamSummary }
          : {}),
        ...(recoveredModifiedFilesSummary ? { recoveredModifiedFilesSummary } : {}),
        requestStartedAt,
        toolCalls: buildAttachToolCalls(),
      },
    });
  };

  // ── 权威确认：先问网关「这条流还在不在」，再决定是结束还是重连 ────────
  // EventSource 在服务端正常结束（EOF / 关闭响应）时同样会触发 `onerror`。
  // 不确认就无条件重连，会形成「attach 成功 → EOF → 当成断线重连 → 又 attach」
  // 的死循环：每轮都重放事件、强制 running、再全量 reload 一次快照，几秒内就把
  // 主线程占满（页面卡死、刷新后重新开始循环）。
  if (!token) {
    reconnectNow();
    return;
  }

  // ── 静默结束（打开后 0 事件）＝「服务端暂时没有可推送的内容」──────────
  //
  // 绝大多数情况这是**正常状态**：模型正在执行 bash / mcp 等长耗时工具，或仍在
  // 思考，网关在这段时间不产生新的 run event，attach 于是「打开 → 0 事件 → EOF」。
  // 此时既不该判定连接异常，也不该提示用户，更不该高频重连（每轮都会清缓冲 +
  // 全量 reload，工具跑得越久越卡）。
  //
  // 因此这里**无条件**低频等待：递增退避重挂，不碰流状态、不 reload、不提示。
  // 不再设「达到次数就停止并报错」的分支——那个判据依赖 `sessionStateStatus`，
  // 而循环自身会把它置成 `running`（见下），所以它既不可达，又会在工具执行
  // 期间弹「实时流长时间没有新输出，已停止自动重连」。会话是否真的结束，由网关
  // 权威回答：下面 `getActiveStream()` 返回 null 时走 `settleAsEnded()` 正常收敛。
  if (reason === 'attach_stream_silent_close') {
    const silentProgress = attachProgressRef.current;
    // 跨会话重置「静默」相关计数；`disconnects` / `attachedAt` 属于断线维度，
    // 跨会话同样无意义，但保留结构更清晰——这里整体重置即可。
    if (silentProgress.sessionId !== sid) {
      attachProgressRef.current = { ...createInitialAttachProgressState(), sessionId: sid };
    }
    attachProgressRef.current.silentCloses += 1;
    const silentCloses = attachProgressRef.current.silentCloses;

    setSessionStateStatus('running');
    scheduleAttachRetry({
      delayMs: resolveSilentCloseRetryDelayMs(silentCloses),
      sessionId: sid,
      silent: true,
      beforeRetry: () => {
        if (getActiveSessionId() !== sid) {
          return 'abort';
        }
        attachAttemptedSessionRef.current = null;
        return 'proceed';
      },
    });
    return;
  } else if (reason === 'attach_stream_disconnected') {
    // 真实中断：连接建立过又掉了。累加失败计数（**不**在这里归零——归零只发生在
    // 连接稳定存活满 `STABLE_ATTACH_WINDOW_MS` 之后），并重置静默计数。
    const disconnectProgress = attachProgressRef.current;
    const livedLongEnough =
      disconnectProgress.attachedAt > 0 &&
      Date.now() - disconnectProgress.attachedAt >= STABLE_ATTACH_WINDOW_MS;
    if (livedLongEnough) {
      // 上一条连接稳定存在过：这次中断视为偶发，退避回到起步值。
      disconnectProgress.disconnects = 0;
    } else {
      disconnectProgress.disconnects += 1;
    }
    disconnectProgress.silentCloses = 0;
    disconnectProgress.stalledReconnects = 0;
  }

  void createSessionsClient(gatewayUrl)
    .getActiveStream(token, sid)
    .then((activeStream) => {
      if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      if (!activeStream) {
        attachProgressRef.current = createInitialAttachProgressState();
        settleAsEnded();
        return;
      }

      // 游标停滞只用于**诊断**：网关可能返回一个已僵死的活跃流快照（`lastSeq`
      // 不再前进）。这里既不收敛也不提示——工具执行期间游标本来就不动，而真正
      // 结束的情况网关会返回 null（上面已 `settleAsEnded()`）。统计结果只写进
      // 日志，便于排查「反复 attach 却收不到事件」。
      const progress = attachProgressRef.current;
      if (progress.sessionId !== sid) {
        progress.sessionId = sid;
        progress.lastSeq = activeStream.lastSeq;
        progress.stalledReconnects = 0;
      } else if (activeStream.lastSeq <= progress.lastSeq) {
        progress.stalledReconnects += 1;
      } else {
        progress.lastSeq = activeStream.lastSeq;
        progress.stalledReconnects = 0;
      }

      reconnectNow();
    })
    .catch(() => {
      // 查询失败（网关不可达 / 鉴权异常）：按原逻辑重连，由熔断兜底。
      if (isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        reconnectNow();
      }
    });
}
