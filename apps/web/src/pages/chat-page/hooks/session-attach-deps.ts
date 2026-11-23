import type { AttachProgressState } from './attach-effect-retry-policy.js';

import type { ScheduleStreamAttachRetryInput } from '../../../components/conversation-runtime/attach/use-stream-attach-retry.js';

import type { RightPanelTabId } from '../panels/right-panel-tabs.js';

import type {
  AssistantTraceToolCall,
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';

import { resolveNextAssistantRoundIndex } from '../../../components/conversation-runtime/stream/round-request-id.js';
import type { RecoveredActiveAssistantStream } from '../../../components/conversation-runtime/stream/stream-recovery.js';

import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';

import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { UseSessionTerminalsResult } from '../../../components/conversation-runtime/terminals/use-session-terminals.js';
import { useGatewayClient } from '../../../hooks/gateway/useGatewayClient.js';
import type { ChatSettingsModel } from '../../../utils/chat/chat-session-defaults.js';

import type { ChatRightPanelState } from '.././state/chat-stream-state.js';
import type { PendingPermissionRequest, RunEvent, UpstreamStreamSummary } from '@openAwork/shared';

import type {
  PendingQuestionRequest,
  Session,
  SessionActiveStream,
  SessionTask,
} from '@openAwork/web-client';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

export interface SessionAttachDeps {
  readonly activeGatewayStreamSessionId: string | null;
  readonly activeModelOption: ChatSettingsModel | undefined;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly activeStreamStartedAt: number | null;
  readonly appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean | undefined } | undefined,
  ) => void;
  readonly attachAttemptedSessionRef: RefObject<string | null>;
  /**
   * attach 重连风暴熔断窗口：固定时间窗内允许的自动 attach 次数。
   *
   * 见 `ChatPage` 里该 ref 的说明。超限后停止自动 attach 并给出明确错误，避免
   * 「attach → 断开 → 重置 → 再 attach」的无限循环把主线程占满、页面卡死。
   */
  readonly attachAttemptWindowRef: RefObject<{
    startedAt: number;
    count: number;
    sessionId: string | null;
  }>;
  /**
   * attach 的「无进展」检测状态：网关可能长期返回已僵死的活跃流快照，此时
   * `lastSeq` 不再前进、SSE 打开即结束。连续多次重连没有任何进展，就应停止
   * 重连并收敛，而不是无限重建传输。见 `AttachProgressState`。
   */
  readonly attachProgressRef: MutableRefObject<AttachProgressState>;
  /**
   * 已做过「终态收尾」的会话 id。
   *
   * attach effect 会因流式状态高频重跑，而终态分支里的 `loadCurrentSessionSnapshot`
   * 是全量快照（getRecovery + normalize + setMessages）。没有这个去重，抖动期间
   * 会一轮接一轮地跑数百毫秒的长任务，直接表现为页面卡死。
   */
  readonly attachTerminalReloadRef: MutableRefObject<string | null>;
  readonly attachEligibilitySignatureRef: RefObject<string | null>;
  /**
   * 当前已建立 attach 传输的会话 id；无 attach 在途时为 null。
   *
   * 必须与 `attachAttemptedSessionRef` 分开：后者在重试调度、终态复位等
   * 路径上会被置空，无法表达「传输仍属于哪个会话」。cleanup 需要据此判断
   * 「本次 effect 重跑只是 token delta」还是「用户真的切走了会话」——前者
   * 必须保留传输，后者必须掐断它。
   */
  readonly attachOwnerSessionIdRef: RefObject<string | null>;
  readonly attachRetryExhausted: boolean;
  readonly attachRetryScheduledSessionId: string | null;
  readonly cancelAttachRetry: () => void;
  readonly client: ReturnType<typeof useGatewayClient>;
  readonly currentAssistantStreamMessageIdRef: MutableRefObject<string | null>;
  readonly currentSessionId: string | null;
  readonly currentSessionViewRef: MutableRefObject<{ epoch: number; sessionId: string | null }>;
  readonly devServerDetectedTerminalIdsRef: RefObject<Set<string>>;
  readonly effectiveAgentId: string | undefined;
  readonly effectiveModelId: string;
  readonly effectiveProviderId: string;
  readonly gatewayUrl: string;
  readonly isCurrentSessionRequest: (targetSessionId: string, expectedEpoch: number) => boolean;
  readonly isFollowingRef: MutableRefObject<boolean>;
  readonly isPageActive: boolean;
  readonly isSessionSnapshotReady: boolean;
  readonly lastAttachAttemptTimestampRef: RefObject<number>;
  readonly loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?:
      | {
          expectedSessionViewEpoch?: number | undefined;
          messageLimit?: number | undefined;
          replaceMessages?: boolean | undefined;
          signal?: AbortSignal | undefined;
          since?: number | undefined;
        }
      | undefined,
  ) => Promise<void>;
  readonly loadPendingQuestionForSession: (
    targetSessionId: string,
    requestId: string,
  ) => Promise<void>;
  /**
   * 已提交消息的 ref 镜像。attach 需要从**已落库的历史**反推续跑轮次
   * （`resolveNextAssistantRoundIndex`）——提问 / 审批暂停时 `/recovery` 的
   * `runEvents` 为空，恢复快照可能是若干轮之前的旧值，只按它推会铸出与历史
   * 同键的 `clientRequestId`，本地副本在判重时顶掉旧槽位导致顺序漂移。
   */
  readonly messagesRef: RefObject<ChatMessage[]>;
  readonly pendingStreamRevealFrameRef: MutableRefObject<number | null>;
  readonly prefersReducedMotion: boolean;
  readonly recoveredStreamSnapshot: RecoveredActiveAssistantStream | null;
  readonly recoveryActiveStream: SessionActiveStream | null;
  readonly resetStreamState: () => void;
  readonly resolveAssistantCapabilityKind: (toolName: string) => AssistantTraceToolCall['kind'];
  readonly rightOpenRef: MutableRefObject<boolean>;
  readonly scheduleAttachRetry: (input: ScheduleStreamAttachRetryInput) => void;
  readonly scheduleStreamReveal: (opts: { prefersReducedMotion: boolean }) => void;
  readonly sessionModesHydrated: boolean;
  readonly sessionStateStatus: 'idle' | 'running' | 'paused' | null | undefined;
  readonly sessionTerminals: UseSessionTerminalsResult;
  readonly setActiveStreamFirstTokenLatencyMs: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamRoundStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly openBrowserPreview: (url: string, mode?: 'newTab' | 'currentTab') => void;
  readonly setChildSessions: Dispatch<SetStateAction<Session[]>>;
  readonly setHasPendingFollowContent: Dispatch<SetStateAction<boolean>>;
  readonly setLatestUpstreamSummary: Dispatch<SetStateAction<UpstreamStreamSummary | null>>;
  readonly setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  readonly setPendingPermissions: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  readonly setPendingQuestions: Dispatch<SetStateAction<PendingQuestionRequest[]>>;
  readonly setRecoveredStreamSnapshot: Dispatch<
    SetStateAction<RecoveredActiveAssistantStream | null>
  >;
  readonly setReportedStreamUsage: Dispatch<SetStateAction<ChatBackendUsageSnapshot | null>>;
  readonly setRightPanelState: Dispatch<SetStateAction<ChatRightPanelState>>;
  readonly setRightTab: Dispatch<SetStateAction<RightPanelTabId>>;
  readonly setSessionStateStatus: Dispatch<
    SetStateAction<'idle' | 'running' | 'paused' | null | undefined>
  >;
  readonly setSessionTasks: Dispatch<SetStateAction<SessionTask[]>>;
  readonly setStoppingStream: Dispatch<SetStateAction<boolean>>;
  readonly setStreamBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreamError: (action: SetStateAction<string | null>) => void;
  readonly setStreamThinkingBlocks: Dispatch<SetStateAction<StreamingThinkingBlock[]>>;
  readonly setStreamThinkingBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreaming: Dispatch<SetStateAction<boolean>>;
  readonly setStreamingSegments: Dispatch<SetStateAction<ChatMessagePart[]>>;
  readonly stoppingStreamRef: MutableRefObject<boolean>;
  readonly streamRevealNextAllowedAtRef: MutableRefObject<number>;
  readonly streamRevealTargetCodePointsRef: MutableRefObject<string[]>;
  readonly streamRevealTargetRef: MutableRefObject<string>;
  readonly streamRevealVisibleCodePointCountRef: MutableRefObject<number>;
  readonly streamRevealVisibleRef: MutableRefObject<string>;
  readonly streaming: boolean;
  readonly streamingRef: MutableRefObject<boolean>;
  readonly token: string | null;
  readonly visibleLatestUpstreamSummary: UpstreamStreamSummary | null;
  readonly INITIAL_TURN_LIMIT: 10;
}
