/**
 * TeamConversationView · team 端单 session 对话视图入口
 *
 * 这是 team 端的对话装配「上层」组件：
 *   ① 调 `useTeamConversationState` 拿到流式 / 滚动 / Q/P / inbound 等所需 state
 *   ② 加上 team 专属适配：roleLayer/substate 提交路由、TeamSessionHeader 注入、
 *      TeamSubstateProgressBar 默认 topBar、starter chip → 填 composer 等
 *   ③ 把适配后的 props 喂给 `<TeamConversationLayout/>`（哑视图层，
 *      原型来自 ChatConversationView 的副本）
 *
 * 与 chat 端 `<ChatConversationView/>` 是平级关系，**互不引用、互不影响**。
 *
 * **演化历史**：从 `pages/team/runtime/shell/session-view/TeamSessionView.tsx`
 * 改造而来，迁入到 `pages/team/conversation/`，并：
 * - 把 `useChatConversationState` 换成 `useTeamConversationState`
 * - 把 `resolveSubmitStrategy` 抽到 `submit/team-submit-router.ts`
 * - 把 chat-only 的 dialogueMode/yoloMode/webSearchEnabled/manualAgentId
 *   留在 layout 适配层，team 自己管理 provider/model/thinking
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
 * - `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import { LatestAssistantMessageContext } from '../../../components/chat/message/collapsible-assistant-content.js';
import type { ChatRenderGroup } from '../../../components/chat/message/chat-message-group-list.js';
import type { UnifiedComposerSubmitPayload } from '../../../components/chat/composer/UnifiedComposer.js';
import type { MentionFileSearchFn } from '../../../components/chat/composer/use-mention-file-search.js';
import { prepareStandardChatSendInput } from '../../chat-page/conversation/composer/prepare-standard-chat-send-input.js';
import type { InputImageContent } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useCurrentUserDisplayName } from '../../../stores/user-profile/current-user-profile.js';
import { useComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useMessageMultiSelect } from '../../../components/chat/message/message-multi-select.js';
import { PromptTemplatePanel } from '../../../components/chat/misc/prompt-template-panel.js';
import { TeamConversationLayout } from './TeamConversationLayout.js';
import { TeamSessionEmptyState } from './extras/TeamSessionEmptyState.js';
import { TeamSessionHeader } from './extras/TeamSessionHeader.js';
import { TeamUserJumpRail } from './extras/TeamUserJumpRail.js';
import { TeamRoleTypingIndicator } from './extras/TeamRoleTypingIndicator.js';
import { TeamInitModal } from './extras/TeamInitModal.js';
import { TeamRunEventsPreview } from './extras/TeamRunEventsPreview.js';
import type { LayerMessages } from './extras/team-layer-messages.js';
import type { MultiLayerViewMode, ViewMode } from './extras/TeamViewModeToggle.js';
import { TeamConversationLayerSidePanel } from './TeamConversationLayerSidePanel.js';
import { useTeamConversationState } from './use-team-conversation-state.js';
import { buildTeamGroupedMessageEntries } from './build-team-grouped-message-entries.js';
import { useTeamRuntimeReferenceViewData } from '../runtime/data/team-runtime-reference-data.js';
import {
  useClarificationStore,
  useHandoffStore,
  useLayerStore,
} from '../../../stores/team/team-events.js';
import {
  createTeamMentionFileSearch,
  readTeamMentionWorkspaceDirectory,
} from './team-mention-file-search.js';
import {
  TEAM_CONVERSATION_COMPOSER_EXTRAS,
  useTeamConversationViewComposerDispatch,
  useTeamConversationViewEntryActions,
  useTeamConversationViewRetryActions,
} from './team-conversation-view-composer-actions.js';
import {
  buildTeamActiveModelTooltip,
  buildTeamProviderCatalog,
  countTeamUserMessages,
  disabledComposerAction,
  disabledComposerAsyncAction,
  disabledComposerSubmitAction,
  findTeamActiveModelOption,
  findTeamActiveProvider,
  findTeamLatestFinalizedAssistantId,
  resolveTeamActiveModelCanConfigureThinking,
  resolveTeamComposerPlaceholder,
  resolveTeamConversationMainPanelStyle,
  TEAM_CONVERSATION_DUAL_LAYOUT_STYLE,
  TEAM_CONVERSATION_SOLO_LAYOUT_STYLE,
  TEAM_CONVERSATION_SOLO_MAIN_PANEL_STYLE,
} from './team-conversation-view-helpers.js';
import {
  useTeamConversationViewComposerBridge,
  useTeamConversationViewInteractions,
} from './team-conversation-view-host-interactions.js';
import { useTeamConversationViewInlineInteractions } from './team-conversation-view-inline-interactions.js';
import {
  buildTeamConversationMultiLayerMessages,
  hasTeamConversationLayerMessages,
  resolveTeamDefaultDetailLayer,
} from './team-conversation-view-multi-layer.js';
import { TeamConversationViewTopBar } from './team-conversation-view-top-bar.js';

export interface TeamConversationViewProps {
  /** 要渲染的 team session id。 */
  sessionId: string;
  /**
   * 顶部 slot。默认渲染 `<TeamSubstateProgressBar/>`（基于 hook 暴露的
   * roleLayer/substate/stateStatus）。外层可传 ReactNode 覆盖默认行为。
   */
  topBar?: ReactNode;
  /** 消息列表前 slot（如 team 任务流缩略）。 */
  beforeMessages?: ReactNode;
  /** 消息列表后 slot（如 push 消息条）。 */
  afterMessages?: ReactNode;
  /**
   * 是否启用 composer 输入。
   * - **默认 false**（兼容只读模式 / 从 LayerConversationDrawer 等位置嵌入时）
   * - **true**：composer 启用。提交时按 (roleLayer, substate) 自动选择
   *   `stream` 或 `inbound` 写入路径（D5 决策）。
   */
  composerEnabled?: boolean;
  /** 当 composer disabled 时显示的提示文字。 */
  composerDisabledHint?: string;
  /**
   * 自定义 composer 启用态的 textarea placeholder。
   * 不传时按 roleLayer/substate 回落到 team 风格的引导文案。
   */
  composerPlaceholder?: string;
  /**
   * 紧凑模式：减少 padding、内容撑满宽度。
   * 用于 LayerConversationDrawer 等空间受限的嵌入场景。
   */
  compact?: boolean;
  /** 外部希望普通多层历史面板优先展示的团队层级。 */
  focusedLayer?: string | null;
  /**
   * 嵌入只读模式：禁用浮动交互元素（JumpRail、SessionHeader、RunEventsPreview、
   * InitModal）、消息 hover actions，仅保留对话内容的滚动浏览。
   * 用于 LayerFlowView 等需要纯净对话展示的嵌入场景。
   */
  readOnly?: boolean;
  /**
   * 单角色模式：只展示当前 session 自身的消息，不拉取/展示子 session
   * 的消息，也不显示群聊汇总面板。用于「历史层级」等场景中用户选中
   * 某个具体角色实例后只看该角色的对话，而非混合所有子角色。
   */
  soloMode?: boolean;
  /**
   * classic 工作台模式：隐藏旧版 topBar（RunStateBanner / SubstateProgress /
   * ViewModeToggle / dual 多层侧栏等弃用布局），只保留对话流 + 外层注入的
   * ops chrome / inline cards。
   */
  classicWorkbench?: boolean;
  /**
   * 打开某个角色实例的完整会话。
   *
   * 由外壳注入 —— 只有外壳知道「打开」意味着什么（打开底部层级对话抽屉 /
   * 切 middle tab / 改 URL），以及该不该在当前布局下给出这个入口。
   * 视图层不猜：拿不到就不渲染入口。
   */
  onOpenSession?: (sessionId: string) => void;
}

