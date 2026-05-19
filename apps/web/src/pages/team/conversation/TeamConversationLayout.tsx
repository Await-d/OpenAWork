/**
 * SessionConversationView · Phase 1 §1.2
 *
 * 单 session 对话布局的复用组件——把 ChatPage 中"通用对话布局"部分抽离出来，
 * 让 chat 与 team 都能基于 sessionId 渲染同一份消息流 + composer + 流式渲染。
 *
 * 关联文档：`docs/chat-conversation-reuse-plan.md` Phase 1 §1.2
 *
 * **当前阶段（Step 4a 骨架）**：本组件以 props 接收外层提供的 state/handler，
 * 不重新发明任何 hook。等 chat / team 两端都接入后，再把 ChatPage 的
 * "对话布局"hook setup（约 25 个 useState + 相关 useEffect）搬到本组件内部
 * （未来 Step 4d）。
 *
 * 设计原则（按方案文档 §0）：
 * 1. **slot 注入**：chat-only chrome（ChatTopBar / SubAgentRunList /
 *    CompanionStage / ChatImageGenerationResultStrip / MultiSelectToolbar 等）
 *    通过 topBar / beforeMessages / afterMessages slot 注入，本组件不感知。
 * 2. **composer 能力开关**：通过 composerExtras 控制 imageGen / skillRec 等
 *    chat-only 能力的显隐；team 默认全关。
 * 3. **composer disable**：通过 composerDisabled 让 team Phase 2a 期间
 *    composer 默认 disabled。
 * 4. **session 来源标识**：sessionSource 标识来自 chat 还是 team，仅用于
 *    可观测性 / 埋点；不参与业务分支（team 接入应由父级控制 props）。
 */

