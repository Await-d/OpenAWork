/**
 * TeamSessionView · Phase 2a
 *
 * Team 端调用 SessionConversationView 的入口包装组件。
 *
 * **当前阶段（Phase 2a 只读模式）**：
 * - 通过 useSessionConversationState hook 拿到对话布局所需的 state
 * - 渲染 SessionConversationView，**composer 默认 disabled**
 *   （等 Phase 2b L1.3 inbound_messages 协议落地后再开）
 * - 关闭所有 chat-only composer 能力（imageGen / skill / yolo / dialogueMode 等）
 *
 * 关联文档：
 * - `docs/chat-conversation-reuse-plan.md` Phase 2a
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md`
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { SessionConversationView } from '../../../components/session-conversation/SessionConversationView.js';
import { useSessionConversationState } from '../../../components/session-conversation/use-session-conversation-state.js';
import { useChatSearch } from '../../../components/chat/chat-search-overlay.js';
import { renderChatMessageContentWithOptions } from '../../../components/chat/ChatPageSections.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../components/chat/chat-message-group-list.js';
import { groupChatRenderEntries } from '../../../components/session-conversation/runtime/chat-page-utils.js';
import { useAuthStore } from '../../../stores/auth.js';
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
}

export function TeamSessionView({
  sessionId,
  topBar,
  beforeMessages,
  afterMessages,
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

  // ─── handlers（Phase 2a 大部分为 no-op，因为 composer disabled）────────
  const noopAsync = useCallback(async () => {
    // Phase 2a 只读模式：composer disabled，submit 不可达
  }, []);

  const noopVoid = useCallback(() => {
    // 同上
  }, []);

  const handleScroll = useCallback(() => {
    // 只读模式不维护 showScrollToBottom 等派生状态；交给后续 v1.0 hook 完成
  }, []);

  const handleScrollToBottom = useCallback(() => {
    // Phase 2a 不实现 scrollToBottom；在 v1.0 hook 中由内部 scroll manager 提供
  }, []);

  // ─── 派生 props ─────────────────────────────────────────────────────
  /**
   * 把消息列表 group 成 ChatRenderGroup[]，让 SessionConversationView 内部的
   * ChatMessageGroupList 能正常渲染（与 chat 端视觉一致）。
   *
   * 这里不接 useChatRenderData——那个 hook 需要 25+ 字段（toolCallCards/
   * buildMessageActions/handleCopyMessageGroup 等），是 chat 业务范畴。
   * team 走最简路径：每条 message 直接渲染，不带 actions/usageDetails。
   *
   * 若后续 team 需要 actions（编辑/重试/收藏）等能力，再扩展本函数。
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
      composerDisabled
      composerDisabledHint="该会话正在执行中，请通过 b 与团队对话"
      composerExtras={{
        imageGeneration: false,
        skillRecommendation: false,
        multiSelect: false,
        bookmarks: false,
        promptTemplate: false,
        commandPalette: false,
        dialogueModeToggle: false,
        yoloMode: false,
        agentSwitch: false,
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
      onComposerSubmit={noopAsync}
      onStopComposer={noopAsync}
      onToggleWebSearch={() => state.setWebSearchEnabled((v) => !v)}
      onThinkingEnabledChange={(enabled) => state.setThinkingEnabled(enabled)}
      onReasoningEffortChange={(effort) => state.setReasoningEffort(effort)}
      onManualAgentChange={(agentId) => state.setManualAgentId(agentId)}
      onClearManualAgentId={() => state.setManualAgentId('')}
    />
  );
}
