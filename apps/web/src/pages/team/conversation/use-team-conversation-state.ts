/**
 * useTeamConversationState · team 端对话 state hook
 *
 * 把 team 端"单 session 对话布局"所需的全部 state 打包成一个 hook，让
 * `<TeamConversationView/>` 通过它获得消息流 / 流式 / 滚动 / Q/P 回复 /
 * provider 列表 / inbound 提交所需的全部 props。
 *
 * **本 hook 是 `useChatConversationState` 的 team 独立版本**（260518 解耦
 * 方案 §6.4）：从 chat 复制为模板，再裁剪 chat-only 字段（dialogueMode /
 * yoloMode / webSearchEnabled / manualAgentId 等），加 team 专属字段（roleLayer / substate /
 * sessionMetadata 已在共享层；handoffsInline / layeredGroups 等后续 v2 加）。
 *
 * 与 chat 端的关键差异：
 * 1. **写入路径默认 enable**：team session 默认开启 composer，按
 *    `resolveTeamSubmitStrategy(roleLayer, substate)` 在 `inbound` 与
 *    `stream` 之间路由。
 * 2. **只传 team 需要的模型参数到 stream**：dialogue mode / yolo / web search
 *    不参与 team stream；provider/model 与 thinking/reasoning effort 会跟随
 *    请求；只传 provider/model（来自 session metadata）+ agentId（来自
 *    role 默认 agent）。
 * 3. **不读 localStorage 的 chat 默认值**：chat 端的
 *    `loadSavedChatSessionDefaults` 来自用户在 ChatPage 设置面板的偏好；
 *    team 端的 provider/model 来自服务端 session metadata，不重叠。
 *
 * **演化历史**：从 `pages/chat-page/conversation/use-chat-conversation-state.ts`
 * 复制而来。两边后续将各自独立演进，互不引用。
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
 * - `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InputImageContent, RunEvent, UpstreamStreamSummary } from '@openAwork/shared';
import {
  createPermissionsClient,
  createQuestionsClient,
  createSessionsClient,
  createTeamInboundClient,
  type InboundMessageType,
  type InboundPayloadByType,
  type InboundSubmitResponse,
  type PendingPermissionRequest,
  type PendingQuestionRequest,
  type PermissionDecision,
} from '@openAwork/web-client';
import type {
  ChatMessage,
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import {
  loadSavedChatSessionDefaultsResult,
  type ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import {
  publishSessionPendingPermission,
  publishSessionPendingQuestion,
  publishSessionRunState,
} from '../../../utils/session/session-list-events.js';
import { toSessionPendingPermissionState } from '../../../utils/permission/pending-permission-state.js';
import {
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
  type TeamRoleLayer,
} from '../../../stores/team/team-events.js';
import { useMultiAttachStore } from '../../../stores/team/multi-attach-store.js';
import {
  formatGatewayStreamErrorMessage,
  useGatewayClient,
} from '../../../hooks/gateway/useGatewayClient.js';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
import { resolveChatThinkingRequest } from '../../chat-page/conversation/settings/resolve-chat-thinking-request.js';
import { useScrollManager } from '../../../components/conversation-runtime/scroll/use-scroll-manager.js';
import { useStreamReveal } from '../../../components/conversation-runtime/reveal/use-stream-reveal.js';
import { useConversationStream } from '../../../components/conversation-runtime/stream/use-conversation-stream.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import { estimateTokenCount } from '../../../components/conversation-runtime/messages/support.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../hooks/use-recoverable-retry.js';

// ─── Hook 输入 ────────────────────────────────────────────────────────────

export interface UseTeamConversationStateOptions {
  /** 当前要渲染的 team session id；为 null 时 hook 进入空闲态。 */
  sessionId: string | null;
  /** 当前用户邮箱（用于显示等）。 */
  currentUserEmail: string;
  /** Gateway URL。 */
  gatewayUrl: string;
  /** 访问 token。 */
  token: string | null;
  /** 是否启用自动加载。team session 选中后传 true。 */
  enabled?: boolean;
  /**
   * 是否启用 composer 的写入 writer（startStream / submitInbound /
   * replyPermission / replyQuestion）。
   *
   * team 默认建议传 true（reception session 接受用户对话），而
   * LayerConversationDrawer 中的子 session 视图可传 false 实现只读。
   */
  enableWriters?: boolean;
  /**
   * Optional default agent id sent on every outgoing stream.
   * Reception session 默认从 session metadata 中读取（如 `b`）。
   */
  effectiveAgentId?: string;
  /**
   * session 默认 provider/model 配置。team 端通常从 session metadata
   * 注入；不复用 chat 端的 dialogueMode / yoloMode / webSearchEnabled 等偏好。
   */
  defaults?: {
    activeProviderId?: string;
    activeModelId?: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
  };
}

// ─── Hook 输出 ────────────────────────────────────────────────────────────

export interface TeamConversationState {
  // ─── 消息 + 流式 ──────────────────────────────────────────────────
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  streaming: boolean;
  stoppingStream: boolean;
  streamBuffer: string;
  streamThinkingBuffer: string;
  streamThinkingBlocks: StreamingThinkingBlock[];
  streamingSegments: ChatMessagePart[];
  reportedStreamUsage: ChatBackendUsageSnapshot | null;
  streamError: string | null;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  snapshotError: string | null;
  setSnapshotError: React.Dispatch<React.SetStateAction<string | null>>;
  providersError: string | null;
  setProvidersError: React.Dispatch<React.SetStateAction<string | null>>;

  // ─── composer ────────────────────────────────────────────────────
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  // team 端暴露 provider / model 与模型思考等级；dialogueMode / yoloMode /
  // webSearchEnabled / manualAgentId 仍是 chat-only 偏好。
  providers: ChatSettingsProvider[];
  setProviders: React.Dispatch<React.SetStateAction<ChatSettingsProvider[]>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  thinkingEnabled: boolean;
  setThinkingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: React.Dispatch<React.SetStateAction<ReasoningEffort>>;

  // ─── 滚动 + 加载 ──────────────────────────────────────────────────
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  showScrollToBottom: boolean;
  hasPendingFollowContent: boolean;
  isSessionLoading: boolean;

  // ─── 会话状态 ────────────────────────────────────────────────────
  sessionStateStatus: SessionStateStatus | null;
  isSessionSnapshotReady: boolean;
  sessionTodos: SessionTodoItem[];
  pendingPermissions: PendingPermissionRequest[];
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>;
  pendingQuestions: PendingQuestionRequest[];
  setPendingQuestions: React.Dispatch<React.SetStateAction<PendingQuestionRequest[]>>;
  runEvents: RunEvent[];

  // ─── L1.8 / L1.3 扩展字段（来自 sessions 表，前端从 recovery 读取）──────
  /**
   * sessions.role_layer（Phase B 已落地）：'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer' | null
   * team session 必填，chat session 通常为 null。
   */
  roleLayer: string | null;
  /**
   * sessions.substate（已落地）：当前子状态机位置。
   * 后端 substate-store.ts 的 setSubstate 会原子写入并广播 team event。
   * 前端组件可直接使用此值渲染进度条。
   */
  substate: string | null;
  /**
   * 已解析的 sessions.metadata_json（JSON.parse 结果）。
   * 形如 `{ teamDefinition?: {...}, teamWorkspaceId?: string, workingDirectory?: string }`。
   * 团队会话从这里读取 `teamDefinition` 渲染初始化引导（成员清单、来源、provider）。
   * chat 端单会话此字段为 chat 自己的 metadata，与 team 无关。
   */
  sessionMetadata: Record<string, unknown> | null;

