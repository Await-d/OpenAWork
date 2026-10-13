import { startTransition, useCallback, useRef } from 'react';
import type { UpstreamStreamSummary, WorkflowRuntimeState } from '@openAwork/shared';
import type {
  Session,
  SessionActiveStream,
  SessionMessageRatingRecord,
  SessionTask,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from '@openAwork/web-client';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../../components/conversation-runtime/session/session-runtime.js';
import type { RecoveredActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatRightPanelState } from '../../state/chat-stream-state.js';
import { reconcileSnapshotChatMessages } from '../../../../components/conversation-runtime/messages/support.js';
import { collectSubagentNotices } from '../../../../components/conversation-runtime/messages/subagent-notices.js';
import type { SubagentNotice } from '@openAwork/shared';
import {
  prepareSessionRecoveryState,
  buildRightPanelStateFromSessionSnapshot,
} from '../render/chat-page-utils.js';
import { getRecoveryPendingInteractions } from '../../../../components/conversation-runtime/session/recovery-read-model.js';
import {
  mergeChildSessions,
  mergeSessionTasks,
  mergeSessionTodoLanes,
  preserveEqualList,
  preserveEqualValue,
} from '../../../../components/conversation-runtime/session/session-runtime.js';
import { recoverActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';
import {
  planRunEventRequest,
  settleRunEventBuffer,
  type RunEventPrefixBuffer,
} from '../../../../utils/session/recovery-run-event-buffer.js';

export interface SessionSnapshotLoaderRefs {
  currentSessionViewRef: React.MutableRefObject<{ epoch: number; sessionId: string | null }>;
  streamingRef: React.MutableRefObject<boolean>;
}

export interface SessionSnapshotLoaderSetters {
  setMessages: (value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setMessageRatings: (
    value:
      | Record<string, SessionMessageRatingRecord>
      | ((
          prev: Record<string, SessionMessageRatingRecord>,
        ) => Record<string, SessionMessageRatingRecord>),
  ) => void;
  setRightPanelState: (
    value: ChatRightPanelState | ((prev: ChatRightPanelState) => ChatRightPanelState),
  ) => void;
  setSessionTodos: (
    value: SessionTodoItem[] | ((prev: SessionTodoItem[]) => SessionTodoItem[]),
  ) => void;
  setChildSessions: (value: Session[] | ((prev: Session[]) => Session[])) => void;
  setSessionTasks: (value: SessionTask[] | ((prev: SessionTask[]) => SessionTask[])) => void;
  setWorkflowRuntime: (
    value:
      | WorkflowRuntimeState
      | null
      | ((prev: WorkflowRuntimeState | null) => WorkflowRuntimeState | null),
  ) => void;
  setPendingPermissions: (
    value:
      | PendingPermissionRequest[]
      | ((prev: PendingPermissionRequest[]) => PendingPermissionRequest[]),
  ) => void;
  setPendingQuestions: (
    value:
      PendingQuestionRequest[] | ((prev: PendingQuestionRequest[]) => PendingQuestionRequest[]),
  ) => void;
  setSessionStateStatus: (value: SessionStateStatus | null) => void;
  setRecoveryActiveStream: (
    value:
      | SessionActiveStream
      | null
      | ((prev: SessionActiveStream | null) => SessionActiveStream | null),
  ) => void;
  setLatestUpstreamSummary: (value: UpstreamStreamSummary | null) => void;
  setRecoveredStreamSnapshot: (
    value:
      | RecoveredActiveAssistantStream
      | null
      | ((prev: RecoveredActiveAssistantStream | null) => RecoveredActiveAssistantStream | null),
  ) => void;
  setIsSessionSnapshotReady: (value: boolean) => void;
  /**
   * 子代理完成通知（`role: 'synthetic'`）。
   *
   * `messageLimit` 生效时 `recovery.session.messages` 只含最近 N 条，
   * 因此通知同样是**窗口内子集**——与转录可见范围一致，属预期。
   */
  setSubagentNotices: (value: SubagentNotice[]) => void;
}

export interface SessionSnapshotLoaderReturn {
  loadSessionRuntimeSnapshot: (
    targetSessionId: string,
    signal?: AbortSignal,
    expectedSessionViewEpoch?: number,
  ) => Promise<void>;
  syncRecoveredStreamSnapshot: (
    session: Session,
    nextSessionStateStatus: SessionStateStatus | null,
    activeStream: SessionActiveStream | null,
    messages: ChatMessage[],
  ) => void;
  loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?: {
      expectedSessionViewEpoch?: number;
      /**
       * 对 run event 走增量续读：只有持续轮询同一条活跃流的调用方
       * （远端运行中的 1s 快照轮询）才应开启，且必须传 `messageLimit`。
       * 详见实现内的注释。
       */
      incrementalRunEvents?: boolean;
      messageLimit?: number;
      replaceMessages?: boolean;
      signal?: AbortSignal;
      since?: number;
    },
  ) => Promise<void>;
}

export function useSessionSnapshotLoader(
  gatewayUrl: string,
  token: string | null,
  isCurrentSessionView: (targetSessionId: string, expectedEpoch: number) => boolean,
  refs: SessionSnapshotLoaderRefs,
  setters: SessionSnapshotLoaderSetters,
): SessionSnapshotLoaderReturn {
  const { currentSessionViewRef, streamingRef } = refs;
  const {
    setMessages,
    setMessageRatings,
    setRightPanelState,
    setSessionTodos,
    setChildSessions,
    setSessionTasks,
    setWorkflowRuntime,
    setPendingPermissions,
    setPendingQuestions,
    setSessionStateStatus,
    setRecoveryActiveStream,
    setLatestUpstreamSummary,
    setSubagentNotices,
    setRecoveredStreamSnapshot,
    setIsSessionSnapshotReady,
  } = setters;

  /**
   * 活跃 scope 的 run event 前缀（增量续读的客户端状态）。
   *
   * 放 ref 不放 state：它只是「下一拍少读一点」的传输层优化，任何一次渲染都不需要它，
   * 也不该因为它的变化触发重渲染。
   */
  const runEventBufferRef = useRef<RunEventPrefixBuffer | null>(null);

  const loadSessionRuntimeSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal, expectedSessionViewEpoch?: number) => {
      if (!token) return;
      const sessionViewEpoch = expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const status = await createSessionsClient(gatewayUrl).getStatus(token, targetSessionId, {
        signal,
      });
      if (signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch)) return;
      // 该会话已无活跃流：增量前缀随之释放。run 结束后 1s 快照轮询会停（前台条件
      // `remoteSessionBusyState` 转 false），这条 3s 轻量轮询是兜住「最后一次前缀」的
      // 地方——不清的话，一份完整事件序列会一直挂到下一次快照加载。只在会话对齐时清，
      // 避免把另一个会话的前缀误清。
      const runEventBuffer = runEventBufferRef.current;
      if (
        status.activeStream === null &&
        runEventBuffer !== null &&
        runEventBuffer.sessionId === targetSessionId
      ) {
        runEventBufferRef.current = null;
      }
      const pendingInteractions = getRecoveryPendingInteractions(status);
      // 全部走「值等则沿用旧引用」的 setter：本函数每 3s 跑一次，无条件写新对象
      // 会让 ChatPage 每拍重渲染，并把不稳定的对象引用喂进依赖它们的 effect
      // （attach effect 依赖 `recoveryActiveStream`；`taskToolRuntimeLookup` 依赖
      // `childSessions`/`sessionTasks`，换新引用会击穿消息列表的 React.memo）。
      setSessionTodos((previous) => mergeSessionTodoLanes(previous, status.todoLanes));
      setChildSessions((previous) => mergeChildSessions(previous, status.children));
      setSessionTasks((previous) => mergeSessionTasks(previous, status.tasks));
      setPendingPermissions((previous) =>
        preserveEqualList(previous, pendingInteractions.pendingPermissions),
      );
      setPendingQuestions((previous) =>
        preserveEqualList(previous, pendingInteractions.pendingQuestions),
      );
      setRecoveryActiveStream((previous) => preserveEqualValue(previous, status.activeStream));
      setWorkflowRuntime((previous) => preserveEqualValue(previous, status.workflowRuntime));
    },
    [
      gatewayUrl,
      isCurrentSessionView,
      token,
      currentSessionViewRef,
      setSessionTodos,
      setChildSessions,
      setSessionTasks,
      setPendingPermissions,
      setPendingQuestions,
      setRecoveryActiveStream,
      setWorkflowRuntime,
    ],
  );

  const syncRecoveredStreamSnapshot = useCallback(
    (
      session: Session,
      nextSessionStateStatus: SessionStateStatus | null,
      activeStream: SessionActiveStream | null,
      messages: ChatMessage[],
    ) => {
      const next = recoverActiveAssistantStream({
        activeStreamStartedAt: activeStream?.startedAtMs ?? null,
        hasActiveStream: activeStream !== null,
        messages,
        runEvents: Array.isArray(session.runEvents) ? session.runEvents : [],
        sessionStateStatus: nextSessionStateStatus,
      });
      if (next !== null) {
        setLatestUpstreamSummary(next.upstreamSummary ?? null);
        setRecoveredStreamSnapshot(next);
        return;
      }
      // When recovery yields no renderable snapshot but the session is still
      // running (or paused), keep any previously cached snapshot — for example
      // one populated from useSessionViewCache when switching back into a
      // mid-flight session — until the attach pipeline overwrites it.
      const sessionStillStreaming =
        activeStream !== null ||
        nextSessionStateStatus === 'running' ||
        nextSessionStateStatus === 'paused';
      if (!sessionStillStreaming) {
        setLatestUpstreamSummary(null);
      }
      setRecoveredStreamSnapshot((previous) => (sessionStillStreaming ? previous : null));
    },
    [setLatestUpstreamSummary, setRecoveredStreamSnapshot],
  );

  const loadCurrentSessionSnapshot = useCallback(
    async (
      targetSessionId: string,
      options?: {
        expectedSessionViewEpoch?: number;
        /**
         * 对 run event 走增量续读（仅本 hook 维护了前缀缓冲的调用方可开启）。
         *
         * 远端运行中的 1s 轮询必须开启：活跃 scope 的行数随这一轮 run 只增不减，
         * 每拍全量读会把单拍成本绑在 O(本轮已产生事件数) 上，正是接口在对话期间卡住的
         * 直接原因。开启后冷启动仍取全量，其后每拍只取 `seq > cursor` 的增量，再由
         * `settleRunEventBuffer` 拼回完整序列 —— 下游（累加 reduce）看到的仍是全量。
         */
        incrementalRunEvents?: boolean;
        messageLimit?: number;
        replaceMessages?: boolean;
        signal?: AbortSignal;
        since?: number;
      },
    ) => {
      if (!token) return;
      const sessionViewEpoch =
        options?.expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const sessionsClient = createSessionsClient(gatewayUrl);
      // 增量续读要求 messageLimit 生效（服务端只在活跃 scope 的 turnLimit 分支下认游标），
      // 否则退回全量，避免把「全 session 事件」和「单 scope 增量」拼在一起。
      const incrementalEnabled =
        options?.incrementalRunEvents === true && typeof options?.messageLimit === 'number';
      const requestedAfterSeq = incrementalEnabled
        ? planRunEventRequest({ buffer: runEventBufferRef.current, sessionId: targetSessionId })
        : undefined;
      let recovery = await sessionsClient.getRecovery(token, targetSessionId, {
        ...(requestedAfterSeq === undefined ? {} : { runEventAfterSeq: requestedAfterSeq }),
        messageLimit: options?.messageLimit,
        signal: options?.signal,
        since: options?.since,
      });
      if (options?.signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch))
        return;

      if (incrementalEnabled) {
        let settlement = settleRunEventBuffer({
          activeStream: recovery.activeStream,
          buffer: runEventBufferRef.current,
          requestedAfterSeq,
          runEventCursor: recovery.runEventCursor,
          runEvents: recovery.session.runEvents,
          sessionId: targetSessionId,
        });
        if (settlement.needsFullReload) {
          // 换了 run / scope 被清掉重建：本地前缀已作废，重发一次不带游标的全量请求。
          // 只在这一拍发生，代价是一次额外往返，换来的是「绝不拿残缺序列重建流」。
          recovery = await sessionsClient.getRecovery(token, targetSessionId, {
            messageLimit: options?.messageLimit,
            signal: options?.signal,
            since: options?.since,
          });
          if (options?.signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch))
            return;
          settlement = settleRunEventBuffer({
            activeStream: recovery.activeStream,
            buffer: null,
            requestedAfterSeq: undefined,
            runEventCursor: recovery.runEventCursor,
            runEvents: recovery.session.runEvents,
            sessionId: targetSessionId,
          });
        }

        runEventBufferRef.current = settlement.buffer;
        // 下游（recoverActiveAssistantStream / buildRightPanelStateFromRunEvents）
        // 拿到的仍是完整序列，本函数之外没有任何调用方需要知道增量协议。
        recovery = {
          ...recovery,
          session: { ...recovery.session, runEvents: settlement.events },
        };
      } else {
        // 全量调用方：前缀缓冲与它无关，但要防止「它读了一轮新 scope 的全量，而缓冲还停在
        // 上一轮」——静默作废，下一拍增量会先走一次重载。
        runEventBufferRef.current = null;
      }

      const prepared = prepareSessionRecoveryState(recovery);
      // Mark recovery-driven state syncs as a transition so React can split
      // the commit across frames and yield to higher-priority work (input,
      // SSE `message` handler). Without this, a fresh recovery payload of
      // ~10 messages with reasoning + tool cards lands as a single ~400ms
      // synchronous render — surfacing as `[Violation] 'message' handler`
      // because React's Scheduler dispatches commits via MessageChannel.
      startTransition(() => {
        if (options?.replaceMessages === true) {
          setMessages(prepared.normalizedMessages);
        } else if (streamingRef.current) {
          // skip reconciliation during streaming
        } else if (prepared.normalizedMessages.length === 0) {
          // skip — server returned empty snapshot, don't wipe local messages
        } else {
          setMessages((previous) =>
            reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
          );
        }
        // 以下 setter 统一走「值等则沿用旧引用」，与上面 `loadSessionRuntimeSnapshot`
        // 的 3s 轻量轮询同构。此前这条 1s 路径上只有 setMessages / setChildSessions
        // / setSessionTasks 做了处理，其余每拍无条件换新对象——`rightPanelState` 尤其
        // 昂贵，它一变就击穿整个右侧面板（含终端卡片）的 memo。
        // 注意 setSessionTodos 不在此列：/status 返回的是 `SessionTodoLanes`（带
        // main/temp）而 /recovery 返回扁平 `SessionTodoItem[]`，两者不是同一条路径
        // 的两种写法，不能对齐成 merge——这里的直接替换是正确语义。
        setMessageRatings((previous) => preserveEqualValue(previous, prepared.messageRatings));
        setRightPanelState((previous) =>
          preserveEqualValue(
            previous,
            buildRightPanelStateFromSessionSnapshot(prepared.session, prepared.normalizedMessages),
          ),
        );
        setSessionTodos(prepared.sessionTodos);
        // 与轻量轮询同构：走 merge 让内容未变的子集复用引用。否则远端运行中
        // （本地未接管流）时，本函数每 REMOTE_STREAM_RECOVERY_POLL_MS 一次整体替换，
        // 换新的 `childSessions`/`sessionTasks` 会经 `taskToolRuntimeLookup` 击穿
        // 消息列表里所有 `ChatGroupBlock` 的 memo。
        // 语义变化：merge 是并集而非替换，因此「快照里已消失的子会话/任务」会保留在
        // state 中。子代理集合在同一会话内只增不减（删除走 rollback 的替换路径，
        // 会话切换前会先 `setChildSessions([])`），故实际不可观测。
        setChildSessions((previous) => mergeChildSessions(previous, recovery.children));
        setSessionTasks((previous) => mergeSessionTasks(previous, recovery.tasks));
        setWorkflowRuntime((previous) =>
          preserveEqualValue(previous, prepared.session.workflowRuntime ?? null),
        );
        setPendingPermissions((previous) =>
          preserveEqualList(previous, prepared.pendingPermissions),
        );
        setPendingQuestions((previous) => preserveEqualList(previous, prepared.pendingQuestions));
        // 标量，React 按 Object.is 自动跳过，无需 preserve。
        setSessionStateStatus(prepared.sessionStateStatus);
        setRecoveryActiveStream((previous) => preserveEqualValue(previous, recovery.activeStream));
        syncRecoveredStreamSnapshot(
          prepared.session,
          prepared.sessionStateStatus,
          recovery.activeStream,
          prepared.normalizedMessages,
        );
        setIsSessionSnapshotReady(true);
      });
    },
    [
      gatewayUrl,
      isCurrentSessionView,
      syncRecoveredStreamSnapshot,
      token,
      currentSessionViewRef,
      streamingRef,
      setMessages,
      setMessageRatings,
      setRightPanelState,
      setSessionTodos,
      setChildSessions,
      setSessionTasks,
      setWorkflowRuntime,
      setPendingPermissions,
      setPendingQuestions,
      setSessionStateStatus,
      setRecoveryActiveStream,
      setIsSessionSnapshotReady,
    ],
  );

  return { loadSessionRuntimeSnapshot, syncRecoveredStreamSnapshot, loadCurrentSessionSnapshot };
}
