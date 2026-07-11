/**
 * useSessionConversationState · Phase 2a/2b 核心 hook
 *
 * 把"单 session 对话布局"所需的全部 state 打包成一个 hook，让 chat 与 team
 * 都通过它获得 SessionConversationView 需要的 80+ props。
 *
 * **当前阶段（v0.2 Phase 2b 前端契约先行）**：
 * - v0.1 已实现：sessionId 驱动 + getRecovery 加载消息 + pending 状态
 * - **v0.2 新增**：`submitInbound(messageType, payload)` 方法，对应 L1.3 spec §1.3
 *   反向消息通道。后端端点（`POST /team/sessions/:sessionId/inbound-messages`）
 *   由 L1.3 改造 1 提供，**当前后端未落地，调用会得到 404**——前端契约先行，
 *   等后端落地后无需改动即可使用。
 *
 * 完整版（v1.0+）可能需要后续实现的能力：
 * - 完整 attach/recovery 协议（断线重连、snapshot 加载）
 * - 子代理列表 + 历史编辑 + retry
 * - 完整 inline question 流
 *
 * **设计原则**：
 * 1. **sessionId 驱动**：所有 state 围绕传入的 sessionId 重置 + 重载。
 * 2. **业务能力开关分离**：image generation / skill / bookmark 等 chat-only
 *    能力不进本 hook（让 chat 自己组装）。
 * 3. **streaming 协议透明**：不假设 chat 还是 team 来源，只需要 sessionId
 *    指向同一张 sessions 表的行即可（与 L1.8 已扩展字段兼容）。
 * 4. **写入路径分离**：
 *    - chat 路径：用户输入 → POST /sessions/:id/stream（chat session 协议）
 *    - team 路径：用户输入 → submitInbound（L1.3 反向通道）
 *    本 hook 暴露 `submitInbound`，但 chat 端正常情况下不调（仍走 stream）
 *
 * 关联文档：
 * - `docs/chat-conversation-reuse-plan.md` Phase 2a / Phase 2b
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InputImageContent, RunEvent } from '@openAwork/shared';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import {
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
import type { DialogueMode } from '../mode/dialogue-mode.js';
import type { ReasoningEffort } from '../../../components/conversation-runtime/messages/support.js';
import {
  loadSavedChatSessionDefaults,
  type ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import { useTeamNotificationStore } from '../../../stores/team/team-events.js';
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
import { replyPermissionRequest } from '../../../utils/permission/permission-reply.js';

function extractLatestUpstreamSummaryFromRunEvents(
  events: RunEvent[] | undefined,
): UpstreamStreamSummary | null {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event &&
      (event.type === 'done' || event.type === 'error') &&
      'upstreamSummary' in event &&
      event.upstreamSummary
    ) {
      return event.upstreamSummary;
    }
  }
  return null;
}

// ─── Hook 输入 ────────────────────────────────────────────────────────────

export interface UseSessionConversationStateOptions {
  /** 当前要渲染的 session id；为 null 时 hook 进入空闲态。 */
  sessionId: string | null;
  /** 当前用户邮箱（用于 queue scope key、显示等）。 */
  currentUserEmail: string;
  /** Gateway URL。 */
  gatewayUrl: string;
  /** 访问 token。 */
  token: string | null;
  /** 是否启用自动加载（chat 默认 true，team 在 session 选中后才 true）。 */
  enabled?: boolean;
  /**
   * Whether the consumer wants the hook to provide stream/scroll/inbound
   * **writers** in addition to the read-only state. team uses this; chat
   * (Phase 1) does not (chat keeps driving streams from ChatPage). Defaults
   * to false to preserve the v0.2 contract.
   */
  enableWriters?: boolean;
  /**
   * Optional default agent id sent on every outgoing stream. team's
   * reception session may inject it from session metadata.
   */
  effectiveAgentId?: string;
  /** session 默认配置（chat 启动时从 localStorage 恢复，team 由后端 metadata 注入）。 */
  defaults?: {
    activeProviderId?: string;
    activeModelId?: string;
    dialogueMode?: DialogueMode;
    manualAgentId?: string;
    yoloMode?: boolean;
    webSearchEnabled?: boolean;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
  };
}