import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { CommandDescriptor } from '@openAwork/shared';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import { ChatMessageGroupList } from '../../../components/chat/message/chat-message-group-list.js';
import type { ChatRenderEntry, ChatRenderGroup } from '../../../components/chat/message/chat-message-group-list.js';
import { ChatRemoteStreamPlaceholder } from '../../../components/chat/session/chat-remote-stream-placeholder.js';
import { ChatSearchOverlay } from '../../../components/chat/search/chat-search-overlay.js';
import type { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import { ChatSessionSkeleton } from '../../../components/chat/session/chat-session-skeleton.js';
import { InlineQuestionPanel } from '../../../components/chat/misc/InlineQuestionPanel.js';
import { UnifiedComposer } from '../../../components/chat/composer/UnifiedComposer.js';
import type {
  UnifiedComposerFeatures,
  UnifiedComposerSubmitPayload,
} from '../../../components/chat/composer/UnifiedComposer.js';
import { WelcomeScreen } from '../../../components/chat/session/ChatPageSections.js';
import type { DialogueMode } from '../../chat-page/mode/dialogue-mode.js';
import type { ComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import type {
  ChatSettingsProvider,
  SavedChatImageDefaults,
} from '../../../utils/chat/chat-session-defaults.js';
import {
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
} from '../../../components/conversation-runtime/scroll/scroll-constants.js';
import type { ChatImageGenerationReferenceArtifact } from '../../../components/chat/image/ChatImageGenerationControls.js';
import HistoryEditDialog from '../../chat-page/conversation/views/history-edit-dialog.js';
import RetryModeDialog from '../../chat-page/conversation/views/retry-mode-dialog.js';
import { ChatScrollBottomButton } from '../../../components/conversation-runtime/views/scroll-bottom-button.js';
import { ChatStreamErrorBar } from '../../../components/conversation-runtime/views/stream-error-bar.js';
// ChatTodoFloatingPanel 现在由 ChatTopBar 内部挂载（顶部右侧），本组件不再渲染浮层；
// 仅保留与 todo 相关的最小 props（sessionTodos / rightOpen），用于消息列展示。
import { SessionRunStateBar } from '../../../components/conversation-runtime/views/session-run-state-bar.js';
import type { SessionStateStatus, SessionTodoItem } from '../../../components/conversation-runtime/session/session-runtime.js';
import type {
  ChatMessage,
  ComposerMenuState,
  ReasoningEffort,
  WorkspaceFileMentionItem,
} from '../../../components/conversation-runtime/messages/support.js';
import type { ImageEditReferenceArtifact } from '../../chat-page/conversation/render/image-edit-reference-artifacts.js';

// ─── Props 类型定义 ────────────────────────────────────────────────────────

/** session 来源标识。仅用于埋点 / 调试，不参与业务分支。 */
export type SessionConversationSource = 'chat' | 'team';

/** chat-only composer 能力开关。team 应默认全关。 */
export interface ConversationComposerExtras {
  imageGeneration?: boolean;
  skillRecommendation?: boolean;
  multiSelect?: boolean;
  bookmarks?: boolean;
  promptTemplate?: boolean;
  commandPalette?: boolean;
  dialogueModeToggle?: boolean;
  yoloMode?: boolean;
  agentSwitch?: boolean;
}

/** 历史编辑提示。chat 用 truncate 重发，team 暂不支持（Phase 2a 只读模式）。 */
export interface HistoryEditPromptInput {
  text: string;
  messageId: string;
  inputParts?: unknown[];
}

/** 重试提示。 */
export interface RetryPromptInput {
  text: string;
}

/**
 * SessionConversationView 完整 props。
 *
 * 字段分组（**严格保持顺序便于 review**）：
 * - 必填基础（sessionId、currentUserEmail、gatewayUrl、token）
 * - chrome slots（topBar / beforeMessages / afterMessages）
 * - composer 能力开关
 * - 消息列表 props（messages、render entries、pendingPermissions 等）
 * - 流式状态 props（streaming、stoppingStream、streamError 等）
 * - 滚动 / 加载 props
 * - composer props（继承自 UnifiedComposer）
 * - 对话框 props（HistoryEditDialog / RetryModeDialog）
 * - 业务回调
 */
export interface TeamConversationLayoutProps {
  // ─── 基础 ────────────────────────────────────────────────────────────
  sessionId: string | null;
  sessionSource: SessionConversationSource;
  currentUserEmail: string;
  gatewayUrl: string;
  token: string | null;

  // ─── chrome slots ───────────────────────────────────────────────────
  topBar?: ReactNode;
  beforeMessages?: ReactNode;
  afterMessages?: ReactNode;

  // ─── composer 能力开关 + disable ────────────────────────────────────
  composerDisabled?: boolean;
  composerExtras?: ConversationComposerExtras;
  composerDisabledHint?: string;

  // ─── 消息列表 ───────────────────────────────────────────────────────
  messages: ChatMessage[];
  groupedMessageEntries: ChatRenderGroup[];
  visibleMessageCount: number;
  hiddenMessageCount: number;
  visibleStreaming: boolean;
  showSessionSwitchSkeleton: boolean;
  remoteSessionBusyState: 'running' | 'paused' | null;
  pendingPermissions: PendingPermissionRequest[];
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
      }
    | undefined;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  activeProviderId: string;
  activeModelId: string;
  activeModelLabel?: string;
  onLoadEarlier: () => void;
  /**
   * 初始无消息时显示的 WelcomeScreen 行为（chat 用，team 不传 = 不显示）。
   */
  welcomeScreen?: {
    hasWorkspace: boolean;
    dialogueMode: DialogueMode;
    onNewSession: () => void;
    onOpenWorkspace: () => void;
    onSelectMode: (mode: DialogueMode) => void;
  };
  /**
   * 当 messages 为空、未在 streaming、且 remoteSessionBusyState 为 null 时
   * 显示的空状态内容。chat 端可不传（继续使用 WelcomeScreen），team 端用此
   * slot 注入自己的空态（如"会话尚未开始 / 等待 b 派发任务"等引导）。
   */
  emptyContent?: ReactNode;

  // ─── 流式状态 ───────────────────────────────────────────────────────
  streaming: boolean;
  stoppingStream: boolean;
  streamError: string | null;
  onDismissStreamError: () => void;
  /** SessionRunStateBar 字段。 */
  checkpointCount: number;
  pendingQuestionsCount: number;
  stopCapability: 'none' | 'precise' | 'best_effort' | 'observe_only';
  onOpenRecovery: () => void;

  // ─── 滚动 ──────────────────────────────────────────────────────────
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  contentColumnRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  showScrollToBottom: boolean;
  hasPendingFollowContent: boolean;
  onScrollToBottom: (behavior: 'smooth' | 'auto', target: 'latest-edge' | 'center') => void;
  /** 编辑器分屏打开时调整 padding。 */
  editorMode: boolean;
  /** 紧凑模式（team 嵌入时用）：减少顶部/侧边 padding，充分利用空间。 */
  compact?: boolean;

  // ─── todo bar ───────────────────────────────────────────────────────
  sessionTodos: SessionTodoItem[];
  rightOpen: boolean;

  // ─── 行内 question / 历史编辑 / retry ───────────────────────────────
  activePendingQuestion?: PendingQuestionRequest | null;
  inlineQuestionAnswers: string[][];
  inlineQuestionCustomInputs: string[];
  inlineQuestionReplyStatus: 'answered' | 'dismissed' | null;
  inlineQuestionReplyError: string | null;
  onToggleInlineQuestionOption: (
    questionIndex: number,
    optionLabel: string,
    multiple: boolean,
  ) => void;
  onChangeInlineQuestionCustomInput: (questionIndex: number, value: string) => void;
  onReplyInlineQuestion: (status: 'answered' | 'dismissed') => Promise<void> | void;

  historyEditPrompt: HistoryEditPromptInput | null;
  onCloseHistoryEdit: () => void;
  onResendHistoryEdit: (text: string, inputParts?: unknown[]) => void;
  onContinueHistoryEdit: (text: string, inputParts?: unknown[]) => void;
  onCreateBranchFromHistoryEdit: (text: string, inputParts?: unknown[]) => void;

  retryPrompt: RetryPromptInput | null;
  onCloseRetry: () => void;
  onRetryCurrent: () => void;
  onRetryBranch: () => void;

  // ─── search overlay ────────────────────────────────────────────────
  chatSearch: ReturnType<typeof useChatSearch>;

  // ─── composer ──────────────────────────────────────────────────────
  composerVariant: 'home' | 'session';
  providers: ChatSettingsProvider[];
  activeProvider?: { name?: string; type?: string } | null;
  activeModelOption?: {
    id?: string;
    label?: string;
    supportsThinking?: boolean;
    supportsTools?: boolean;
    supportsVision?: boolean;
    contextWindow?: number;
  } | null;
  activeModelCanConfigureThinking?: boolean;
  activeModelTooltip?: string;
  canStopCurrentSessionStream: boolean;
  dialogueMode: DialogueMode;
  manualAgentId: string;
  yoloMode: boolean;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  imageReferenceArtifacts?: ChatImageGenerationReferenceArtifact[];
  selectedImageEditReferenceArtifactId: string | null;
  latestGeneratedImageResult?: {
    artifactId: string;
    artifactTitle: string;
    modelLabel: string;
  } | null;
  artifactsWorkspaceHref?: string | null;
  imageGenerationMode?: boolean;
  hasConfiguredImageModel?: boolean;
  imageGenerationBusy?: boolean;
  imageGenerationDefaults?: SavedChatImageDefaults;
  imageModelLabel?: string;
  imagePluginEnabled?: boolean;
  toggleImageGenerationMode?: () => void;
  updateImageGenerationDefaults?: (defaults: Partial<SavedChatImageDefaults>) => void;
  composerWorkspaceCatalog?: ComposerWorkspaceCatalog;
  composerCommandDescriptors?: CommandDescriptor[];
  agentOptions?: Array<{ id: string; label: string }>;
  effectiveAgentId?: string;
  defaultAgentLabel?: string;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onComposerSubmit: (payload: UnifiedComposerSubmitPayload) => Promise<void> | void;
  onStopComposer: () => void | Promise<void>;
  onComposerModelSelect?: (providerId: string, modelId: string) => Promise<void>;
  onToggleWebSearch: () => void;
  onThinkingEnabledChange: (enabled: boolean) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onManualAgentChange: (agentId: string) => void;
  onClearManualAgentId: () => void;
  onContinueEditingImage?: () => void;
  onNavigateToArtifacts?: () => void;
  onSelectImageReferenceArtifactId?: (id: string | null) => void;
  markSessionMetadataDirty?: () => void;
  /** Context window usage to render inline next to the send button. */
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextIsEstimated?: boolean;
  /**
   * 自定义 composer textarea placeholder。team 接待会话用此覆盖默认占位，
   * 与 D26（b 直答 vs 走 c 路由）的语义对齐——告诉用户"输入需求会被派发给团队"。
   */
  composerPlaceholder?: string;
  /**
   * Optional slot rendered on the right side of the composer's bottom
   * toolbar (alongside the send button). Forwarded straight to
   * UnifiedComposer.composerRightSlot.
   */
  composerRightSlot?: ReactNode;
}

// ─── 内部样式常量（提到顶层避免每次渲染创建新对象）────────────────────────

const SPLIT_INNER_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
};

