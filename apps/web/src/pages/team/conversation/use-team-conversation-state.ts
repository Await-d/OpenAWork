/**
 * useTeamConversationState · team 端对话 state hook
 *
 * 把 team 端"单 session 对话布局"所需的全部 state 打包成一个 hook，让
 * `<TeamConversationView/>` 通过它获得消息流 / 流式 / 滚动 / Q/P 回复 /
 * provider 列表 / inbound 提交所需的全部 props。
 *
 * **本 hook 是 `useChatConversationState` 的 team 独立版本**（260518 解耦
 * 方案 §6.4）：从 chat 复制为模板，再裁剪 chat-only 字段（dialogueMode /
 * yoloMode / webSearchEnabled / manualAgentId / thinkingEnabled /
 * reasoningEffort 等），加 team 专属字段（roleLayer / substate /
 * sessionMetadata 已在共享层；handoffsInline / layeredGroups 等后续 v2 加）。
 *
 * 与 chat 端的关键差异：
 * 1. **写入路径默认 enable**：team session 默认开启 composer，按
 *    `resolveTeamSubmitStrategy(roleLayer, substate)` 在 `inbound` 与
 *    `stream` 之间路由。
 * 2. **不传 chat 业务参数到 stream**：dialogue mode / yolo / web search /
 *    thinking / reasoning effort 等 chat-only 选项不参与 team stream
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
import type { InputImageContent, RunEvent } from '@openAwork/shared';
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
} from '../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import {
  loadSavedChatSessionDefaults,
  loadSavedChatSessionDefaultsResult,
  type ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import {
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
  type TeamRoleLayer,
} from '../../../stores/team/team-events.js';
import {
  formatGatewayStreamErrorMessage,
  useGatewayClient,
} from '../../../hooks/gateway/useGatewayClient.js';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
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
   * 注入；不复用 chat 端的 dialogueMode / yoloMode / webSearchEnabled 等
   * 偏好（这些与 team 数据流无关）。
   */
  defaults?: {
    activeProviderId?: string;
    activeModelId?: string;
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
  // team 端只暴露 provider / model；chat-only 偏好（dialogueMode / yoloMode /
  // webSearchEnabled / manualAgentId / thinkingEnabled / reasoningEffort）
  // 不参与 team 数据流，已从 hook 中移除（260518 解耦方案 §6.4）。
  providers: ChatSettingsProvider[];
  setProviders: React.Dispatch<React.SetStateAction<ChatSettingsProvider[]>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;

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
  /** 行内回复 pending permission（chat 端 InlineQuestionPanel 用）。 */
  replyPermission: (
    requestId: string,
    decision: PermissionDecision,
    feedback?: string,
  ) => Promise<void>;
  /** 行内回复 pending question。 */
  replyQuestion: (
    requestId: string,
    status: 'answered' | 'dismissed',
    answers?: string[][],
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
  const [activeStreamStartedAt, setActiveStreamStartedAt] = useState<number | null>(null);
  const [activeStreamFirstTokenLatencyMs, setActiveStreamFirstTokenLatencyMs] = useState<
    number | null
  >(null);

  // ─── composer ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  // team 端只保留 provider / model；chat-only 偏好（dialogueMode / yoloMode /
  // webSearchEnabled / manualAgentId / thinkingEnabled / reasoningEffort）
  // 不参与 team 数据流，已从 hook 中移除（260518 解耦方案 §6.4）。
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>(
    defaults?.activeProviderId ?? '',
  );
  const [activeModelId, setActiveModelId] = useState<string>(defaults?.activeModelId ?? '');

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
  // L1.8 / L1.3 扩展字段（hook v0.2 新增）
  const [roleLayer, setRoleLayer] = useState<string | null>(null);
  const [substate, setSubstate] = useState<string | null>(null);
  const [serverTotalTurnCount, setServerTotalTurnCount] = useState<number | null>(null);
  // 解析后的 sessions.metadata_json（不直接放原 JSON 字符串，避免消费方再次解析）。
  // 形如 { teamDefinition?: {...}, teamWorkspaceId?: string, workingDirectory?: string, ... }
  // 解析失败 / 缺失时为 null。
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, unknown> | null>(null);
  const hasRecoverySnapshotRef = useRef(false);
  const requestedTurnLimitRef = useRef(TEAM_CONVERSATION_INITIAL_TURN_LIMIT);
  const reloadPromiseRef = useRef<Promise<void> | null>(null);
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
    requestedTurnLimitRef.current = TEAM_CONVERSATION_INITIAL_TURN_LIMIT;
    setServerTotalTurnCount(null);
  }, [sessionId]);

  // ─── stream reveal + scroll manager ───────────────────────────────
  const { streamingRef, stoppingStreamRef, currentAssistantStreamMessageIdRef, resetStreamState } =
    useStreamReveal(prefersReducedMotion, {
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
    });

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
    if (reloadPromiseRef.current) {
      return reloadPromiseRef.current;
    }

    const reloadPromise = (async () => {
      clearRetry();

      if (!sessionId || !token || !enabled) {
        hasRecoverySnapshotRef.current = false;
        resetRetry();
        setMessages([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(false);
        setPendingPermissions([]);
        setPendingQuestions([]);
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
      const result = await sessionsClient.getRecoveryResult(token, sessionId, {
        messageLimit: requestedTurnLimitRef.current,
      });
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
      setServerTotalTurnCount(
        typeof recovery.totalTurnCount === 'number' ? recovery.totalTurnCount : null,
      );

      const stateStatus = (recovery.session?.state_status ?? null) as SessionStateStatus | null;
      setSessionStateStatus(stateStatus);
      setIsSessionSnapshotReady(true);

      // L1.8 / L1.3 字段：后端 sessions 表已扩展 role_layer（Phase B），
      // substate 待 L1.3 改造 2 落地。两者都用 unknown cast 读取，缺失时为 null。
      const sessionRow = recovery.session as unknown as Record<string, unknown> | undefined;
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
          setSessionMetadata(
            parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
          );
        } catch {
          setSessionMetadata(null);
        }
      } else {
        setSessionMetadata(null);
      }

      // pending permissions / questions（来自 recovery，避免再发请求）
      setPendingPermissions(recovery.pendingPermissions ?? []);
      setPendingQuestions(recovery.pendingQuestions ?? []);
      hasRecoverySnapshotRef.current = true;
      resetRetry();
      setSnapshotError(null);
      setIsSessionLoading(false);
    })();

    reloadPromiseRef.current = reloadPromise;
    try {
      await reloadPromise;
    } finally {
      if (reloadPromiseRef.current === reloadPromise) {
        reloadPromiseRef.current = null;
      }
    }
  }, [clearRetry, enabled, gatewayUrl, resetRetry, scheduleRetry, sessionId, token]);

  // ─── 当 sessionId 变化时自动 reload ─────────────────────────────
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

  // ─── 高频 polling：当 session 处于 running 状态时自动刷新 ──────────
  // e/f/g 层用 runSessionInBackground 跑 stream 时，消息实时写入 DB。
  // 前端通过每 2s reload 一次来"准实时"看到新消息。
  // 当 session 回到 idle/completed 时停止 polling。
  // Fix #5: 加 debounce，避免多个 running session 同时 poll 导致请求风暴。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    if (sessionStateStatus !== 'running') return undefined;
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
  }, [sessionId, enabled, sessionStateStatus, reload]);

  // ─── 把"当前正在看的这个 session"注册到 layer store ────────────────
  // 「层级流动 / 层级 / 消息」三个 tab 的数据源是 useLayerStore.nodes +
  // useHandoffStore.handoffs，它们靠 /team/runtime 快照 + WS 事件填充。但一个
  // 只做了直答、还没派发任何 handoff 的 reception 会话，快照里可能尚未把它当成
  // 团队节点回灌（或时序上晚于本视图），导致这三个 tab 全空——用户会以为坏了。
  // 这里在会话加载出 roleLayer 后，主动把它 upsert 进 layer store，保证「层级」
  // 视图至少能看到当前这层的节点，handoff 链路一旦展开再由 WS/快照补全。
  useEffect(() => {
    if (!sessionId || !enabled || !roleLayer) return;
    const parentSessionId =
      typeof sessionMetadata?.['parentSessionId'] === 'string'
        ? (sessionMetadata['parentSessionId'] as string)
        : null;
    const existing = useLayerStore.getState().nodes.get(sessionId);
    // 已存在且核心字段一致就不重复写（避免无谓 set 触发渲染）。
    if (
      existing &&
      existing.roleLayer === roleLayer &&
      existing.parentSessionId === parentSessionId
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
      ...(typeof sessionMetadata?.['title'] === 'string'
        ? { title: sessionMetadata['title'] as string }
        : {}),
    });
  }, [sessionId, enabled, roleLayer, sessionMetadata, sessionStateStatus]);
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
      const activeModelLabel = providers
        .find((p) => p.id === activeProviderId)
        ?.defaultModels.find((m) => m.id === activeModelId)?.label;
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
        // team 端不传 dialogueMode / thinkingEnabled / reasoningEffort /
        // webSearchEnabled / yoloMode：这些是 chat-only 偏好，与 team 数据流
        // 无关。后端对缺失字段使用默认值。
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
          // Trigger reload (also called inside the consumer's onStreamDone).
        },
        onError: (code, message) => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setStreamError(formatGatewayStreamErrorMessage(code, message));
        },
      });
    },
    [
      enableWriters,
      sessionId,
      token,
      activeProviderId,
      activeModelId,
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

  const replyPermission: TeamConversationState['replyPermission'] = useCallback(
    async (requestId, decision, feedback) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法处理权限请求。');
      }
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理权限请求。');
      }
      await createPermissionsClient(gatewayUrl).reply(token, sessionId, {
        requestId,
        decision,
        ...(feedback ? { feedback } : {}),
      });
      // Optimistically remove from pending list; the permission_replied event
      // will also clear on receipt.
      setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [enableWriters, sessionId, token, gatewayUrl],
  );

  const replyQuestion: TeamConversationState['replyQuestion'] = useCallback(
    async (requestId, status, answers) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法处理提问请求。');
      }
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理提问请求。');
      }
      await createQuestionsClient(gatewayUrl).reply(token, sessionId, {
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
    // 注意：team 端只接受用户已显式选择的 provider/model，不写 chat-only
    // 偏好（thinkingEnabled / reasoningEffort 等）。这些偏好由 chat 端
    // 各自管理，不在 team 数据流中体现。
    if (!activeProviderId && result.data.defaults.providerId) {
      setActiveProviderId(result.data.defaults.providerId);
    }
    if (!activeModelId && result.data.defaults.modelId) {
      setActiveModelId(result.data.defaults.modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModelId,
    activeProviderId,
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
    roleLayer,
    substate,
    sessionMetadata,

    remoteSessionBusyState,
    visibleStreaming,
    hiddenMessageCount,

    reload,
    loadEarlierMessages,
    submitInbound,
    startStream,
    stopStream,
    replyPermission,
    replyQuestion,
    loadProviders,
    onScroll: scrollManagerHandleScroll,
    scrollToBottom,
  };
}
