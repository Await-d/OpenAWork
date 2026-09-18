import type { InputImageContent, RunEvent } from '@openAwork/shared';
import type {
  InboundMessageType,
  InboundPayloadByType,
  InboundSubmitResponse,
  PendingPermissionRequest,
  PendingQuestionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import type {
  ChatMessage,
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';

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
  /**
   * 过程时间线（run events）的 setter。回退回合后消费方需要显式清空它——
   * 该状态下 startStream 路径不会 reload，只读的 runEvents 会让旧回合的过程
   * 时间线滞留在界面上。
   */
  setRunEvents: React.Dispatch<React.SetStateAction<RunEvent[]>>;

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
  /** 是否正在加载更早消息（滚动到顶部触发时按钮显示加载中）。 */
  isLoadingEarlier: boolean;

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