const CONVERSATION_STREAM_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  position: 'relative',
  transition: 'none',
};

const SKELETON_BOTTOM_SPACER_STYLE: CSSProperties = {
  height: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  flexShrink: 0,
};

const EMPTY_BOTTOM_REF_STYLE: CSSProperties = { flexShrink: 0 };

const LOAD_EARLIER_BTN_STYLE: CSSProperties = {
  alignSelf: 'center',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '0 14px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  marginBottom: 4,
  flexShrink: 0,
};

// ─── 默认 features 计算（基于 composerExtras 推导）─────────────────────────

function buildComposerFeatures(
  extras: ConversationComposerExtras | undefined,
): UnifiedComposerFeatures {
  const ex = extras ?? {};
  return {
    attachments: true, // 附件是基础能力，不通过 extras 控制
    voice: false,
    modelPicker: true,
    modelSettings: true,
    webSearch: true,
    imageGen: ex.imageGeneration ?? false,
    promptOptimize: true,
    slashCommands: true,
    mentions: true,
    agentSwitch: ex.agentSwitch ?? false,
    queuedMessages: true,
  };
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function TeamConversationLayout(props: TeamConversationLayoutProps): React.ReactElement {
  const {
    sessionId,
    currentUserEmail,
    gatewayUrl,
    token,

    topBar,
    beforeMessages,
    afterMessages,

    composerDisabled,
    composerExtras,
    composerDisabledHint,

    messages,
    groupedMessageEntries,
    visibleMessageCount: _visibleMessageCount,
    hiddenMessageCount,
    visibleStreaming,
    showSessionSwitchSkeleton,
    remoteSessionBusyState,
    pendingPermissions,
    resolveInlinePermissionActions,
    providerCatalog,
    activeProviderId,
    activeModelId,
    activeModelLabel,
    onLoadEarlier,
    welcomeScreen,
    emptyContent,

    streaming,
    stoppingStream,
    streamError,
    onDismissStreamError,
    checkpointCount,
    pendingQuestionsCount,
    stopCapability,
    onOpenRecovery,

    scrollRegionRef,
    contentColumnRef,
    bottomRef,
    onScroll,
    showScrollToBottom,
    hasPendingFollowContent,
    onScrollToBottom,
    editorMode,
    compact,

    sessionTodos,
    rightOpen,

    activePendingQuestion,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyStatus,
    inlineQuestionReplyError,
    onToggleInlineQuestionOption,
    onChangeInlineQuestionCustomInput,
    onReplyInlineQuestion,

    historyEditPrompt,
    onCloseHistoryEdit,
    onResendHistoryEdit,
    onContinueHistoryEdit,
    onCreateBranchFromHistoryEdit,

    retryPrompt,
    onCloseRetry,
    onRetryCurrent,
    onRetryBranch,

    chatSearch,

    composerVariant,
    providers,
    activeProvider,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    canStopCurrentSessionStream,
    dialogueMode,
    manualAgentId,
    yoloMode,
    webSearchEnabled,
    thinkingEnabled,
    reasoningEffort,
    imageReferenceArtifacts,
    selectedImageEditReferenceArtifactId,
    latestGeneratedImageResult,
    artifactsWorkspaceHref,
    imageGenerationMode,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationDefaults,
    imageModelLabel,
    imagePluginEnabled,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
    composerWorkspaceCatalog,
    composerCommandDescriptors,
    agentOptions,
    effectiveAgentId,
    defaultAgentLabel,
    input,
    setInput,
    textareaRef,
    onComposerSubmit,
    onStopComposer,
    onComposerModelSelect,
    onToggleWebSearch,
    onThinkingEnabledChange,
    onReasoningEffortChange,
    onManualAgentChange,
    onClearManualAgentId,
    onContinueEditingImage,
    onNavigateToArtifacts,
    onSelectImageReferenceArtifactId,
    markSessionMetadataDirty,
    contextUsedTokens,
    contextMaxTokens,
    contextIsEstimated,
    composerPlaceholder,
    composerRightSlot,
  } = props;

  const composerFeatures = buildComposerFeatures(composerExtras);

  const showWelcome =
    welcomeScreen !== undefined &&
    !showSessionSwitchSkeleton &&
    messages.length === 0 &&
    !visibleStreaming &&
    !remoteSessionBusyState;

  const scrollPadding = compact
    ? `0.5rem clamp(12px, 2vw, 20px) ${CHAT_SCROLL_BOTTOM_PADDING}`
    : editorMode
      ? `1rem clamp(20px, 4vw, 44px) ${CHAT_SCROLL_BOTTOM_PADDING}`
      : `0.9rem clamp(10px, 3vw, 32px) ${CHAT_SCROLL_BOTTOM_PADDING}`;

  const scrollRegionStyle: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: scrollPadding,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    scrollPaddingBottom: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  };

  const contentColumnStyle: CSSProperties = {
    width: '100%',
    maxWidth: compact ? '100%' : editorMode ? 680 : 768,
    margin: compact ? 0 : '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: compact ? '1rem' : '1.5rem',
    minHeight: '100%',
  };

  // 待办 controller 与浮层都由 ChatTopBar 一侧挂载（顶部右侧 popover）；本组件不再
  // 渲染浮层。chat-todo-composer-anchor 已移除。

  return (
    <>
      {topBar}

      <HistoryEditDialog
        open={historyEditPrompt !== null}
        initialText={historyEditPrompt?.text ?? ''}
        inputParts={historyEditPrompt?.inputParts as never}
        onClose={onCloseHistoryEdit}
        onResendCurrent={(text, editedInputParts) => {
          onResendHistoryEdit(text, editedInputParts);
        }}
        onContinueCurrent={(text, editedInputParts) => {
          onContinueHistoryEdit(text, editedInputParts);
        }}
        onCreateBranch={(text, editedInputParts) => {
          onCreateBranchFromHistoryEdit(text, editedInputParts);
        }}
      />

      <RetryModeDialog
        open={retryPrompt !== null}
        messagePreview={retryPrompt?.text ?? ''}
        onClose={onCloseRetry}
        onRetryCurrent={onRetryCurrent}
        onRetryBranch={onRetryBranch}
      />

      <div style={SPLIT_INNER_STYLE}>
        {beforeMessages}
        <div style={CONVERSATION_STREAM_STYLE}>
          <ChatSearchOverlay controller={chatSearch} />
          <div
            ref={scrollRegionRef}
            onScroll={onScroll}
            data-testid="chat-scroll-region"
            style={scrollRegionStyle}
          >
            <div
              ref={contentColumnRef}
              data-testid="chat-content-column"
              style={contentColumnStyle}
            >
              {showSessionSwitchSkeleton ? <ChatSessionSkeleton /> : null}
              {showWelcome && welcomeScreen ? (
                <WelcomeScreen
                  hasWorkspace={welcomeScreen.hasWorkspace}
                  dialogueMode={welcomeScreen.dialogueMode}
                  onNewSession={welcomeScreen.onNewSession}
                  onOpenWorkspace={welcomeScreen.onOpenWorkspace}
                  onSelectMode={welcomeScreen.onSelectMode}
                />
              ) : null}
              {showSessionSwitchSkeleton ? (
                <div ref={bottomRef} style={SKELETON_BOTTOM_SPACER_STYLE} />
              ) : messages.length > 0 || visibleStreaming || remoteSessionBusyState ? (
                <>
                  {hiddenMessageCount > 0 && (
                    <button
                      type="button"
                      data-testid="chat-load-earlier"
                      onClick={onLoadEarlier}
                      style={LOAD_EARLIER_BTN_STYLE}
                    >
                      <svg
                        aria-hidden="true"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 19V5" />
                        <path d="m5 12 7-7 7 7" />
                      </svg>
                      加载更早的 {Math.min(hiddenMessageCount, 20)} 条消息（共 {hiddenMessageCount}{' '}
                      条隐藏）
                    </button>
                  )}
                  <ChatMessageGroupList
                    activeModelId={activeModelId}
                    activeModelLabel={activeModelLabel}
                    activeProviderId={activeProviderId}
                    bottomRef={bottomRef}
                    currentUserEmail={currentUserEmail}
                    groups={groupedMessageEntries}
                    pendingPermissions={pendingPermissions}
                    providerCatalog={providerCatalog}
                    resolveInlinePermissionActions={resolveInlinePermissionActions}
                    scrollRegionRef={scrollRegionRef}
                  />
                  {!visibleStreaming && remoteSessionBusyState ? (
                    <ChatRemoteStreamPlaceholder status={remoteSessionBusyState} />
                  ) : null}
                </>
              ) : (
                <>
                  {emptyContent ?? null}
                  <div ref={bottomRef} style={EMPTY_BOTTOM_REF_STYLE} />
                </>
              )}
            </div>
          </div>

          {showScrollToBottom && (
            <ChatScrollBottomButton
              streaming={streaming}
              hasPendingFollowContent={hasPendingFollowContent}
              onScrollToBottom={() => onScrollToBottom('smooth', 'latest-edge')}
            />
          )}
        </div>
      </div>

      <ChatStreamErrorBar streamError={streamError} onDismiss={onDismissStreamError} />

      {remoteSessionBusyState && (
        <SessionRunStateBar
          checkpointCount={checkpointCount}
          onOpenRecovery={onOpenRecovery}
          pendingPermissionsCount={pendingPermissions.length}
          pendingQuestionsCount={pendingQuestionsCount}
          status={remoteSessionBusyState}
          stopCapability={stopCapability}
        />
      )}

      {afterMessages}

      {activePendingQuestion && (
        <InlineQuestionPanel
          answers={inlineQuestionAnswers}
          customInputs={inlineQuestionCustomInputs}
          editorMode={editorMode}
          errorMessage={inlineQuestionReplyError ?? undefined}
          pendingAction={inlineQuestionReplyStatus}
          request={activePendingQuestion}
          onDismiss={() => void onReplyInlineQuestion('dismissed')}
          onSubmit={() => void onReplyInlineQuestion('answered')}
          onToggleOption={onToggleInlineQuestionOption}
          onCustomInputChange={onChangeInlineQuestionCustomInput}
        />
      )}

      {composerDisabled ? (
        composerDisabledHint ? (
          <div
            role="note"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px 16px',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--fg-default)',
              background:
                'color-mix(in srgb, var(--accent) 6%, color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base)))',
              borderTop: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
              flexShrink: 0,
            }}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, color: 'var(--accent)' }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{composerDisabledHint}</span>
          </div>
        ) : null
      ) : (
        <UnifiedComposer
          variant={composerVariant}
          sessionId={sessionId}
          currentUserEmail={currentUserEmail}
          gatewayUrl={gatewayUrl}
          token={token}
          streaming={streaming}
          stoppingStream={stoppingStream}
          canStopSession={canStopCurrentSessionStream}
          stopCapability={stopCapability}
          sessionBusyState={remoteSessionBusyState}
          editorMode={editorMode}
          providers={providers}
          activeProviderId={activeProviderId}
          activeModelId={activeModelId}
          activeProvider={activeProvider}
          activeModelOption={activeModelOption}
          activeModelCanConfigureThinking={activeModelCanConfigureThinking}
          activeModelTooltip={activeModelTooltip}
          dialogueMode={dialogueMode}
          manualAgentId={manualAgentId}
          yoloMode={yoloMode}
          webSearchEnabled={webSearchEnabled}
          thinkingEnabled={thinkingEnabled}
          reasoningEffort={reasoningEffort}
          imageReferenceArtifacts={imageReferenceArtifacts}
          selectedImageReferenceArtifactId={selectedImageEditReferenceArtifactId}
          latestGeneratedImageResult={latestGeneratedImageResult}
          artifactsWorkspaceHref={artifactsWorkspaceHref}
          imageGenerationMode={imageGenerationMode}
          hasConfiguredImageModel={hasConfiguredImageModel}
          imageGenerationBusy={imageGenerationBusy}
          imageGenerationDefaults={imageGenerationDefaults}
          imageModelLabel={imageModelLabel}
          imagePluginEnabled={imagePluginEnabled}
          toggleImageGenerationMode={toggleImageGenerationMode}
          updateImageGenerationDefaults={updateImageGenerationDefaults}
          composerWorkspaceCatalog={composerWorkspaceCatalog}
          composerCommandDescriptors={composerCommandDescriptors}
          agentOptions={agentOptions}
          effectiveAgentId={effectiveAgentId}
          defaultAgentLabel={defaultAgentLabel}
          input={input}
          setInput={setInput}
          textareaRef={textareaRef}
          features={composerFeatures}
          onSubmit={composerDisabled ? () => undefined : onComposerSubmit}
          onStop={onStopComposer}
          onModelSelect={onComposerModelSelect}
          onToggleWebSearch={onToggleWebSearch}
          onThinkingEnabledChange={onThinkingEnabledChange}
          onReasoningEffortChange={onReasoningEffortChange}
          onManualAgentChange={onManualAgentChange}
          onClearManualAgentId={onClearManualAgentId}
          onContinueEditingImage={onContinueEditingImage}
          onNavigateToArtifacts={onNavigateToArtifacts}
          onSelectImageReferenceArtifactId={onSelectImageReferenceArtifactId}
          markSessionMetadataDirty={markSessionMetadataDirty}
          contextUsedTokens={contextUsedTokens}
          contextMaxTokens={contextMaxTokens}
          contextIsEstimated={contextIsEstimated}
          placeholder={composerPlaceholder}
          composerRightSlot={composerRightSlot}
        />
      )}
    </>
  );
}

// ─── 子类型再导出（方便消费方）────────────────────────────────────────────

export type { ChatRenderEntry, ChatRenderGroup };
export type { UnifiedComposerSubmitPayload };