  /** 子 session 列表（各层级的独立会话），用于双栏联动视图。 */
  childSessions: Array<{
    id: string;
    role_layer?: string | null;
    messages: ChatMessage[];
    displayName?: string | null;
    personaKey?: string | null;
  }>;

  // ─── 派生 ────────────────────────────────────────────────────────
  /** 远端 session 的运行 / 暂停状态（基于 sessionStateStatus 计算）。 */
  remoteSessionBusyState: 'running' | 'paused' | null;
  /** 当前流式渲染中是否有可见内容。 */
  visibleStreaming: boolean;
  /** 仍未拉到前端的更早用户回合数。 */
  hiddenMessageCount: number;

  // ─── 操作 ────────────────────────────────────────────────────────
  /** 重新加载当前 session 的快照（消息列表 + pending 状态）。 */
  reload: () => Promise<void>;
  /** 拉取更早的团队对话回合。 */
  loadEarlierMessages: () => Promise<void>;

  /**
   * 提交 inbound message 到当前 session（L1.3 反向通道）。
   *
   * 用法：
   * - team 用户回答 c 的 [NEEDS CLARIFICATION] →
   *     `submitInbound('clarification_answer', { questionId, answer, ... })`
   * - team 用户中途追加输入 →
   *     `submitInbound('user_input', { text })`
   * - 取消任务 →
   *     `submitInbound('cancel_signal', { reason, cascadeFrom, preserveArtifacts })`
   *
   * **注意**：后端端点由 L1.3 改造 1 提供，当前未落地。前端契约先行。
   *
   * @throws {HttpError} 当 sessionId 为 null / token 缺失 / 后端 4xx/5xx 时抛出
   */
  submitInbound: <T extends InboundMessageType>(
    messageType: T,
    payload: InboundPayloadByType[T],
    options?: { clientIdempotencyKey?: string; expiresAt?: number },
  ) => Promise<InboundSubmitResponse>;

  // ─── v0.3 writers (only present when enableWriters = true) ─────
  /**
   * 通过 chat stream 协议给当前 session 发送一条用户消息，并实时驱动消息流
   * 累积。**仅当 `enableWriters = true` 时才会真正连接 SSE/WS**；否则等同于
   * 抛出 'writers disabled'。
   */
  startStream: (
    text: string,
    options?: {
      inputParts?: InputImageContent[];
      displayMessage?: string;
      agentId?: string;
      onChatOnlyEvent?: (event: RunEvent) => void;
    },
  ) => Promise<void>;
  /** 主动中止当前 stream（调 POST /sessions/:id/stream/stop）。 */
  stopStream: () => Promise<boolean>;
  /**
   * Attach 到当前 session 的后台活跃流（SSE `/sessions/:id/stream/attach`）。
   *
   * 用于 reception session 走 inbound 路径后，后端 fire-and-forget 启动
   * `runSessionInBackground`，前端通过 attach 实时消费 `text_delta` 等流式事件，
   * 从而在 team 对话中展示逐 token 的流式回复。
   *
   * 返回 true 表示成功 attach 到活跃流；false 表示当前无活跃流或 attach 失败。
   */
  attachToSessionStream: () => Promise<boolean>;
  /** 行内回复 pending permission（chat 端 InlineQuestionPanel 用）。 */
  replyPermission: (
    requestId: string,
    decision: PermissionDecision,
    options?: {
      alwaysOverride?: string[];
      feedback?: string;
      targetSessionId?: string;
    },
  ) => Promise<void>;
  /** 行内回复 pending question。 */
  replyQuestion: (
    requestId: string,
    status: 'answered' | 'dismissed',
    answers?: string[][],
    options?: { targetSessionId?: string },
  ) => Promise<void>;
  /**
   * 主动重新拉一次 providers / model 列表。第一次调用会 hydrate
   * `providers` / `activeProviderId` / `activeModelId` / 思考偏好。
   */
  loadProviders: () => Promise<void>;

  // ─── v0.3 scroll manager ───────────────────────────────────────
  /** UIEvent handler bound to the scroll region (forward to onScroll prop). */
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  /** Programmatic scroll to bottom（与 ChatScrollBottomButton 配合）。 */
  scrollToBottom: (behavior?: ScrollBehavior, align?: 'center' | 'latest-edge') => void;
}

const TEAM_CONVERSATION_RECOVERY_RETRY_BASE_MS = 2_000;
const TEAM_CONVERSATION_RECOVERY_RETRY_MAX_MS = 30_000;
const TEAM_CONVERSATION_PROVIDERS_RETRY_BASE_MS = 2_000;
const TEAM_CONVERSATION_PROVIDERS_RETRY_MAX_MS = 30_000;
const TEAM_CONVERSATION_INITIAL_TURN_LIMIT = 10;
const TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT = 20;

export function computeTeamConversationRecoveryRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_CONVERSATION_RECOVERY_RETRY_BASE_MS,
    maxMs: TEAM_CONVERSATION_RECOVERY_RETRY_MAX_MS,
  });
}

export function formatTeamConversationRecoveryLoadError(input: {
  hasCachedSnapshot: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队会话快照失败。',
    hasRetainedData: input.hasCachedSnapshot,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '会话快照',
    retryable: input.result.retryable,
  });
}

export function computeTeamConversationProvidersRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_CONVERSATION_PROVIDERS_RETRY_BASE_MS,
    maxMs: TEAM_CONVERSATION_PROVIDERS_RETRY_MAX_MS,
  });
}

export function formatTeamConversationProvidersLoadError(input: {
  hasCachedProviders: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载 Provider 列表失败。',
    hasRetainedData: input.hasCachedProviders,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: 'Provider 列表',
    retryable: input.result.retryable,
  });
}

function resolveSessionSidebarRunState(
  streaming: boolean,
  sessionStateStatus: SessionStateStatus | null,
): 'idle' | 'running' | 'paused' {
  if (streaming || sessionStateStatus === 'running') {
    return 'running';
  }
  if (sessionStateStatus === 'paused') {
    return 'paused';
  }
  return 'idle';
}

function isSessionBusyForSidebar(
  streaming: boolean,
  sessionStateStatus: SessionStateStatus | null,
): boolean {
  return streaming || sessionStateStatus === 'running' || sessionStateStatus === 'paused';
}

// ─── 主 hook 实现 ─────────────────────────────────────────────────────────

/**
 * v0.1 骨架版实现：
 * - 加载 session recovery 快照
 * - 订阅 pending permissions / questions
 * - 提供 streaming / composer / 模型 / 滚动等 state 容器（实际 streaming
 *   逻辑由消费方驱动；本 hook 只暴露 state setter）
 *
 * 这意味着 chat 端暂时仍由 ChatPage 自己驱动 streaming，team 端在 Phase 2a
 * 是只读模式（composer disabled），不需要触发 streaming——可以直接用本
 * hook 的快照加载部分看到执行流。
 */