// ─── Hook 输出 ────────────────────────────────────────────────────────────

export interface SessionConversationState {
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
  latestUpstreamSummary: UpstreamStreamSummary | null;

  // ─── composer ────────────────────────────────────────────────────
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  providers: ChatSettingsProvider[];
  setProviders: React.Dispatch<React.SetStateAction<ChatSettingsProvider[]>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  dialogueMode: DialogueMode;
  setDialogueMode: React.Dispatch<React.SetStateAction<DialogueMode>>;
  manualAgentId: string;
  setManualAgentId: React.Dispatch<React.SetStateAction<string>>;
  yoloMode: boolean;
  setYoloMode: React.Dispatch<React.SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: React.Dispatch<React.SetStateAction<boolean>>;
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

  // ─── 操作 ────────────────────────────────────────────────────────
  /** 重新加载当前 session 的快照（消息列表 + pending 状态）。 */
  reload: () => Promise<void>;

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
export function useChatConversationState(
  options: UseSessionConversationStateOptions,
): SessionConversationState {
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
  const [latestUpstreamSummary, setLatestUpstreamSummary] = useState<UpstreamStreamSummary | null>(
    null,
  );
  const [activeStreamStartedAt, setActiveStreamStartedAt] = useState<number | null>(null);
  const [activeStreamFirstTokenLatencyMs, setActiveStreamFirstTokenLatencyMs] = useState<
    number | null
  >(null);

  // ─── composer ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>(
    defaults?.activeProviderId ?? '',
  );
  const [activeModelId, setActiveModelId] = useState<string>(defaults?.activeModelId ?? '');
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>(
    defaults?.dialogueMode ?? 'coding',
  );
  const [manualAgentId, setManualAgentId] = useState(defaults?.manualAgentId ?? '');
  const [yoloMode, setYoloMode] = useState(defaults?.yoloMode ?? false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(defaults?.webSearchEnabled ?? true);
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
  // L1.8 / L1.3 扩展字段（hook v0.2 新增）
  const [roleLayer, setRoleLayer] = useState<string | null>(null);
  const [substate, setSubstate] = useState<string | null>(null);
  // 解析后的 sessions.metadata_json（不直接放原 JSON 字符串，避免消费方再次解析）。
  // 形如 { teamDefinition?: {...}, teamWorkspaceId?: string, workingDirectory?: string, ... }
  // 解析失败 / 缺失时为 null。
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, unknown> | null>(null);

  // ─── 派生 ────────────────────────────────────────────────────────
  const remoteSessionBusyState = useMemo<'running' | 'paused' | null>(() => {
    if (sessionStateStatus === 'running') return 'running';
    if (sessionStateStatus === 'paused') return 'paused';
    return null;
  }, [sessionStateStatus]);

  const visibleStreaming = useMemo(() => {
    return streaming || streamingSegments.length > 0 || streamBuffer.length > 0;
  }, [streaming, streamingSegments.length, streamBuffer.length]);

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
    if (!sessionId || !token || !enabled) {
      setMessages([]);
      setSessionStateStatus(null);
      setIsSessionSnapshotReady(false);
      setPendingPermissions([]);
      setPendingQuestions([]);
      setRoleLayer(null);
      setSubstate(null);
      setSessionMetadata(null);
      return;
    }

    setIsSessionLoading(true);
    try {
      const sessionsClient = createSessionsClient(gatewayUrl);
      const recovery = await sessionsClient.getRecovery(token, sessionId);

      const normalized = normalizeChatMessages(recovery.session?.messages ?? []);
      setMessages(normalized);
      setLatestUpstreamSummary(
        extractLatestUpstreamSummaryFromRunEvents(recovery.session?.runEvents),
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
    } catch {
      // 加载失败时保持空白；外层 chrome 可显示错误
      setIsSessionSnapshotReady(false);
    } finally {
      setIsSessionLoading(false);
    }
  }, [sessionId, gatewayUrl, token, enabled]);