export function TeamConversationView({
  sessionId,
  topBar,
  beforeMessages,
  afterMessages,
  composerEnabled = false,
  composerDisabledHint = '该会话正在执行中，请通过 b 与团队对话',
  composerPlaceholder,
  compact = false,
  focusedLayer = null,
  readOnly = false,
  soloMode = false,
  classicWorkbench = false,
  onOpenSession,
}: TeamConversationViewProps) {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';
  const currentUserDisplayName = useCurrentUserDisplayName();
  const { diagnostics } = useTeamRuntimeReferenceViewData();
  const layerNodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);
  // team 会话的「提问」计数唯一来源：澄清 store（可回答 pending，已被新一轮取代的不计）。
  const clarificationPendingCount = useClarificationStore((s) => s.pendingCount);

  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [multiLayerMode, setMultiLayerMode] = useState<MultiLayerViewMode>('cards');
  const [selectedLayer, setSelectedLayer] = useState<string | null>(focusedLayer);
  const [isNarrowLayout, setIsNarrowLayout] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 900,
  );
  const hasAutoOpenedMultiLayerRef = useRef(false);

  const state = useTeamConversationState({
    sessionId,
    currentUserEmail,
    gatewayUrl,
    token,
    enableWriters: composerEnabled,
  });

  // chat search overlay（共享 atom，与 chat 同一份实现）。
  const chatSearch = useChatSearch({
    messages: state.messages,
    scrollRegionRef: state.scrollRegionRef,
  });

  // Composer 工作区目录（agents / tools / skills / MCP 能力清单），只随 composer 启用拉取。
  // 注意：它不承载 @ 文件检索——@ 菜单的文件来源是下面的 searchMentionFiles。
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog({
    enabled: composerEnabled,
    gatewayUrl,
    sessionId,
    token,
  });

  // team 会话的 @ 文件检索：检索根取 session metadata 的 workingDirectory，
  // 缺失时回退为空结果（@ 菜单展示空状态，不报错）。
  const mentionWorkspaceDirectory = readTeamMentionWorkspaceDirectory(state.sessionMetadata);
  const searchMentionFiles = useMemo<MentionFileSearchFn>(
    () =>
      createTeamMentionFileSearch({
        workspaceDirectory: mentionWorkspaceDirectory,
        gatewayUrl,
        // 与 useWorkspace.searchFileIndex 同口径：未登录时按空串交给客户端。
        token: token ?? '',
      }),
    [mentionWorkspaceDirectory, gatewayUrl, token],
  );

  // Multi-select state（共享 atom）。
  const multiSelect = useMessageMultiSelect();

  // Prompt template panel state.
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const messagesRef = useRef(state.messages);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  // 会话切换时重置 UI 状态，防止上一个会话的视图模式 / 模板面板 / 多选 / 搜索
  // 等交互态残留到新会话。虽然 key={sessionId} 已确保组件重新挂载，此 effect
  // 作为防御性措施保留——以防 key 被移除或在嵌入式场景（无 key）下复用组件。
  const previousSessionIdRef = useRef(sessionId);
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }
    previousSessionIdRef.current = sessionId;
    setViewMode('single');
    setMultiLayerMode('cards');
    setSelectedLayer(focusedLayer);
    setShowTemplatePanel(false);
    hasAutoOpenedMultiLayerRef.current = false;
    multiSelect.disableMultiSelect();
    chatSearch.close();
  }, [sessionId, focusedLayer, multiSelect, chatSearch]);

  const {
    activePendingPermissionCount,
    handleFocusPendingInteraction,
    handleScrollToNextUser,
    handleScrollToPrevUser,
    handleViewModeChange,
  } = useTeamConversationViewInteractions({
    chatSearch,
    clarificationPendingCount,
    composerEnabled,
    isNarrowLayout,
    multiSelect,
    setShowTemplatePanel,
    setViewMode,
    state,
  });

  const { handleSelectStarter } = useTeamConversationViewComposerBridge({
    composerEnabled,
    messagesRef,
    setShowTemplatePanel,
    state,
  });

  // 默认 placeholder：根据 roleLayer + substate 给出更贴合团队语义的占位文案。
  // 与 D26（b 直答 vs 走 c 路由）对齐——告诉用户"输入需求会被派发给团队"。
  const effectivePlaceholder = useMemo(
    () =>
      resolveTeamComposerPlaceholder({
        composerPlaceholder,
        roleLayer: state.roleLayer,
        streaming: state.streaming,
        substate: state.substate,
      }),
    [composerPlaceholder, state.roleLayer, state.substate, state.streaming],
  );

  const { dispatchTeamText } = useTeamConversationViewComposerDispatch({ state });

  const handleComposerSubmit = useCallback(
    async (payload: UnifiedComposerSubmitPayload): Promise<boolean> => {
      if (!composerEnabled) return false;
      const text = payload.text.trim();
      // 纯附件（无文本）也允许发送：用一个占位描述让后端/LLM 知道用户发了图片。
      // 早期实现 `if (!text) return` 会静默丢弃纯图片提交，用户无任何反馈。
      const hasFiles = payload.files.length > 0;
      if (!text && !hasFiles) return false;

      // 流式进行中直接挡掉，并保留输入框内容 + 给出明确提示，避免"清空输入框→
      // startStream 静默 return→消息凭空消失"的旧行为（端到端健壮性 🔴#2）。
      if (state.streaming) {
        state.setStreamError('正在生成回复，请等待当前回复完成或点击停止后再发送。');
        return false;
      }

      // 先把 composer 附件（图片）上传并转成 inputParts，与 chat 的发送文件能力对齐。
      // #7 附件上传失败不再静默降级为"只发文本"——那样用户以为图片发出去了，实际
      // 团队根本没收到。改为：报错 + 保留输入框内容（不清空）让用户重试，由用户
      // 决定是否去掉附件再发。
      let inputParts: InputImageContent[] | undefined;
      if (payload.files.length > 0 && gatewayUrl) {
        try {
          const prepared = await prepareStandardChatSendInput({
            files: payload.files,
            gatewayUrl,
            sessionId,
            text: text || '[用户发送了附件]',
            token,
          });
          inputParts = prepared.requestInputParts;
        } catch (err) {
          const message = err instanceof Error ? err.message : '附件上传失败';
          console.warn('[TeamConversationView] attachment upload failed:', message);
          state.setStreamError(`附件上传失败，消息未发送（请重试或移除附件后重发）：${message}`);
          return false;
        }
      }

      // 只有在派发被接受后才清空输入框；若被拒绝（如竞态下流式刚开始）则保留
      // 文本，让用户可以重试，不会丢失已输入内容。
      // 纯附件时用占位文本让 startStream 不因 empty text 而 bail out。
      const effectiveText = text || (hasFiles ? '[用户发送了附件]' : '');
      const accepted = await dispatchTeamText(effectiveText, inputParts);
      if (accepted) {
        state.setInput('');
      }
      return accepted;
    },
    [composerEnabled, state, gatewayUrl, sessionId, token, dispatchTeamText],
  );

  const {
    findRetrySource,
    handleComposerModelSelect,
    handleContextWindowOverrideChange,
    handleContinueHistoryEdit,
    handleResendHistoryEdit,
    handleRetryCurrent,
    handleStopStream,
    historyEditPrompt,
    retryPrompt,
    setHistoryEditPrompt,
    setRetryPrompt,
  } = useTeamConversationViewRetryActions({
    composerEnabled,
    dispatchTeamText,
    gatewayUrl,
    sessionId,
    state,
    token,
  });

  const {
    activePendingQuestion,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyError,
    inlineQuestionReplyStatus,
    onChangeInlineQuestionCustomInput,
    onReplyInlineQuestion,
    onToggleInlineQuestionOption,
    resolveInlinePermissionActions,
  } = useTeamConversationViewInlineInteractions({ state });

  // ─── 派生 props ─────────────────────────────────────────────────────
  /**
   * 把消息列表 group 成 ChatRenderGroup[]，喂给 TeamConversationLayout 内部的
   * ChatMessageGroupList 渲染（与 chat 端视觉一致）。
   *
   * 相比早期「最简路径」，现在补齐了与 chat 对齐的两类能力：
   *   1. 每个 assistant 组首注入团队角色身份头（多级角色展示）。
   *   2. 每条消息注入 hover actions：复制 / 编辑重试（user）/ 重试（assistant）。
   *      仅在 composerEnabled（可交互）时注入编辑/重试，避免只读视图出现无效按钮。
   */
  const { buildEntryActions } = useTeamConversationViewEntryActions({
    composerEnabled,
    findRetrySource,
    readOnly,
    setHistoryEditPrompt,
    setRetryPrompt,
  });

  const groupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    return buildTeamGroupedMessageEntries({
      messages: state.messages,
      roleLayer: state.roleLayer,
      resolveInlinePermissionActions,
      visibleStreaming: state.visibleStreaming,
      streamBuffer: state.streamBuffer,
      streamingSegments: state.streamingSegments,
      buildEntryActions,
    });
  }, [
    state.messages,
    state.roleLayer,
    resolveInlinePermissionActions,
    state.visibleStreaming,
    state.streamBuffer,
    state.streamingSegments,
    buildEntryActions,
  ]);

  // Provider catalog for the model picker (composer header).
  const providerCatalog = useMemo(
    () => buildTeamProviderCatalog(state.providers),
    [state.providers],
  );

  const activeProvider = useMemo(
    () => findTeamActiveProvider(state.providers, state.activeProviderId),
    [state.activeProviderId, state.providers],
  );
  const activeModelOption = useMemo(
    () => findTeamActiveModelOption(activeProvider, state.activeModelId),
    [activeProvider, state.activeModelId],
  );
  const activeModelCanConfigureThinking = resolveTeamActiveModelCanConfigureThinking({
    activeModelId: state.activeModelId,
    activeModelOption,
    activeProvider,
  });
  const activeModelTooltip = buildTeamActiveModelTooltip(activeProvider, activeModelOption);

  // Latest finalized assistant message id —— 驱动 CollapsibleAssistantContent
  // 的"最新一条不折叠"行为。
  const latestAssistantMessageId = useMemo(
    () => findTeamLatestFinalizedAssistantId(state.messages),
    [state.messages],
  );

  // 用户输入条数 —— 驱动右侧「用户输入快捷跳转」控件（<=1 条时控件自隐）。
  const userMessageCount = useMemo(() => countTeamUserMessages(state.messages), [state.messages]);

  // canStopCurrentSessionStream: true while the user is actively streaming
  // through THIS hook (gatewayClient runs internally) — gives the composer a
  // working "stop" button.
  const canStopCurrentSessionStream = composerEnabled && state.streaming;

  useEffect(() => {
    setSelectedLayer(focusedLayer);
  }, [focusedLayer, sessionId]);

  const multiLayerMessages = useMemo<LayerMessages[]>(
    () =>
      buildTeamConversationMultiLayerMessages({
        childSessions: state.childSessions,
        handoffs: handoffs.values(),
        layerNodes,
        messages: state.messages,
        roleLayer: state.roleLayer,
        sessionId,
        sessionMetadata: state.sessionMetadata,
        soloMode,
        streamBuffer: state.streamBuffer,
        streamingSegments: state.streamingSegments,
        visibleStreaming: state.visibleStreaming,
      }),
    [
      sessionId,
      layerNodes,
      handoffs,
      soloMode,
      state.childSessions,
      state.messages,
      state.sessionMetadata,
      state.roleLayer,
      state.visibleStreaming,
      state.streamBuffer,
      state.streamingSegments,
    ],
  );

  /** 是否有任何消息（包括当前层级自身）—— 有消息就自动展开左侧群聊汇总面板。 */
  const hasAnyMessages = useMemo(
    () => hasTeamConversationLayerMessages(multiLayerMessages),
    [multiLayerMessages],
  );
  const defaultDetailLayer = useMemo(
    () => resolveTeamDefaultDetailLayer(multiLayerMessages),
    [multiLayerMessages],
  );

  useEffect(() => {
    // classic 工作台弃用 dual 多层侧栏，禁止自动切 dual
    if (
      classicWorkbench ||
      readOnly ||
      hasAutoOpenedMultiLayerRef.current ||
      compact ||
      viewMode !== 'single'
    ) {
      return;
    }
    // 有任何层级消息就自动展开左侧群聊汇总面板（不再要求必须有其它层级消息）
    if (!hasAnyMessages) return;
    if (isNarrowLayout) return;
    hasAutoOpenedMultiLayerRef.current = true;
    setSelectedLayer((previous) => previous ?? defaultDetailLayer);
    setViewMode('dual');
  }, [
    classicWorkbench,
    compact,
    defaultDetailLayer,
    hasAnyMessages,
    isNarrowLayout,
    readOnly,
    viewMode,
  ]);

  useEffect(() => {
    const updateNarrowLayout = () => setIsNarrowLayout(window.innerWidth < 900);
    updateNarrowLayout();
    window.addEventListener('resize', updateNarrowLayout);
    return () => window.removeEventListener('resize', updateNarrowLayout);
  }, []);

  useEffect(() => {
    if (isNarrowLayout && viewMode === 'dual') {
      setViewMode('single');
    }
  }, [isNarrowLayout, viewMode]);

  useEffect(() => {
    if (readOnly || compact || isNarrowLayout || !focusedLayer || viewMode !== 'single') {
      return;
    }
    if (!multiLayerMessages.some((layer) => layer.layer === focusedLayer)) {
      return;
    }
    setViewMode('dual');
  }, [compact, focusedLayer, isNarrowLayout, multiLayerMessages, readOnly, viewMode]);

  const handlePanelLayerSelect = useCallback((layer: string) => {
    setSelectedLayer(layer);
  }, []);

  // 左侧：用户与接待的主对话区（dual 模式下占 55%）
  // 注意：TeamConversationLayout 返回的是 fragment（topBar / 滚动区 / bar / composer
  // 被拍平塞进本容器），本容器必须同时设 minHeight:0 + overflow:hidden —— 否则
  // 消息流变长时，column flex 子项总高溢出会把 composer / 底部状态栏推出可视区，
  // 表现为「输入框看不到 / 滚不到最底 / 底部被裁一截」三种同源症状。
  const effectiveViewMode: ViewMode = classicWorkbench || soloMode ? 'single' : viewMode;

  return (
    <>
      {state.roleLayer === 'reception' && !readOnly ? (
        <TeamInitModal sessionId={sessionId} sessionMetadata={state.sessionMetadata} />
      ) : null}
      {readOnly ? null : (
        <PromptTemplatePanel
          isOpen={showTemplatePanel}
          onClose={() => setShowTemplatePanel(false)}
          onInsert={(content) => {
            state.setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${content}` : content));
            requestAnimationFrame(() => state.textareaRef.current?.focus());
          }}
        />
      )}
      <div
        style={
          soloMode || classicWorkbench
            ? TEAM_CONVERSATION_SOLO_LAYOUT_STYLE
            : TEAM_CONVERSATION_DUAL_LAYOUT_STYLE
        }
      >
        {/* 左侧：用户与接待的对话 */}
        <div
          style={
            soloMode || classicWorkbench
              ? TEAM_CONVERSATION_SOLO_MAIN_PANEL_STYLE
              : resolveTeamConversationMainPanelStyle(effectiveViewMode)
          }
        >
          <LatestAssistantMessageContext value={latestAssistantMessageId}>
            <TeamConversationLayout
              sessionId={sessionId}
              sessionSource="team"
              currentUserEmail={currentUserEmail}
              currentUserDisplayName={currentUserDisplayName}
              gatewayUrl={gatewayUrl}
              token={token}
              topBar={
                <TeamConversationViewTopBar
                  activePendingPermissionCount={activePendingPermissionCount}
                  clarificationPendingCount={clarificationPendingCount}
                  classicWorkbench={classicWorkbench}
                  diagnostics={diagnostics}
                  dualDisabled={isNarrowLayout}
                  multiLayerMode={multiLayerMode}
                  onFocusPendingInteraction={handleFocusPendingInteraction}
                  onMultiLayerModeChange={setMultiLayerMode}
                  onViewModeChange={handleViewModeChange}
                  roleLayer={state.roleLayer}
                  sessionId={sessionId}
                  sessionStateStatus={state.sessionStateStatus}
                  substate={state.substate}
                  topBar={topBar}
                  viewMode={viewMode}
                />
              }
              beforeMessages={
                <>
                  {/* classic 工作台弃用 SessionHeader / RunEventsPreview 等旧 chrome，
                      运营信息改由外层 ops chrome / inline cards 承载。 */}
                  {!classicWorkbench &&
                  state.roleLayer &&
                  state.roleLayer !== 'reception' &&
                  !readOnly ? (
                    <TeamSessionHeader
                      roleLayer={state.roleLayer}
                      substate={state.substate}
                      stateStatus={state.sessionStateStatus}
                      sessionMetadata={state.sessionMetadata}
                    />
                  ) : null}
                  {!classicWorkbench && state.runEvents.length > 0 && !readOnly ? (
                    <TeamRunEventsPreview runEvents={state.runEvents} />
                  ) : null}
                  {beforeMessages}
                </>
              }
              afterMessagesInline={
                <>
                  <TeamRoleTypingIndicator
                    roleLayer={state.roleLayer}
                    visible={
                      (state.streaming && !state.visibleStreaming) ||
                      (!state.visibleStreaming && state.remoteSessionBusyState === 'running')
                    }
                  />
                  {/* 推送条（团队反馈）等尾随内容也走 inline，紧贴对话流末尾，
                  消息很少时不会孤零零悬浮在输入框上方与对话脱节。 */}
                  {afterMessages}
                </>
              }
              rightFloatingSlot={
                readOnly ? null : (
                  <TeamUserJumpRail
                    scrollRegionRef={state.scrollRegionRef}
                    userCount={userMessageCount}
                    onPrev={handleScrollToPrevUser}
                    onNext={handleScrollToNextUser}
                  />
                )
              }
              anchorConversationToBottom
              composerDisabled={!composerEnabled}
              composerDisabledHint={composerDisabledHint}
              composerExtras={TEAM_CONVERSATION_COMPOSER_EXTRAS}
              composerWorkspaceCatalog={composerWorkspaceCatalog}
              searchMentionFiles={searchMentionFiles}
              messages={state.messages}
              groupedMessageEntries={groupedMessageEntries}
              visibleMessageCount={state.messages.length}
              hiddenMessageCount={state.hiddenMessageCount}
              visibleStreaming={state.visibleStreaming}
              showSessionSwitchSkeleton={state.isSessionLoading}
              remoteSessionBusyState={state.remoteSessionBusyState}
              pendingPermissions={state.pendingPermissions}
              resolveInlinePermissionActions={resolveInlinePermissionActions}
              providerCatalog={providerCatalog}
              activeProviderId={state.activeProviderId}
              activeModelId={state.activeModelId}
              activeProvider={activeProvider}
              activeModelOption={activeModelOption}
              activeModelCanConfigureThinking={activeModelCanConfigureThinking}
              activeModelTooltip={activeModelTooltip}
              onLoadEarlier={() => {
                void state.loadEarlierMessages();
              }}
              isLoadingEarlier={state.isLoadingEarlier}
              emptyContent={
                <TeamSessionEmptyState
                  roleLayer={state.roleLayer}
                  stateStatus={state.sessionStateStatus}
                  isLoading={state.isSessionLoading}
                  sessionMetadata={state.sessionMetadata}
                  onSelectStarter={handleSelectStarter}
                />
              }
              streaming={state.streaming}
              stoppingStream={state.stoppingStream}
              streamError={state.streamError ?? state.snapshotError ?? state.providersError}
              onDismissStreamError={() => {
                state.setStreamError(null);
                state.setSnapshotError(null);
                state.setProvidersError(null);
              }}
              checkpointCount={0}
              pendingQuestionsCount={state.pendingQuestions.length}
              stopCapability={canStopCurrentSessionStream ? 'best_effort' : 'none'}
              scrollRegionRef={state.scrollRegionRef}
              contentColumnRef={state.contentColumnRef}
              bottomRef={state.bottomRef}
              onScroll={state.onScroll}
              showScrollToBottom={state.showScrollToBottom}
              hasPendingFollowContent={state.hasPendingFollowContent}
              onScrollToBottom={(behavior, target) =>
                state.scrollToBottom(behavior, target === 'center' ? 'center' : 'latest-edge')
              }
              editorMode={false}
              compact={compact}
              sessionTodos={state.sessionTodos}
              rightOpen={false}
              activePendingQuestion={activePendingQuestion}
              inlineQuestionAnswers={inlineQuestionAnswers}
              inlineQuestionCustomInputs={inlineQuestionCustomInputs}
              inlineQuestionReplyStatus={inlineQuestionReplyStatus}
              inlineQuestionReplyError={inlineQuestionReplyError}
              onToggleInlineQuestionOption={onToggleInlineQuestionOption}
              onChangeInlineQuestionCustomInput={onChangeInlineQuestionCustomInput}
              onReplyInlineQuestion={onReplyInlineQuestion}
              historyEditPrompt={historyEditPrompt}
              onCloseHistoryEdit={() => setHistoryEditPrompt(null)}
              onResendHistoryEdit={handleResendHistoryEdit}
              onContinueHistoryEdit={handleContinueHistoryEdit}
              retryPrompt={retryPrompt}
              onCloseRetry={() => setRetryPrompt(null)}
              onRetryCurrent={handleRetryCurrent}
              chatSearch={chatSearch}
              composerVariant="session"
              providers={state.providers}
              canStopCurrentSessionStream={canStopCurrentSessionStream}
              dialogueMode="coding"
              manualAgentId=""
              yoloMode={false}
              webSearchEnabled={false}
              thinkingEnabled={state.thinkingEnabled}
              reasoningEffort={state.reasoningEffort}
              selectedImageEditReferenceArtifactId={null}
              input={state.input}
              setInput={state.setInput}
              textareaRef={state.textareaRef}
              onComposerSubmit={
                composerEnabled ? handleComposerSubmit : disabledComposerSubmitAction
              }
              onStopComposer={composerEnabled ? handleStopStream : disabledComposerAsyncAction}
              onComposerModelSelect={handleComposerModelSelect}
              onContextWindowOverrideChange={handleContextWindowOverrideChange}
              onToggleWebSearch={disabledComposerAction}
              onThinkingEnabledChange={state.setThinkingEnabled}
              onReasoningEffortChange={state.setReasoningEffort}
              onManualAgentChange={disabledComposerAction}
              onClearManualAgentId={disabledComposerAction}
              composerPlaceholder={effectivePlaceholder}
            />
          </LatestAssistantMessageContext>
        </div>
        {soloMode || classicWorkbench ? null : (
          <TeamConversationLayerSidePanel
            activeLayer={state.roleLayer}
            currentSessionId={sessionId}
            layers={multiLayerMessages}
            mode={multiLayerMode}
            selectedLayer={selectedLayer}
            isOpen={effectiveViewMode === 'dual'}
            activeModelId={state.activeModelId}
            activeModelLabel={activeModelOption?.label}
            activeProviderId={state.activeProviderId}
            providerCatalog={providerCatalog}
            currentUserEmail={currentUserEmail}
            currentUserDisplayName={currentUserDisplayName}
            scrollRegionRef={state.scrollRegionRef}
            resolveInlinePermissionActions={resolveInlinePermissionActions}
            // 权限与「打开完整会话」都要下沉到卡片墙：权限请求是**实例级**的
            // （网关恢复接口把整棵子树的待处理请求一并返回），只有卡片知道
            // 自己对应哪个 session。不传下去，用户就必须切回 feed 视图才能处置。
            pendingPermissions={state.pendingPermissions}
            onOpenSession={onOpenSession}
            onLayerSelect={handlePanelLayerSelect}
          />
        )}
      </div>
    </>
  );
}