export function useTeamConversationState(
  options: UseTeamConversationStateOptions,
): TeamConversationState {
  const {
    sessionId,
    gatewayUrl,
    token,
    enabled = true,
    defaults,
    enableWriters = false,
    effectiveAgentId,
  } = options;
  const prefersReducedMotion = usePrefersReducedMotion();

  // ─── refs ────────────────────────────────────────────────────────
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  // editorPaneRef is reused as an inert sentinel because session-conversation
  // does not host an editor pane; the scroll manager just needs a stable ref.
  const editorPaneRef = useRef<HTMLDivElement>(null);

  // ─── 消息 + 流式 ────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [childSessions, setChildSessions] = useState<
    Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>
  >([]);
  const [streaming, setStreaming] = useState(false);
  const [stoppingStream, setStoppingStream] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [streamThinkingBuffer, setStreamThinkingBuffer] = useState('');
  const [streamThinkingBlocks, setStreamThinkingBlocks] = useState<StreamingThinkingBlock[]>([]);
  const [streamingSegments, setStreamingSegments] = useState<ChatMessagePart[]>([]);
  const [reportedStreamUsage, setReportedStreamUsage] = useState<ChatBackendUsageSnapshot | null>(
    null,
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [, setActiveStreamStartedAt] = useState<number | null>(null);
  const [, setActiveStreamFirstTokenLatencyMs] = useState<number | null>(null);
  const [, setLatestUpstreamSummary] = useState<UpstreamStreamSummary | null>(null);

  // ─── composer ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  // team 端保留 provider / model 与模型思考等级；dialogueMode / yoloMode /
  // webSearchEnabled / manualAgentId 仍不参与 team 数据流。
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>(
    defaults?.activeProviderId ?? '',
  );
  const [activeModelId, setActiveModelId] = useState<string>(defaults?.activeModelId ?? '');
  const [thinkingEnabled, setThinkingEnabled] = useState(defaults?.thinkingEnabled ?? false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    defaults?.reasoningEffort ?? 'medium',
  );

  // ─── 滚动 ──────────────────────────────────────────────────────
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);

  // ─── 会话状态 ──────────────────────────────────────────────────
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const [sessionTodos, _setSessionTodos] = useState<SessionTodoItem[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([]);

  // ─── 多路 SSE 状态 ──────────────────────────────────────────────
  // multiAttachActive 必须在所有引用它的 effect（如轮询 effect）之前声明，
  // 否则 const 暂时性死区会导致 ReferenceError。
  // multiAttachActiveRef 是 ref 版本，供 callback 中同步读取。
  const multiAttachActiveRef = useRef(false);
  const [multiAttachActive, setMultiAttachActive] = useState(false);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  // L1.8 / L1.3 扩展字段（hook v0.2 新增）
  const [roleLayer, setRoleLayer] = useState<string | null>(null);
  const [substate, setSubstate] = useState<string | null>(null);
  const [serverTotalTurnCount, setServerTotalTurnCount] = useState<number | null>(null);
  // 解析后的 sessions.metadata_json（不直接放原 JSON 字符串，避免消费方再次解析）。
  // 形如 { teamDefinition?: {...}, teamWorkspaceId?: string, workingDirectory?: string, ... }
  // 解析失败 / 缺失时为 null。
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, unknown> | null>(null);
  const [resolvedParentSessionId, setResolvedParentSessionId] = useState<string | null>(null);
  const hasRecoverySnapshotRef = useRef(false);
  const requestedTurnLimitRef = useRef(TEAM_CONVERSATION_INITIAL_TURN_LIMIT);
  const reloadPromiseRef = useRef<{ promise: Promise<void>; sessionId: string | null } | null>(
    null,
  );
  const latestSessionIdRef = useRef<string | null>(sessionId);
  const previousSessionIdRef = useRef<string | null>(sessionId);
  latestSessionIdRef.current = sessionId;
  const providersRef = useRef<ChatSettingsProvider[]>([]);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();
  const {
    clearRetry: clearProvidersRetry,
    resetRetry: resetProvidersRetry,
    scheduleRetry: scheduleProvidersRetry,
  } = useRecoverableRetryController();

  // ─── 派生 ────────────────────────────────────────────────────────
  const remoteSessionBusyState = useMemo<'running' | 'paused' | null>(() => {
    if (sessionStateStatus === 'running') return 'running';
    if (sessionStateStatus === 'paused') return 'paused';
    return null;
  }, [sessionStateStatus]);

  const visibleStreaming = useMemo(() => {
    return streaming || streamingSegments.length > 0 || streamBuffer.length > 0;
  }, [streaming, streamingSegments.length, streamBuffer.length]);

  const hiddenMessageCount = useMemo(() => {
    if (typeof serverTotalTurnCount !== 'number' || serverTotalTurnCount <= 0) {
      return 0;
    }
    const loadedUserTurnCount = messages.filter((message) => message.role === 'user').length;
    return Math.max(0, serverTotalTurnCount - loadedUserTurnCount);
  }, [messages, serverTotalTurnCount]);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    publishSessionPendingPermission(sessionId, toSessionPendingPermissionState(pendingPermissions));
  }, [pendingPermissions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    publishSessionPendingQuestion(
      sessionId,
      pendingQuestions.find((question) => question.status === 'pending') ?? null,
    );
  }, [pendingQuestions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    publishSessionRunState(sessionId, resolveSessionSidebarRunState(streaming, sessionStateStatus));

    return () => {
      if (isSessionBusyForSidebar(streaming, sessionStateStatus)) {
        return;
      }
      publishSessionRunState(sessionId, 'idle');
    };
  }, [sessionId, sessionStateStatus, streaming]);

  useEffect(
    () => () => {
      if (!sessionId) {
        return;
      }
      publishSessionPendingPermission(sessionId, null);
      publishSessionPendingQuestion(sessionId, null);
    },
    [sessionId],
  );

  useEffect(() => {
    requestedTurnLimitRef.current = TEAM_CONVERSATION_INITIAL_TURN_LIMIT;
    setServerTotalTurnCount(null);
  }, [sessionId]);

  // ─── stream reveal + scroll manager ───────────────────────────────
  const { streamingRef, stoppingStreamRef, currentAssistantStreamMessageIdRef } = useStreamReveal(
    prefersReducedMotion,
    {
      setStreamBuffer,
      setStreamThinkingBuffer,
      setStreamThinkingBlocks,
      setStreamingSegments,
      setRecoveredStreamSnapshot: () => {
        // session-conversation v0.3 does not surface RecoveredActiveAssistantStream
        // outside the hook; this setter is a no-op so useStreamReveal can call it
        // during reset without crashing.
      },
      setStreaming,
      setStoppingStream,
      setActiveStreamStartedAt,
      setActiveStreamFirstTokenLatencyMs,
    },
  );

  const { handleScroll: scrollManagerHandleScroll, scrollToBottom } = useScrollManager(
    {
      scrollRegionRef,
      bottomRef,
      pendingScrollFrameRef,
      contentColumnRef,
      editorPaneRef,
      textareaRef,
    },
    {
      setShowScrollToBottom,
      setHasPendingFollowContent,
    },
    {
      messagesLength: messages.length,
      visibleStreaming,
      visibleStreamBufferLength: streamBuffer.length,
      editorMode: false,
    },
  );

  // ─── 加载会话快照 ────────────────────────────────────────────────
  const reload = useCallback(async (): Promise<void> => {
    if (reloadPromiseRef.current?.sessionId === sessionId) {
      return reloadPromiseRef.current.promise;
    }
    const reloadSessionId = sessionId;

    const reloadPromise = (async () => {
      clearRetry();

      if (!reloadSessionId || !token || !enabled) {
        hasRecoverySnapshotRef.current = false;
        resetRetry();
        setMessages([]);
        setChildSessions([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(false);
        setPendingPermissions([]);
        setPendingQuestions([]);
        setRunEvents([]);
        setRoleLayer(null);
        setSubstate(null);
        setServerTotalTurnCount(null);
        setSessionMetadata(null);
        setSnapshotError(null);
        setIsSessionLoading(false);
        return;
      }

      const hasCachedSnapshot = hasRecoverySnapshotRef.current;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        resetRetry();
        setIsSessionLoading(false);
        setSnapshotError(
          formatTeamConversationRecoveryLoadError({
            hasCachedSnapshot,
            result: {
              errorMessage: '当前网络离线，团队会话快照暂时不可用。',
              retryable: true,
            },
          }),
        );
        return;
      }

      setIsSessionLoading(!hasCachedSnapshot);
      setSnapshotError(null);
      const sessionsClient = createSessionsClient(gatewayUrl);
      const result = await sessionsClient.getRecoveryResult(token, reloadSessionId, {
        messageLimit: requestedTurnLimitRef.current,
      });
      if (reloadSessionId !== latestSessionIdRef.current) {
        return;
      }
      if (!result.ok || !result.recovery) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamConversationRecoveryRetryDelay,
          onRetry: () => {
            void reload();
          },
          retryable: result.retryable,
        });
        if (!hasCachedSnapshot) {
          setIsSessionSnapshotReady(false);
        }
        setIsSessionLoading(false);
        setSnapshotError(
          formatTeamConversationRecoveryLoadError({
            hasCachedSnapshot,
            nextRetryAtMs,
            result,
          }),
        );
        return;
      }

      const recovery = result.recovery;

      const normalized = normalizeChatMessages(recovery.session?.messages ?? []);
      setMessages(normalized);

      setChildSessions(
        recovery.children.map((child) => {
          // 从 child.metadata_json 中解析 teamRoleInstance 信息
          let displayName: string | null = null;
          let personaKey: string | null = null;
          if (child.metadata_json) {
            try {
              const parsed = JSON.parse(child.metadata_json) as unknown;
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const metadata = parsed as Record<string, unknown>;
                const roleInstance = metadata['teamRoleInstance'] as
                  Record<string, unknown> | undefined;
                if (roleInstance) {
                  if (typeof roleInstance['displayName'] === 'string') {
                    displayName = roleInstance['displayName'];
                  }
                  if (typeof roleInstance['personaKey'] === 'string') {
                    personaKey = roleInstance['personaKey'];
                  }
                }
              }
            } catch {
              // ignore parse errors
            }
          }
          return {
            id: child.id,
            role_layer: typeof child.role_layer === 'string' ? child.role_layer : null,
            messages: normalizeChatMessages(child.messages ?? []),
            displayName,
            personaKey,
          };
        }),
      );
      setServerTotalTurnCount(
        typeof recovery.totalTurnCount === 'number' ? recovery.totalTurnCount : null,
      );

      const stateStatus = (recovery.session?.state_status ?? null) as SessionStateStatus | null;
      setSessionStateStatus(stateStatus);
      setIsSessionSnapshotReady(true);

      // L1.8 / L1.3 字段：后端 sessions 表已扩展 role_layer（Phase B），
      // substate 待 L1.3 改造 2 落地。两者都用 unknown cast 读取，缺失时为 null。
      const sessionRow = recovery.session as unknown as Record<string, unknown> | undefined;
      const recoveryParentSessionId =
        typeof sessionRow?.['parentSessionId'] === 'string'
          ? (sessionRow['parentSessionId'] as string)
          : typeof sessionRow?.['team_parent_session_id'] === 'string'
            ? (sessionRow['team_parent_session_id'] as string)
            : null;
      const roleLayerValue =
        typeof sessionRow?.['role_layer'] === 'string'
          ? (sessionRow['role_layer'] as string)
          : null;
      const substateValue =
        typeof sessionRow?.['substate'] === 'string' ? (sessionRow['substate'] as string) : null;
      setRoleLayer(roleLayerValue);
      setSubstate(substateValue);

      // sessions.metadata_json：后端写入的 team session 结构（teamDefinition 等）。
      // 解析失败时不抛错，让消费方按 null 处理；前端只读，不回写不重试。
      const metadataJson =
        typeof sessionRow?.['metadata_json'] === 'string'
          ? (sessionRow['metadata_json'] as string)
          : null;
      if (metadataJson) {
        try {
          const parsed = JSON.parse(metadataJson) as unknown;
          const parsedMetadata =
            parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
          setSessionMetadata(parsedMetadata);
          if (parsedMetadata) {
            const metadataProviderId =
              typeof parsedMetadata['providerId'] === 'string' ? parsedMetadata['providerId'] : '';
            const metadataModelId =
              typeof parsedMetadata['modelId'] === 'string' ? parsedMetadata['modelId'] : '';
            if (metadataProviderId && metadataModelId) {
              setActiveProviderId(metadataProviderId);
              setActiveModelId(metadataModelId);
            }
            const metadataParentSessionId =
              typeof parsedMetadata['parentSessionId'] === 'string'
                ? (parsedMetadata['parentSessionId'] as string)
                : null;
            setResolvedParentSessionId(recoveryParentSessionId ?? metadataParentSessionId);
          } else {
            setResolvedParentSessionId(recoveryParentSessionId);
          }
        } catch {
          setSessionMetadata(null);
          setResolvedParentSessionId(recoveryParentSessionId);
        }
      } else {
        setSessionMetadata(null);
        setResolvedParentSessionId(recoveryParentSessionId);
      }

      // pending permissions / questions（来自 recovery，避免再发请求）
      setPendingPermissions(recovery.pendingPermissions ?? []);
      setPendingQuestions(recovery.pendingQuestions ?? []);
      setRunEvents(Array.isArray(recovery.session?.runEvents) ? recovery.session.runEvents : []);
      hasRecoverySnapshotRef.current = true;
      resetRetry();
      setSnapshotError(null);
      setIsSessionLoading(false);
    })();

    reloadPromiseRef.current = { promise: reloadPromise, sessionId: reloadSessionId };
    try {
      await reloadPromise;
    } finally {
      if (reloadPromiseRef.current?.promise === reloadPromise) {
        reloadPromiseRef.current = null;
      }
    }
  }, [clearRetry, enabled, gatewayUrl, resetRetry, scheduleRetry, sessionId, token]);

  // Keep a ref to reload for use in effects that need to trigger a refresh
  // without adding it to their dependency array (avoids re-registration churn).
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // ─── 当 sessionId 变化时自动 reload ─────────────────────────────
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }
    previousSessionIdRef.current = sessionId;
    hasRecoverySnapshotRef.current = false;
    setMessages([]);
    setChildSessions([]);
    setSessionStateStatus(null);
    setIsSessionSnapshotReady(false);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setRunEvents([]);
    setRoleLayer(null);
    setSubstate(null);
    setServerTotalTurnCount(null);
    setSessionMetadata(null);
    setResolvedParentSessionId(null);
    setSnapshotError(null);
    // 重置流式状态：session 切换时旧 attach/stream 连接已由 useGatewayClient
    // 内部 closeExistingTransports 关闭，这里同步清理本地 streaming 标记。
    streamingRef.current = false;
    setStreaming(false);
    setStoppingStream(false);
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    setStreamThinkingBlocks([]);
    setStreamingSegments([]);
    setReportedStreamUsage(null);
    setStreamError(null);
    // 重置 composer 输入和滚动状态，防止上一个会话的草稿/滚动位置残留
    setInput('');
    setShowScrollToBottom(false);
    setHasPendingFollowContent(false);
    setIsSessionLoading(Boolean(sessionId && token && enabled));
  }, [enabled, sessionId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!sessionId || !enabled || typeof window === 'undefined') {
      return undefined;
    }
    const handleOnline = () => {
      resetRetry();
      void reload();
    };
    const handleOffline = () => {
      resetRetry();
      setIsSessionLoading(false);
      setSnapshotError(
        formatTeamConversationRecoveryLoadError({
          hasCachedSnapshot: hasRecoverySnapshotRef.current,
          result: {
            errorMessage: '当前网络离线，团队会话快照暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled, reload, resetRetry, sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    void reload();
  }, [enabled, reload, resetRetry, sessionId, teamEventsRecoveredAt]);

  // ─── 订阅 team events：reception orchestrator 异步落 ack 消息后，
  //     通过 'session.inbound.submitted' / 'session.substate.changed'
  //     事件通知前端再 reload。也覆盖 handoff completed / failed 之后
  //     pm1 在子 session 写产物完后 reception 端自动刷新。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    let lastSeenTimestamp = 0;
    const unsub = useTeamNotificationStore.subscribe((state) => {
      const events = state.events;
      const last = events[events.length - 1];
      if (!last || last.timestamp <= lastSeenTimestamp) return;
      lastSeenTimestamp = last.timestamp;
      if (last.sessionId !== sessionId) return;
      if (
        last.type === 'session.inbound.submitted' ||
        last.type === 'session.substate.changed' ||
        last.type === 'session.init.changed' ||
        last.type === 'handoff.completed' ||
        last.type === 'handoff.failed' ||
        last.type === 'handoff.cancelled' ||
        last.type === 'handoff.reclaimed' ||
        last.type === 'handoff.started'
      ) {
        void reload();
      }
    });
    return () => {
      unsub();
    };
  }, [sessionId, enabled, reload]);

  // ─── 从 layer store 实时读取 substate ──────────────────────────────
  // dispatchTeamEvent 收到 session.substate.changed 事件后会实时更新 layer store，
  // 这里订阅 layer store 中当前 session 的 substate，无需等待 HTTP reload。
  // 这让进度条（TeamSubstateProgressBar）能在 substate 变更后立即更新。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    const unsub = useLayerStore.subscribe((state) => {
      const node = state.nodes.get(sessionId);
      if (node?.substate !== undefined) {
        setSubstate(node.substate);
      }
    });
    return () => {
      unsub();
    };
  }, [sessionId, enabled]);

  // ─── 高频 polling：当 session 处于 running 状态时自动刷新 ──────────
  // e/f/g 层用 runSessionInBackground 跑 stream 时，消息实时写入 DB。
  // 前端通过每 2.5s reload 一次来"准实时"看到新消息。
  // 当 session 回到 idle/completed 时停止 polling。
  // **多路 SSE 活跃时跳过轮询**：multi-attach store 的 SSE 连接已提供
  // 逐 token 实时流式，无需再靠轮询拉消息。仅在 multi-attach 未连接时
  // 回退到轮询。P0-2 fix: `multiAttachActive` 在依赖数组中，断开时自动重建轮询。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    if (sessionStateStatus !== 'running') return undefined;
    // 如果多路 SSE 已连接，跳过轮询（effect 会在 multiAttachActive 变化时重新执行）
    if (multiAttachActive) return undefined;
    // 使用 visibility check：只在 tab 可见时 poll
    let active = true;
    const interval = setInterval(() => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void reload();
    }, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionId, enabled, sessionStateStatus, reload, multiAttachActive]);

  // ─── 把"当前正在看的这个 session"注册到 layer store ────────────────
  // 「层级流动 / 层级 / 消息」三个 tab 的数据源是 useLayerStore.nodes +
  // useHandoffStore.handoffs，它们靠 /team/runtime 快照 + WS 事件填充。但一个
  // 只做了直答、还没派发任何 handoff 的 reception 会话，快照里可能尚未把它当成
  // 团队节点回灌（或时序上晚于本视图），导致这三个 tab 全空——用户会以为坏了。
  // 这里在会话加载出 roleLayer 后，主动把它 upsert 进 layer store，保证「层级」
  // 视图至少能看到当前这层的节点，handoff 链路一旦展开再由 WS/快照补全。
  useEffect(() => {
    if (!sessionId || !enabled || !roleLayer) return;
    const existingNode = useLayerStore.getState().nodes.get(sessionId);
    const metadataParentSessionId =
      typeof sessionMetadata?.['parentSessionId'] === 'string'
        ? (sessionMetadata['parentSessionId'] as string)
        : null;
    const parentSessionId =
      resolvedParentSessionId ?? metadataParentSessionId ?? existingNode?.parentSessionId ?? null;
    const rawRoleInstance = sessionMetadata?.['teamRoleInstance'];
    const roleInstance =
      typeof rawRoleInstance === 'object' &&
      rawRoleInstance !== null &&
      !Array.isArray(rawRoleInstance)
        ? (rawRoleInstance as Record<string, unknown>)
        : null;
    const rootSessionId =
      typeof roleInstance?.['rootSessionId'] === 'string' &&
      roleInstance['rootSessionId'].trim().length > 0
        ? roleInstance['rootSessionId'].trim()
        : null;
    const personaKey =
      typeof roleInstance?.['personaKey'] === 'string' &&
      roleInstance['personaKey'].trim().length > 0
        ? roleInstance['personaKey'].trim()
        : null;
    const displayName =
      typeof roleInstance?.['displayName'] === 'string' &&
      roleInstance['displayName'].trim().length > 0
        ? roleInstance['displayName'].trim()
        : null;
    const existing = existingNode;
    // 已存在且核心字段一致就不重复写（避免无谓 set 触发渲染）。
    if (
      existing &&
      existing.roleLayer === roleLayer &&
      existing.parentSessionId === parentSessionId &&
      (existing.rootSessionId ?? null) === rootSessionId &&
      existing.displayName === displayName &&
      existing.personaKey === personaKey
    ) {
      return;
    }
    useLayerStore.getState().addNode({
      sessionId,
      // 运行时为字符串；LayerNode.roleLayer 是 TeamRoleLayer 联合。未知值在
      // 渲染层会回退到中性身份，这里按已知层字符串传入即可。
      roleLayer: roleLayer as TeamRoleLayer,
      parentSessionId,
      // 用远端运行状态映射节点状态；未知时给 idle（store 接受 'idle'）。
      state:
        sessionStateStatus === 'running'
          ? 'running'
          : sessionStateStatus === 'paused'
            ? 'claimed'
            : 'idle',
      ...(rootSessionId ? { rootSessionId } : {}),
      ...(personaKey ? { personaKey } : {}),
      ...(displayName ? { displayName } : {}),
      ...(typeof sessionMetadata?.['title'] === 'string'
        ? { title: sessionMetadata['title'] as string }
        : {}),
    });
  }, [sessionId, enabled, roleLayer, resolvedParentSessionId, sessionMetadata, sessionStateStatus]);
  const submitInbound = useCallback<TeamConversationState['submitInbound']>(
    async (messageType, payload, opts) => {
      if (!sessionId) {
        throw new Error('当前团队会话不存在，无法提交团队消息。');
      }
      if (!token) {
        throw new Error('未登录，无法提交团队消息。');
      }
      const inboundClient = createTeamInboundClient(gatewayUrl);
      return inboundClient.submit(token, sessionId, {
        messageType,
        payload,
        clientIdempotencyKey: opts?.clientIdempotencyKey,
        expiresAt: opts?.expiresAt,
      });
    },
    [sessionId, token, gatewayUrl],
  );

  // ─── v0.3 writers / stream consumer ───────────────────────────────
  const gatewayClient = useGatewayClient(token);
  // Hold a `requestStartedAt` per round; refreshed on each startStream call.
  const streamRequestStartedAtRef = useRef<number>(Date.now());
  const onChatOnlyEventRef = useRef<((event: RunEvent) => void) | undefined>(undefined);
  const requestModelLabelRef = useRef<string | undefined>(undefined);
  const requestProviderIdRef = useRef<string | undefined>(undefined);
  const requestAgentIdRef = useRef<string | undefined>(undefined);

  const stream = useConversationStream(
    {
      currentAssistantStreamMessageIdRef,
      streamingRef,
      stoppingStreamRef,
    },
    {
      setMessages,
      setStreaming,
      setStoppingStream,
      setStreamBuffer,
      setStreamThinkingBuffer,
      setStreamThinkingBlocks,
      setStreamingSegments,
      setReportedStreamUsage,
      setStreamError,
      setActiveStreamStartedAt,
      setActiveStreamFirstTokenLatencyMs,
      setLatestUpstreamSummary,
      setSessionStateStatus,
      setPendingPermissions,
    },
    {
      sessionId,
      requestStartedAt: streamRequestStartedAtRef.current,
      get requestProviderId() {
        return requestProviderIdRef.current;
      },
      get requestModelLabel() {
        return requestModelLabelRef.current;
      },
      get requestAgentId() {
        return requestAgentIdRef.current;
      },
      onChatOnlyEvent: (event) => onChatOnlyEventRef.current?.(event),
      onStreamDone: () => {
        // Mirror finalized assistant message back through reload so the
        // gateway-persisted id replaces the locally generated message id
        // (keeps subsequent rounds aligned with backend state).
        void reload();
      },
      onStreamError: () => {
        // streamError state is already set by the consumer; no-op here.
      },
    },
  );

  // multiAttachActiveRef 和 multiAttachActive 已在会话状态区域声明（使用前定义）。

  const startStream: TeamConversationState['startStream'] = useCallback(
    async (text, opts) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法发送消息。');
      }
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法开始对话。');
      }
      if (streamingRef.current) {
        // 已在流式生成中：明确抛错而非静默 return。早期实现这里直接 return，
        // 上层 handleComposerSubmit 已先清空输入框，导致这条消息被静默丢弃且
        // 无任何反馈。改为抛错让调用方据此保留输入框内容并提示用户。
        throw new Error('正在生成回复，请等待当前回复完成或点击停止后再发送。');
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      onChatOnlyEventRef.current = opts?.onChatOnlyEvent;
      requestProviderIdRef.current = activeProviderId || undefined;
      const activeProvider = providers.find((provider) => provider.id === activeProviderId);
      const activeModel = activeProvider?.defaultModels.find((model) => model.id === activeModelId);
      const resolvedThinkingRequest = resolveChatThinkingRequest({
        providerType: activeProvider?.type,
        modelId: activeModel?.id ?? activeModelId,
        declaredSupportsThinking: activeModel?.supportsThinking === true,
        thinkingEnabled,
        reasoningEffort,
      });
      const activeModelLabel = activeModel?.label;
      requestModelLabelRef.current = activeModelLabel ?? activeModelId ?? undefined;
      requestAgentIdRef.current = opts?.agentId || effectiveAgentId || undefined;
      streamRequestStartedAtRef.current = Date.now();

      // Push the user message into the local list immediately for snappy UX.
      const userMessageId = makeOrderedMessageId();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        tokenEstimate: estimateTokenCount(trimmed),
      };
      setMessages((prev) => [...prev, userMessage]);
      // Pre-allocate the assistant streaming message id so the consumer can
      // accumulate segments under it before the gateway emits any event.
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      stream.resetRoundAccumulators();
      // Disable multi-attach handling during user-initiated stream — the
      // WS/SSE stream from startStream provides events directly.
      multiAttachActiveRef.current = false;
      setMultiAttachActive(false);
      setStreaming(true);
      streamingRef.current = true;
      setActiveStreamStartedAt(streamRequestStartedAtRef.current);
      setActiveStreamFirstTokenLatencyMs(null);
      setSessionStateStatus('running');

      gatewayClient.stream(sessionId, trimmed, {
        agentId: requestAgentIdRef.current,
        displayMessage: opts?.displayMessage,
        ...(opts?.inputParts ? { inputParts: opts.inputParts } : {}),
        model: activeModelId || 'default',
        providerId: activeProviderId || undefined,
        thinkingEnabled: resolvedThinkingRequest.thinkingEnabled,
        reasoningEffort: resolvedThinkingRequest.reasoningEffort,
        // team 端不传 dialogueMode / webSearchEnabled / yoloMode：这些是
        // chat-only 偏好，与 team 数据流无关。
        onDelta: () => {
          // useConversationStream consumes `text_delta` via onEvent; this
          // legacy hook is unused but required by the StreamCallbacks shape.
        },
        onEvent: (event) => {
          // GatewayStreamEvent === RunEvent for our purposes; cast through.
          stream.handleEvent(event as RunEvent);
        },
        onDone: () => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Re-enable multi-attach if it's still connected.
          // We do this synchronously in onDone (rather than relying on
          // checkAndRegister) to avoid a window where streamingRef is false
          // but multiAttachActiveRef is also false, which could let multi-attach
          // events leak into the old round's accumulator.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
          // Trigger reload (also called inside the consumer's onStreamDone).
        },
        onError: (code, message) => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setStreamError(formatGatewayStreamErrorMessage(code, message));
          // Re-enable multi-attach on error too, if still connected.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
        },
      });
    },
    [
      enableWriters,
      sessionId,
      token,
      activeProviderId,
      activeModelId,
      thinkingEnabled,
      reasoningEffort,
      effectiveAgentId,
      providers,
      gatewayClient,
      stream,
      streamingRef,
      currentAssistantStreamMessageIdRef,
    ],
  );

  const stopStream: TeamConversationState['stopStream'] = useCallback(async () => {
    if (!enableWriters) return false;
    setStoppingStream(true);
    stoppingStreamRef.current = true;
    try {
      const ok = await gatewayClient.stopStream();
      if (ok) {
        // The stream's `done` event will reset state shortly; meanwhile mark
        // streaming false eagerly so the UI reflects the user's intent.
        streamingRef.current = false;
        setStreaming(false);
      }
      return ok;
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'stopStream failed');
      return false;
    } finally {
      setStoppingStream(false);
      stoppingStreamRef.current = false;
    }
  }, [enableWriters, gatewayClient, streamingRef, stoppingStreamRef]);

  // ─── attach to background stream ────────────────────────────────
  // reception session 走 inbound 路径后，后端通过 `runSessionInBackground`
  // 启动 LLM stream（direct 路径）或派发到子 session（orchestrate 路径）。
  // 对于 direct 路径，流式 token 通过 `publishSessionRunEvent` 发布到
  // session 级别事件总线，前端可通过 `/sessions/:id/stream/attach` SSE
  // 端点实时消费。本方法封装 attach 连接，将收到的 RunEvent 转发给
  // `useConversationStream.handleEvent`，实现与 `startStream` 相同的
  // 逐 token 流式渲染效果。
  const attachAttemptedSessionRef = useRef<string | null>(null);
  const attachRetryCountRef = useRef(0);
  const ATTACH_MAX_RETRIES = 3;

  const attachToSessionStream: TeamConversationState['attachToSessionStream'] =
    useCallback(async () => {
      if (!sessionId || !token) {
        return false;
      }
      // 已在流式中（startStream 路径）不需要 attach。
      if (streamingRef.current) {
        return false;
      }
      // 同一 session 只尝试一次 attach，避免循环重试。
      // 但如果上次 attach 失败（attachAttemptedSessionRef 被重置为 null），
      // 允许重试，最多 ATTACH_MAX_RETRIES 次。
      if (attachAttemptedSessionRef.current === sessionId) {
        return false;
      }
      if (attachRetryCountRef.current >= ATTACH_MAX_RETRIES) {
        return false;
      }
      attachAttemptedSessionRef.current = sessionId;
      attachRetryCountRef.current += 1;

      // 预分配 assistant 流式消息 id，供 useConversationStream 累积 segments。
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      streamRequestStartedAtRef.current = Date.now();
      // attach 路径下 provider/model 未知（后端使用 session 默认配置），
      // 仅设置 agentId 以便流式消息能显示正确的角色身份。
      requestProviderIdRef.current = activeProviderId || undefined;
      requestModelLabelRef.current = activeModelId || undefined;
      requestAgentIdRef.current = effectiveAgentId || undefined;
      stream.resetRoundAccumulators();
      setStreaming(true);
      streamingRef.current = true;
      setActiveStreamStartedAt(streamRequestStartedAtRef.current);
      setActiveStreamFirstTokenLatencyMs(null);
      setSessionStateStatus('running');

      const attached = await gatewayClient.attachToActiveStream(sessionId, {
        onDelta: () => {
          // useConversationStream consumes `text_delta` via onEvent; this
          // legacy hook is unused but required by the StreamCallbacks shape.
        },
        onEvent: (event) => {
          stream.handleEvent(event as RunEvent);
        },
        onDone: () => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Re-enable multi-attach if it's still connected (same as startStream's onDone).
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
          // reload 已由 useConversationStream 的 onStreamDone 回调触发，
          // 这里不重复调用，避免冗余请求。
        },
        onError: (code, message) => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Attach 失败不一定是错误——可能后端 direct 路径已完成或走了
          // orchestrate 路径（无活跃流）。仅在非"无活跃流"错误时提示。
          if (code !== 'NO_ACTIVE_STREAM' && code !== 'ATTACH_NO_ACTIVE_STREAM') {
            setStreamError(formatGatewayStreamErrorMessage(code, message));
          }
          // Re-enable multi-attach on error too, if still connected.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
        },
      });
      // attach 成功：重置重试计数。
      if (attached) {
        attachRetryCountRef.current = 0;
      }
      // attach 未成功（无活跃流等）：回滚 streaming 状态，避免 UI 卡在
      // "streaming" 模式。onError 回调已处理错误场景的清理。
      // 不回滚 sessionStateStatus——后端可能在短时间内将状态从 running 切到
      // 其它值，下一次 reload() 会同步真实状态。
      if (!attached) {
        streamingRef.current = false;
        setStreaming(false);
        setActiveStreamStartedAt(null);
        // 重置 attach 标记：attach 失败可能是时序问题（后端流尚未注册），
        // 允许自动 attach effect 在下一次 reload 检测到 running 时重试。
        attachAttemptedSessionRef.current = null;
        // 触发 reload 同步真实 session 状态，避免 attach 失败后状态不一致。
        void reload();
      }
      return attached;
    }, [
      sessionId,
      token,
      gatewayClient,
      stream,
      streamingRef,
      currentAssistantStreamMessageIdRef,
      reload,
      activeProviderId,
      activeModelId,
      effectiveAgentId,
    ]);

  // 当 sessionId 变化时重置 attach 尝试标记，允许新 session 重新 attach。
  useEffect(() => {
    if (
      attachAttemptedSessionRef.current !== null &&
      attachAttemptedSessionRef.current !== sessionId
    ) {
      attachAttemptedSessionRef.current = null;
      attachRetryCountRef.current = 0;
    }
  }, [sessionId]);

  // 自动 attach：当 session 处于 running 状态、未在本地流式中、且尚未尝试过 attach 时，
  // 自动发起 attach。覆盖 reception inbound 提交后后端启动后台流的场景。
  // **多路 SSE 活跃时跳过**：multi-attach 已提供实时流式，不需要单路 attach。
  useEffect(() => {
    if (!sessionId || !enabled || !enableWriters) return;
    if (sessionStateStatus !== 'running') return;
    if (streamingRef.current) return;
    if (attachAttemptedSessionRef.current === sessionId) return;
    if (multiAttachActive) return; // 多路 SSE 已接管，跳过单路 attach
    // 延迟 500ms 再尝试 attach——后端 runSessionInBackground 是 fire-and-forget，
    // 需要一点时间让活跃流注册到 session_run_events 总线。
    const timer = setTimeout(() => {
      void attachToSessionStream();
    }, 500);
    return () => clearTimeout(timer);
  }, [
    sessionId,
    enabled,
    enableWriters,
    sessionStateStatus,
    attachToSessionStream,
    multiAttachActive,
  ]);

  // ─── 多路 SSE 注册：把 stream.handleEvent 注册到 multi-attach store ──
  // 当 useMultiSessionAttach 为此 session 建立了 SSE 连接时，收到的
  // RunEvent 会通过 dispatchEvent 转发到这里注册的 handleEvent，实现
  // 非聚焦 session 的逐 token 流式渲染。
  // 只在 session 处于 running 状态、且没有本地 stream / 单路 attach 活跃时
  // 注册——避免与 startStream / attachToSessionStream 产生重复事件。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;

    // Check if multi-attach is connected for this session
    const checkAndRegister = () => {
      const status = useMultiAttachStore.getState().sessions.get(sessionId);
      const isAttached = status?.state === 'connected';

      if (isAttached && !streamingRef.current && !multiAttachActiveRef.current) {
        // Multi-attach is active and we're not locally streaming — register
        multiAttachActiveRef.current = true;
        setMultiAttachActive(true);
        // Pre-allocate assistant stream message id for accumulation
        if (!currentAssistantStreamMessageIdRef.current) {
          currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
        }
        stream.resetRoundAccumulators();
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
          setActiveStreamStartedAt(Date.now());
          setActiveStreamFirstTokenLatencyMs(null);
        }
      } else if (!isAttached && multiAttachActiveRef.current) {
        // Multi-attach disconnected — unregister
        multiAttachActiveRef.current = false;
        setMultiAttachActive(false);
        if (streamingRef.current) {
          streamingRef.current = false;
          setStreaming(false);
          setActiveStreamStartedAt(null);
        }
      }
    };

    checkAndRegister();

    // Subscribe to multi-attach store changes
    const unsubMultiAttach = useMultiAttachStore.subscribe(checkAndRegister);

    // Register handleEvent callback
    const handleMultiAttachEvent = (
      event: RunEvent,
      _meta: { rowId: number; clientRequestId?: string },
    ) => {
      // Skip if we're locally streaming via startStream (user-initiated)
      // but NOT if we're streaming via multi-attach itself.
      if (streamingRef.current && !multiAttachActiveRef.current) return;
      stream.handleEvent(event);
    };

    const unregisterHandler = useMultiAttachStore
      .getState()
      .registerHandler(sessionId, handleMultiAttachEvent);

    return () => {
      unsubMultiAttach();
      unregisterHandler();
      multiAttachActiveRef.current = false;
      setMultiAttachActive(false);
    };
  }, [
    sessionId,
    enabled,
    stream,
    streamingRef,
    currentAssistantStreamMessageIdRef,
    setStreaming,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  ]);

  // ─── 子 session 流式：为 childSessions 中 running 的子 session 注册 handler ──
  // multi-attach SSE 会为所有 running session 建立连接并接收 RunEvent，
  // 但默认只有当前聚焦 session 注册了 handler。子 session (executor/reviewer)
  // 的流式 token 事件会被 multi-attach-store 接收但无 handler 消费，被丢弃。
  // 这里为每个 running 子 session 注册一个简化的 handler，将 text_delta
  // 累积到 childSessions 对应项的流式消息中，实现子 session 的实时流式展示。
  const childStreamBuffersRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // 找出所有可能是 running 的子 session（executor/reviewer/pm1/pm2 层级）
    const runningChildren = childSessions.filter(
      (child) =>
        child.role_layer === 'executor' ||
        child.role_layer === 'reviewer' ||
        child.role_layer === 'pm1' ||
        child.role_layer === 'pm2',
    );
    if (runningChildren.length === 0) return undefined;

    const unregisters: Array<() => void> = [];

    for (const child of runningChildren) {
      const childSessionId = child.id;
      const streamingMsgId = `streaming:${childSessionId}`;

      const handleChildEvent = (
        event: RunEvent,
        _meta: { rowId: number; clientRequestId?: string },
      ) => {
        if (event.type === 'text_delta' && typeof event.delta === 'string') {
          // 累积流式文本到 per-child buffer
          const buffers = childStreamBuffersRef.current;
          const current = buffers.get(childSessionId) ?? '';
          buffers.set(childSessionId, current + event.delta);
          const buffer = buffers.get(childSessionId) ?? '';

          // 更新 childSessions：在对应子 session 的 messages 末尾
          // 追加或更新一条流式 assistant 消息
          setChildSessions((prev) =>
            prev.map((cs) => {
              if (cs.id !== childSessionId) return cs;
              const existingMessages = cs.messages ?? [];
              // 检查最后一条消息是否是我们的流式消息
              const lastMsg = existingMessages[existingMessages.length - 1];
              if (lastMsg && lastMsg.id === streamingMsgId) {
                // 更新已有的流式消息
                const updatedMessages = [...existingMessages];
                updatedMessages[updatedMessages.length - 1] = {
                  ...lastMsg,
                  content: buffer,
                };
                return { ...cs, messages: updatedMessages };
              }
              // 追加新的流式消息
              return {
                ...cs,
                messages: [
                  ...existingMessages,
                  {
                    id: streamingMsgId,
                    role: 'assistant' as const,
                    content: buffer,
                    createdAt: Date.now(),
                  } as ChatMessage,
                ],
              };
            }),
          );
        }
      };

      const unregister = useMultiAttachStore
        .getState()
        .registerHandler(childSessionId, handleChildEvent);
      unregisters.push(unregister);
    }

    return () => {
      for (const unregister of unregisters) {
        unregister();
      }
    };
  }, [childSessions.length, childSessions.map((c) => c.id).join(',')]);

  const replyPermission: TeamConversationState['replyPermission'] = useCallback(
    async (requestId, decision, options) => {
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理权限请求。');
      }
      await createPermissionsClient(gatewayUrl).reply(
        token,
        options?.targetSessionId ?? sessionId,
        {
          requestId,
          decision,
          ...(options?.alwaysOverride ? { alwaysOverride: options.alwaysOverride } : {}),
          ...(options?.feedback ? { feedback: options.feedback } : {}),
        },
      );
      // Optimistically remove from pending list; the permission_replied event
      // will also clear on receipt.
      setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [sessionId, token, gatewayUrl],
  );

  const replyQuestion: TeamConversationState['replyQuestion'] = useCallback(
    async (requestId, status, answers, options) => {
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理提问请求。');
      }
      await createQuestionsClient(gatewayUrl).reply(token, options?.targetSessionId ?? sessionId, {
        requestId,
        status,
        ...(answers ? { answers } : {}),
      });
      setPendingQuestions((prev) => prev.filter((q) => q.requestId !== requestId));
    },
    [enableWriters, sessionId, token, gatewayUrl],
  );

  const loadProviders: TeamConversationState['loadProviders'] = useCallback(async () => {
    if (!token) return;
    clearProvidersRetry();
    const hasCachedProviders = providersRef.current.length > 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setProvidersError(
        formatTeamConversationProvidersLoadError({
          hasCachedProviders,
          result: {
            errorMessage: '当前网络离线，Provider 列表暂时不可用。',
            retryable: true,
          },
        }),
      );
      return;
    }
    const result = await loadSavedChatSessionDefaultsResult(gatewayUrl, token);
    if (!result.ok || !result.data) {
      const nextRetryAtMs = scheduleProvidersRetry({
        computeDelay: computeTeamConversationProvidersRetryDelay,
        onRetry: () => {
          void loadProviders();
        },
        retryable: result.retryable,
      });
      setProvidersError(
        formatTeamConversationProvidersLoadError({
          hasCachedProviders,
          nextRetryAtMs,
          result,
        }),
      );
      return;
    }

    resetProvidersRetry();
    setProviders(result.data.providers);
    setProvidersError(null);
    // 注意：team 端只接受 provider/model 与模型思考默认值，不写 chat-only
    // 偏好（dialogueMode / yoloMode / webSearchEnabled 等）。
    if (!activeProviderId && result.data.defaults.providerId) {
      setActiveProviderId(result.data.defaults.providerId);
    }
    if (!activeModelId && result.data.defaults.modelId) {
      setActiveModelId(result.data.defaults.modelId);
    }
    if (defaults?.thinkingEnabled === undefined) {
      setThinkingEnabled(result.data.defaults.thinkingEnabled);
    }
    if (defaults?.reasoningEffort === undefined) {
      setReasoningEffort(result.data.defaults.reasoningEffort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModelId,
    activeProviderId,
    defaults?.reasoningEffort,
    defaults?.thinkingEnabled,
    clearProvidersRetry,
    gatewayUrl,
    resetProvidersRetry,
    scheduleProvidersRetry,
    token,
  ]);

  // ─── auto-load providers on mount when writers enabled ────────────
  const providersLoadedRef = useRef(false);
  useEffect(() => {
    if (!enableWriters || providersLoadedRef.current) return;
    if (!token) return;
    providersLoadedRef.current = true;
    void loadProviders();
  }, [enableWriters, token, loadProviders]);

  useEffect(() => {
    return () => {
      clearProvidersRetry();
    };
  }, [clearProvidersRetry]);

  useEffect(() => {
    if (!enableWriters || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      if (providersLoadedRef.current) {
        void loadProviders();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [enableWriters, loadProviders]);

  const loadEarlierMessages = useCallback(async (): Promise<void> => {
    requestedTurnLimitRef.current += TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT;
    await reload();
  }, [reload]);

  return {
    messages,
    setMessages,
    streaming,
    stoppingStream,
    streamBuffer,
    streamThinkingBuffer,
    streamThinkingBlocks,
    streamingSegments,
    reportedStreamUsage,
    streamError,
    setStreamError,
    snapshotError,
    setSnapshotError,
    providersError,
    setProvidersError,

    input,
    setInput,
    textareaRef,

    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    thinkingEnabled,
    setThinkingEnabled,
    reasoningEffort,
    setReasoningEffort,

    scrollRegionRef,
    contentColumnRef,
    bottomRef,
    showScrollToBottom,
    hasPendingFollowContent,
    isSessionLoading,

    sessionStateStatus,
    isSessionSnapshotReady,
    sessionTodos,
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,
    runEvents,
    roleLayer,
    substate,
    sessionMetadata,
    childSessions,

    remoteSessionBusyState,
    visibleStreaming,
    hiddenMessageCount,

    reload,
    loadEarlierMessages,
    submitInbound,
    startStream,
    stopStream,
    attachToSessionStream,
    replyPermission,
    replyQuestion,
    loadProviders,
    onScroll: scrollManagerHandleScroll,
    scrollToBottom,
  };
}