  // ─── 当 sessionId 变化时自动 reload ─────────────────────────────
  useEffect(() => {
    void reload();
  }, [reload]);

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

  // ─── inbound writer（v0.2 新增，L1.3 反向通道）──────────────────
  const submitInbound = useCallback<SessionConversationState['submitInbound']>(
    async (messageType, payload, opts) => {
      if (!sessionId) {
        throw new Error('当前会话不存在，无法提交团队消息。');
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

  const startStream: SessionConversationState['startStream'] = useCallback(
    async (text, opts) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法发送消息。');
      }
      if (!sessionId || !token) {
        throw new Error('当前会话或登录状态无效，无法开始对话。');
      }
      if (streamingRef.current) {
        // already streaming; reject silently
        return;
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
        dialogueMode,
        displayMessage: opts?.displayMessage,
        ...(opts?.inputParts ? { inputParts: opts.inputParts } : {}),
        model: activeModelId || 'default',
        providerId: activeProviderId || undefined,
        thinkingEnabled,
        reasoningEffort,
        webSearchEnabled,
        yoloMode,
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
      dialogueMode,
      thinkingEnabled,
      reasoningEffort,
      webSearchEnabled,
      yoloMode,
      effectiveAgentId,
      providers,
      gatewayClient,
      stream,
      streamingRef,
      currentAssistantStreamMessageIdRef,
    ],
  );

  const stopStream: SessionConversationState['stopStream'] = useCallback(async () => {
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

  const replyPermission: SessionConversationState['replyPermission'] = useCallback(
    async (requestId, decision, feedback) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法处理权限请求。');
      }
      if (!sessionId || !token) {
        throw new Error('当前会话或登录状态无效，无法处理权限请求。');
      }
      await replyPermissionRequest({
        gatewayUrl,
        requestId,
        decision,
        ...(feedback ? { feedback } : {}),
        sessionId,
        token,
      });
      if (decision !== 'reject') {
        setSessionStateStatus('running');
        void reload();
      }
      // Optimistically remove from pending list; the permission_replied event
      // will also clear on receipt.
      setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [enableWriters, sessionId, token, gatewayUrl, reload],
  );

  const replyQuestion: SessionConversationState['replyQuestion'] = useCallback(
    async (requestId, status, answers) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法处理提问请求。');
      }
      if (!sessionId || !token) {
        throw new Error('当前会话或登录状态无效，无法处理提问请求。');
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

  const loadProviders: SessionConversationState['loadProviders'] = useCallback(async () => {
    if (!token) return;
    try {
      const result = await loadSavedChatSessionDefaults(gatewayUrl, token);
      setProviders(result.providers);
      if (!activeProviderId && result.defaults.providerId) {
        setActiveProviderId(result.defaults.providerId);
      }
      if (!activeModelId && result.defaults.modelId) {
        setActiveModelId(result.defaults.modelId);
      }
      if (defaults?.thinkingEnabled === undefined) {
        setThinkingEnabled(result.defaults.thinkingEnabled);
      }
      if (defaults?.reasoningEffort === undefined) {
        setReasoningEffort(result.defaults.reasoningEffort);
      }
    } catch {
      // best-effort; surface no error
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, token]);

  // ─── auto-load providers on mount when writers enabled ────────────
  const providersLoadedRef = useRef(false);
  useEffect(() => {
    if (!enableWriters || providersLoadedRef.current) return;
    if (!token) return;
    providersLoadedRef.current = true;
    void loadProviders();
  }, [enableWriters, token, loadProviders]);

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
    latestUpstreamSummary,

    input,
    setInput,
    textareaRef,

    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    dialogueMode,
    setDialogueMode,
    manualAgentId,
    setManualAgentId,
    yoloMode,
    setYoloMode,
    webSearchEnabled,
    setWebSearchEnabled,
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
    roleLayer,
    substate,
    sessionMetadata,

    remoteSessionBusyState,
    visibleStreaming,

    reload,
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
