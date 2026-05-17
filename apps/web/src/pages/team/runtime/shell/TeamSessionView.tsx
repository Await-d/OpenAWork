/**
 * TeamSessionView · Phase 2a + 2b 前端契约
 *
 * Team 端调用 SessionConversationView 的入口包装组件。
 *
 * **当前行为**：
 * - 通过 useSessionConversationState hook 拿到对话布局所需的 state
 * - 渲染 SessionConversationView，**composer 默认 disabled**（Phase 2a 只读）
 * - Phase 2b 前端契约：当 `composerEnabled = true` 时，composer 提交走
 *   `submitInbound(messageType, payload)`，message_type 由 substate 决定：
 *     - substate === 'clarifying' → 'clarification_answer'
 *     - 其他 → 'user_input'
 * - 关闭所有 chat-only composer 能力（imageGen / skill / yolo / dialogueMode 等）
 *
 * 关联文档：
 * - `docs/chat-conversation-reuse-plan.md` Phase 2a / 2b
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md`
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { SessionConversationView } from '../../../../components/session-conversation/SessionConversationView.js';
import { useSessionConversationState } from '../../../../components/session-conversation/use-session-conversation-state.js';
import { useChatSearch } from '../../../../components/chat/chat-search-overlay.js';
import { renderChatMessageContentWithOptions } from '../../../../components/chat/ChatPageSections.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../../components/chat/chat-message-group-list.js';
import { groupChatRenderEntries } from '../../../../components/session-conversation/runtime/chat-page-utils.js';
import type { UnifiedComposerSubmitPayload } from '../../../../components/chat/UnifiedComposer.js';
import { useAuthStore } from '../../../../stores/auth.js';
import { TeamSubstateProgressBar } from './TeamSubstateProgressBar.js';
import { TeamSessionEmptyState } from './TeamSessionEmptyState.js';

export interface TeamSessionViewProps {
  sessionId: string;
  /**
   * 顶部状态/进度槽。
   * 默认渲染 `<TeamSubstateProgressBar/>`（基于 hook 暴露的 roleLayer/substate/stateStatus）。
   * 外层可传 ReactNode 覆盖默认行为。
   */
  topBar?: ReactNode;
  /** 消息列表前 slot（如 team 任务流缩略）。 */
  beforeMessages?: ReactNode;
  /** 消息列表后 slot（如 push 消息条）。 */
  afterMessages?: ReactNode;
  /**
   * 是否启用 composer 输入。
   *
   * - **默认 false**（Phase 2a 只读模式，与文档 D2 决策对齐）
   *   composer 显示但 disabled，并展示提示语
   * - **true**：composer 启用，提交时走 L1.3 inbound_messages 反向通道
   *   （依赖后端 `POST /team/sessions/:sessionId/inbound-messages` 端点）
   *
   * 后端 L1.3 改造 1+3+4 落地后，由调用方通过 feature flag / config 切换。
   */
  composerEnabled?: boolean;
  /**
   * 当 composer disabled 时显示的提示文字。
   * 默认："该会话正在执行中，请通过 b 与团队对话"
   */
  composerDisabledHint?: string;
  /**
   * 自定义 composer 启用态的 textarea placeholder。
   * 不传时按 roleLayer 回落（reception 用接待层引导文案，其他用 chat 默认）。
   */
  composerPlaceholder?: string;
}

export function TeamSessionView({
  sessionId,
  topBar,
  beforeMessages,
  afterMessages,
  composerEnabled = false,
  composerDisabledHint = '该会话正在执行中，请通过 b 与团队对话',
  composerPlaceholder,
}: TeamSessionViewProps) {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';

  const state = useSessionConversationState({
    sessionId,
    currentUserEmail,
    gatewayUrl,
    token,
  });

  // chat search overlay（team 暂时也允许搜索，但不展示快捷键提示）
  const chatSearch = useChatSearch({
    messages: state.messages,
    scrollRegionRef: state.scrollRegionRef,
  });

  // 默认 topBar：进度条。外层可传 topBar 覆盖。
  const effectiveTopBar = topBar ?? (
    <TeamSubstateProgressBar
      roleLayer={state.roleLayer}
      substate={state.substate}
      stateStatus={state.sessionStateStatus}
    />
  );

  // Starter chip 点击：把文本填入 composer（不发送），让用户编辑后再发出
  const handleSelectStarter = useCallback(
    (text: string) => {
      state.setInput(text);
      // 让 textarea 立刻聚焦（如果 ref 存在）
      const ta = state.textareaRef.current;
      if (ta) {
        ta.focus();
        // 把光标放到文末
        const len = text.length;
        try {
          ta.setSelectionRange(len, len);
        } catch {
          // 某些 textarea 可能不支持 setSelectionRange，忽略
        }
      }
    },
    [state],
  );

  // 默认 placeholder：根据 roleLayer + substate 给出更贴合团队语义的占位文案。
  // 与 D26（b 直答 vs 走 c 路由）对齐——告诉用户"输入需求会被派发给团队"。
  const effectivePlaceholder = useMemo(() => {
    if (composerPlaceholder) return composerPlaceholder;
    if (state.roleLayer === 'reception') {
      if (state.substate === 'clarifying') {
        return '团队正在等你回答澄清问题，请直接输入答案…（Enter 发送）';
      }
      return '告诉接待层你想做什么，团队会按需展开规划/执行/评审…（Enter 发送，Shift+Enter 换行）';
    }
    return undefined;
  }, [composerPlaceholder, state.roleLayer, state.substate]);

  // ─── handlers ───────────────────────────────────────────────────────
  const noopAsync = useCallback(async () => {
    // intentionally empty
  }, []);

  const noopVoid = useCallback(() => {
    // intentionally empty
  }, []);

  const handleScroll = useCallback(() => {
    // 只读模式不维护 showScrollToBottom 等派生状态；交给后续 v1.0 hook 完成
  }, []);

  const handleScrollToBottom = useCallback(() => {
    // Phase 2a 不实现 scrollToBottom；在 v1.0 hook 中由内部 scroll manager 提供
  }, []);

  // ─── inbound 提交（Phase 2b 前端契约）────────────────────────────────
  // composer 提交时走 L1.3 反向通道。message_type 由 substate 决定：
  //   - clarifying → clarification_answer
  //   - 其他 → user_input
  // payload 只放最小信息（text）。后端落地后即可工作。
  const handleComposerSubmit = useCallback(
    async (payload: UnifiedComposerSubmitPayload) => {
      if (!composerEnabled) return;
      const text = payload.text.trim();
      if (!text) return;

      const messageType = state.substate === 'clarifying' ? 'clarification_answer' : 'user_input';
      try {
        if (messageType === 'clarification_answer') {
          await state.submitInbound('clarification_answer', {
            // questionId 暂未携带（前端 hook 还没暴露 pending clarification id）；
            // 后端在收到不带 questionId 的 clarification_answer 时按 latest pending question 处理。
            answer: text,
          } as never);
        } else {
          await state.submitInbound('user_input', { text } as never);
        }
        // 重新加载快照，让最新落库的消息显示出来
        await state.reload();
      } catch (err) {
        // submit 失败时把 error 文案推到 streamError 槽
        const message = err instanceof Error ? err.message : 'inbound 提交失败';
        state.setStreamError(message);
      }
    },
    [composerEnabled, state],
  );

  // ─── 派生 props ─────────────────────────────────────────────────────
  /**
   * 把消息列表 group 成 ChatRenderGroup[]，让 SessionConversationView 内部的
   * ChatMessageGroupList 能正常渲染（与 chat 端视觉一致）。
   *
   * 这里不接 useChatRenderData——那个 hook 需要 25+ 字段（toolCallCards/
   * buildMessageActions/handleCopyMessageGroup 等），是 chat 业务范畴。
   * team 走最简路径：每条 message 直接渲染，不带 actions/usageDetails。
   */
  const groupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    const entries: ChatRenderEntry[] = state.messages.map((message) => ({
      message,
      renderContent: (m) => renderChatMessageContentWithOptions(m),
    }));
    return groupChatRenderEntries(entries);
  }, [state.messages]);

  return (
    <SessionConversationView
      sessionId={sessionId}
      sessionSource="team"
      currentUserEmail={currentUserEmail}
      gatewayUrl={gatewayUrl}
      token={token}
      topBar={effectiveTopBar}
      beforeMessages={beforeMessages}
      afterMessages={afterMessages}
      composerDisabled={!composerEnabled}
      composerDisabledHint={composerDisabledHint}
      composerExtras={{
        // 与 chat 端体验保持一致：基础对话开关全开（这些都已在 TeamSessionView
        // 的 onComposerSubmit / onToggleWebSearch / onManualAgentChange 等回调里
        // 接通）。imageGeneration / bookmarks / skillRecommendation / multiSelect /
        // promptTemplate 这几个 chat 专属的高级特性还没有 team 数据流，先保持关闭，
        // 避免按钮响应不正常误导用户。
        imageGeneration: false,
        skillRecommendation: false,
        multiSelect: false,
        bookmarks: false,
        promptTemplate: false,
        commandPalette: true,
        dialogueModeToggle: true,
        yoloMode: true,
        agentSwitch: true,
      }}
      messages={state.messages}
      groupedMessageEntries={groupedMessageEntries}
      visibleMessageCount={state.messages.length}
      hiddenMessageCount={0}
      visibleStreaming={state.visibleStreaming}
      showSessionSwitchSkeleton={state.isSessionLoading}
      remoteSessionBusyState={state.remoteSessionBusyState}
      pendingPermissions={state.pendingPermissions}
      providerCatalog={new Map()}
      activeProviderId={state.activeProviderId}
      activeModelId={state.activeModelId}
      onLoadEarlier={noopVoid}
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
      streamError={state.streamError}
      onDismissStreamError={() => state.setStreamError(null)}
      checkpointCount={0}
      pendingQuestionsCount={state.pendingQuestions.length}
      stopCapability="none"
      onOpenRecovery={noopVoid}
      scrollRegionRef={state.scrollRegionRef}
      contentColumnRef={state.contentColumnRef}
      bottomRef={state.bottomRef}
      onScroll={handleScroll}
      showScrollToBottom={state.showScrollToBottom}
      hasPendingFollowContent={state.hasPendingFollowContent}
      onScrollToBottom={handleScrollToBottom}
      editorMode={false}
      compact
      sessionTodos={state.sessionTodos}
      rightOpen={false}
      activePendingQuestion={state.pendingQuestions[0] ?? null}
      inlineQuestionAnswers={[]}
      inlineQuestionCustomInputs={[]}
      inlineQuestionReplyStatus={null}
      inlineQuestionReplyError={null}
      onToggleInlineQuestionOption={noopVoid}
      onChangeInlineQuestionCustomInput={noopVoid}
      onReplyInlineQuestion={noopAsync}
      historyEditPrompt={null}
      onCloseHistoryEdit={noopVoid}
      onResendHistoryEdit={noopVoid}
      onContinueHistoryEdit={noopVoid}
      onCreateBranchFromHistoryEdit={noopVoid}
      retryPrompt={null}
      onCloseRetry={noopVoid}
      onRetryCurrent={noopVoid}
      onRetryBranch={noopVoid}
      chatSearch={chatSearch}
      composerVariant="session"
      providers={state.providers}
      canStopCurrentSessionStream={false}
      dialogueMode={state.dialogueMode}
      manualAgentId={state.manualAgentId}
      yoloMode={state.yoloMode}
      webSearchEnabled={state.webSearchEnabled}
      thinkingEnabled={state.thinkingEnabled}
      reasoningEffort={state.reasoningEffort}
      selectedImageEditReferenceArtifactId={null}
      input={state.input}
      setInput={state.setInput}
      textareaRef={state.textareaRef}
      onComposerSubmit={composerEnabled ? handleComposerSubmit : noopAsync}
      onStopComposer={noopAsync}
      onToggleWebSearch={() => state.setWebSearchEnabled((v) => !v)}
      onThinkingEnabledChange={(enabled) => state.setThinkingEnabled(enabled)}
      onReasoningEffortChange={(effort) => state.setReasoningEffort(effort)}
      onManualAgentChange={(agentId) => state.setManualAgentId(agentId)}
      onClearManualAgentId={() => state.setManualAgentId('')}
      composerPlaceholder={effectivePlaceholder}
    />
  );
}
