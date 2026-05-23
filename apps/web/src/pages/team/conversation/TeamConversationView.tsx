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
 * - 把 chat-only 的 dialogueMode/yoloMode/webSearchEnabled/manualAgentId/
 *   thinkingEnabled/reasoningEffort 在喂给 layout 时硬编码为关闭/默认值
 *   （team hook 里这些字段已经被删除）
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
 * - `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import { renderChatMessageContentWithOptions } from '../../../components/chat/session/ChatPageSections.js';
import { LatestAssistantMessageContext } from '../../../components/chat/message/collapsible-assistant-content.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../components/chat/message/chat-message-group-list.js';
import { groupChatRenderEntries } from '../../../components/conversation-runtime/messages/group-render-entries.js';
import type { UnifiedComposerSubmitPayload } from '../../../components/chat/composer/UnifiedComposer.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useChatKeyboardShortcuts } from '../../../hooks/chat/useChatKeyboardShortcuts.js';
import { useComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useMessageMultiSelect } from '../../../components/chat/message/message-multi-select.js';
import { copyExportToClipboard } from '../../../components/chat/message/message-export.js';
import { PromptTemplatePanel } from '../../../components/chat/misc/prompt-template-panel.js';
import { TeamConversationLayout } from './TeamConversationLayout.js';
import { TeamSubstateProgressBar } from './extras/TeamSubstateProgressBar.js';
import { TeamSessionEmptyState } from './extras/TeamSessionEmptyState.js';
import { TeamSessionHeader } from './extras/TeamSessionHeader.js';
import { useTeamConversationState } from './use-team-conversation-state.js';
import { resolveTeamSubmitStrategy } from './submit/team-submit-router.js';

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
}: TeamConversationViewProps) {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';

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

  // Workspace catalog for @mention support — only fetched when composer is on.
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog(composerEnabled);

  // Multi-select state（共享 atom）。
  const multiSelect = useMessageMultiSelect();

  // Prompt template panel state.
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);

  // Copy last assistant message helper.
  const handleCopyLastAssistant = useCallback(() => {
    const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      void copyExportToClipboard([lastAssistant], 'text');
    }
  }, [state.messages]);

  // Scroll to next/prev user message helpers.
  const handleScrollToNextUser = useCallback(() => {
    const region = state.scrollRegionRef.current;
    if (!region) return;
    const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
    const regionRect = region.getBoundingClientRect();
    for (const el of Array.from(userMessages)) {
      const rect = el.getBoundingClientRect();
      if (rect.top > regionRect.top + 60) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }, [state.scrollRegionRef]);

  const handleScrollToPrevUser = useCallback(() => {
    const region = state.scrollRegionRef.current;
    if (!region) return;
    const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
    const regionRect = region.getBoundingClientRect();
    const arr = Array.from(userMessages).reverse();
    for (const el of arr) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < regionRect.top + 60) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }, [state.scrollRegionRef]);

  // Keyboard shortcuts — wire all applicable handlers for team context.
  // 与 chat 共享同一份 useChatKeyboardShortcuts；team 不接 command palette
  // （需要 items 列表，留待后续 PR 从 composerCommandDescriptors 构建），
  // 也不处理 sidebar / right panel / new session / dialogue mode 这些
  // ChatPage 级别的 layout 操作（team 由 TeamPageV2 外壳控制）。
  useChatKeyboardShortcuts(
    {
      onSearch: () => chatSearch.open(),
      onCopyLastAssistant: handleCopyLastAssistant,
      onToggleMultiSelect: () => {
        if (multiSelect.multiSelect.enabled) {
          multiSelect.disableMultiSelect();
        } else {
          multiSelect.enableMultiSelect();
          requestAnimationFrame(() => multiSelect.selectAll(state.messages));
        }
      },
      onOpenTemplates: () => setShowTemplatePanel(true),
      onScrollToNextUser: handleScrollToNextUser,
      onScrollToPrevUser: handleScrollToPrevUser,
    },
    composerEnabled,
  );

  // 默认 topBar：进度条。外层可传 topBar 覆盖。
  // 优化：reception 层 idle 状态下不显示进度条（没有有用信息），减少垂直空间占用。
  const effectiveTopBar =
    topBar ??
    (state.roleLayer === 'reception' &&
    (!state.substate || state.substate === 'idle' || state.substate === 'chatting') &&
    state.sessionStateStatus !== 'running' ? null : (
      <TeamSubstateProgressBar
        roleLayer={state.roleLayer}
        substate={state.substate}
        stateStatus={state.sessionStateStatus}
      />
    ));

  // Starter chip 点击：把文本填入 composer（不发送），让用户编辑后再发出。
  const handleSelectStarter = useCallback(
    (text: string) => {
      state.setInput(text);
      const ta = state.textareaRef.current;
      if (ta) {
        ta.focus();
        const len = text.length;
        try {
          ta.setSelectionRange(len, len);
        } catch {
          // 某些 textarea 可能不支持 setSelectionRange，忽略。
        }
      }
    },
    [state],
  );

  // 默认 placeholder：根据 roleLayer + substate 给出更贴合团队语义的占位文案。
  // 与 D26（b 直答 vs 走 c 路由）对齐——告诉用户"输入需求会被派发给团队"。
  const effectivePlaceholder = useMemo(() => {
    if (composerPlaceholder) return composerPlaceholder;
    if (state.substate === 'clarifying') {
      return '团队正在等你回答澄清问题，请直接输入答案…（Enter 发送）';
    }
    if (state.roleLayer === 'reception') {
      return '告诉接待层你想做什么，团队会按需展开规划/执行/评审…（Enter 发送，Shift+Enter 换行）';
    }
    return '输入消息与团队对话…（Enter 发送，Shift+Enter 换行）';
  }, [composerPlaceholder, state.roleLayer, state.substate]);

  // ─── handlers ───────────────────────────────────────────────────────
  const noopAsync = useCallback(async () => {
    // intentionally empty
  }, []);

  const noopVoid = useCallback(() => {
    // intentionally empty
  }, []);

  // ─── 提交路由（D5 决策：按 roleLayer/substate 选 stream 或 inbound）──────
  // - clarifying → inbound (clarification_answer)
  // - 其它 → stream（让用户的输入直接驱动该 session 的 LLM 循环；reception
  //   走 b 路由，其它 layer 是普通 chat 风格的 session）
  // - inbound 端点 404 / 5xx → 自动 fallback 到 stream，让用户至少能看到回复
  const handleComposerSubmit = useCallback(
    async (payload: UnifiedComposerSubmitPayload) => {
      if (!composerEnabled) return;
      const text = payload.text.trim();
      if (!text) return;

      const strategy = resolveTeamSubmitStrategy(state.roleLayer, state.substate);
      state.setInput('');

      if (strategy.kind === 'inbound') {
        // 当前只有 'clarification_answer' / 'user_input' 在 backend 端点已落地
        // （`@openAwork/web-client` 的 InboundMessageType 联合）。router 暴露的
        // 'spec_revision' / 'plan_approval' 是预留位，等后端落地时再放行。
        if (
          strategy.messageType === 'clarification_answer' ||
          strategy.messageType === 'user_input'
        ) {
          try {
            await state.submitInbound(strategy.messageType, { answer: text } as never);
            await state.reload();
            return;
          } catch (err) {
            // inbound 端点不可用 → fallback 到 stream，避免阻塞用户。
            console.warn(
              '[TeamConversationView] inbound submit failed, falling back to stream:',
              err instanceof Error ? err.message : err,
            );
          }
        } else {
          console.warn(
            '[TeamConversationView] inbound messageType not yet supported:',
            strategy.messageType,
          );
        }
      }

      // handoff 路径目前由方案预留，没有触发条件；当出现时直接告警并 fallback。
      if (strategy.kind === 'handoff') {
        console.warn(
          '[TeamConversationView] handoff submit strategy not implemented; falling back to stream',
        );
      }

      // stream 路径：复用 chat 端 SSE/WS 协议。
      try {
        await state.startStream(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stream 请求失败';
        state.setStreamError(message);
      }
    },
    [composerEnabled, state],
  );

  const handleStopStream = useCallback(async () => {
    if (!composerEnabled) return;
    await state.stopStream();
  }, [composerEnabled, state]);

  // ─── 行内 question / permission 回复 ────────────────────────────────
  const [inlineQuestionAnswers, setInlineQuestionAnswers] = useState<string[][]>([]);
  const [inlineQuestionCustomInputs, setInlineQuestionCustomInputs] = useState<string[]>([]);
  const [inlineQuestionReplyStatus, setInlineQuestionReplyStatus] = useState<
    'answered' | 'dismissed' | null
  >(null);
  const [inlineQuestionReplyError, setInlineQuestionReplyError] = useState<string | null>(null);
  const activePendingQuestion = state.pendingQuestions[0] ?? null;
  const activeQuestionIdRef = useRef<string | null>(null);

  // Reset inline answers state when the active question changes.
  useEffect(() => {
    const nextId = activePendingQuestion?.requestId ?? null;
    if (activeQuestionIdRef.current === nextId) return;
    activeQuestionIdRef.current = nextId;
    if (activePendingQuestion) {
      setInlineQuestionAnswers(activePendingQuestion.questions.map(() => []));
      setInlineQuestionCustomInputs(activePendingQuestion.questions.map(() => ''));
    } else {
      setInlineQuestionAnswers([]);
      setInlineQuestionCustomInputs([]);
    }
    setInlineQuestionReplyStatus(null);
    setInlineQuestionReplyError(null);
  }, [activePendingQuestion]);

  const onToggleInlineQuestionOption = useCallback(
    (questionIndex: number, optionLabel: string, multiple: boolean) => {
      setInlineQuestionAnswers((prev) => {
        const next = prev.map((arr) => arr.slice());
        const current = next[questionIndex] ?? [];
        if (current.includes(optionLabel)) {
          next[questionIndex] = current.filter((v) => v !== optionLabel);
        } else if (multiple) {
          next[questionIndex] = [...current, optionLabel];
        } else {
          next[questionIndex] = [optionLabel];
        }
        return next;
      });
    },
    [],
  );

  const onChangeInlineQuestionCustomInput = useCallback((questionIndex: number, value: string) => {
    setInlineQuestionCustomInputs((prev) => {
      const next = prev.slice();
      next[questionIndex] = value;
      return next;
    });
  }, []);

  const onReplyInlineQuestion = useCallback(
    async (status: 'answered' | 'dismissed') => {
      if (!activePendingQuestion) return;
      setInlineQuestionReplyError(null);
      try {
        // Merge custom inputs into answers when present.
        const mergedAnswers = inlineQuestionAnswers.map((answers, idx) => {
          const custom = inlineQuestionCustomInputs[idx]?.trim();
          if (status === 'answered' && custom) return [...answers, custom];
          return answers;
        });
        await state.replyQuestion(
          activePendingQuestion.requestId,
          status,
          status === 'answered' ? mergedAnswers : undefined,
        );
        setInlineQuestionReplyStatus(status);
      } catch (err) {
        setInlineQuestionReplyError(err instanceof Error ? err.message : '回复失败');
      }
    },
    [activePendingQuestion, inlineQuestionAnswers, inlineQuestionCustomInputs, state],
  );

  // ─── 派生 props ─────────────────────────────────────────────────────
  /**
   * 把消息列表 group 成 ChatRenderGroup[]，让 TeamConversationLayout 内部的
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

  // Provider catalog for the model picker (composer header).
  const providerCatalog = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: string }>();
    for (const provider of state.providers) {
      map.set(provider.id, { id: provider.id, name: provider.name, type: provider.type });
    }
    return map;
  }, [state.providers]);

  // Latest finalized assistant message id —— 驱动 CollapsibleAssistantContent
  // 的"最新一条不折叠"行为。
  const latestAssistantMessageId = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const m = state.messages[i];
      if (!m) continue;
      if (m.role !== 'assistant') continue;
      if (m.status === 'streaming') continue;
      return m.id;
    }
    return null;
  }, [state.messages]);

  // canStopCurrentSessionStream: true while the user is actively streaming
  // through THIS hook (gatewayClient runs internally) — gives the composer a
  // working "stop" button.
  const canStopCurrentSessionStream = composerEnabled && state.streaming;

  return (
    <>
      <PromptTemplatePanel
        isOpen={showTemplatePanel}
        onClose={() => setShowTemplatePanel(false)}
        onInsert={(content) => {
          state.setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${content}` : content));
          requestAnimationFrame(() => state.textareaRef.current?.focus());
        }}
      />
      <LatestAssistantMessageContext value={latestAssistantMessageId}>
        <TeamConversationLayout
          sessionId={sessionId}
          sessionSource="team"
          currentUserEmail={currentUserEmail}
          gatewayUrl={gatewayUrl}
          token={token}
          topBar={effectiveTopBar}
          beforeMessages={
            <>
              {/* 优化：reception 层的主对话不显示 TeamSessionHeader（用户已经在看
                  对话了，不需要再看"接待层 / idle"这种元数据）。非 reception
                  层（pm1/pm2/executor/reviewer）保留 header 以便用户知道当前看
                  的是哪个子 session。 */}
              {state.roleLayer && state.roleLayer !== 'reception' ? (
                <TeamSessionHeader
                  roleLayer={state.roleLayer}
                  substate={state.substate}
                  stateStatus={state.sessionStateStatus}
                  sessionMetadata={state.sessionMetadata}
                />
              ) : null}
              {beforeMessages}
            </>
          }
          afterMessages={afterMessages}
          composerDisabled={!composerEnabled}
          composerDisabledHint={composerDisabledHint}
          composerExtras={{
            // chat-only image / skill / yolo / dialogueMode 仍然关闭——这些功能
            // 依赖 chat 专属管线（ChatPage 的 image-generation hook、skill
            // drawer 等）。
            imageGeneration: false,
            skillRecommendation: false,
            yoloMode: false,
            dialogueModeToggle: false,
            // v1.5：放开这些通用对话能力，与 chat 体验对齐。
            multiSelect: true,
            bookmarks: true,
            promptTemplate: true,
            commandPalette: true,
            agentSwitch: true,
          }}
          composerWorkspaceCatalog={composerWorkspaceCatalog}
          messages={state.messages}
          groupedMessageEntries={groupedMessageEntries}
          visibleMessageCount={state.messages.length}
          hiddenMessageCount={0}
          visibleStreaming={state.visibleStreaming}
          showSessionSwitchSkeleton={state.isSessionLoading}
          remoteSessionBusyState={state.remoteSessionBusyState}
          pendingPermissions={state.pendingPermissions}
          providerCatalog={providerCatalog}
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
          stopCapability={canStopCurrentSessionStream ? 'best_effort' : 'none'}
          onOpenRecovery={noopVoid}
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
          canStopCurrentSessionStream={canStopCurrentSessionStream}
          /* chat-only 偏好已从 useTeamConversationState 中删除。这里硬编码
             默认值喂给 layout，避免 layout 内部的 props 形状变化（layout 是
             ChatConversationView 的副本，仍然要求这些字段存在）。team 端
             不会真正用到它们：composerExtras.dialogueModeToggle/yoloMode 都
             置 false，所以即使 layout 渲染相关控件也是 disabled 状态。 */
          dialogueMode="coding"
          manualAgentId=""
          yoloMode={false}
          webSearchEnabled={false}
          thinkingEnabled={false}
          reasoningEffort="medium"
          selectedImageEditReferenceArtifactId={null}
          input={state.input}
          setInput={state.setInput}
          textareaRef={state.textareaRef}
          onComposerSubmit={composerEnabled ? handleComposerSubmit : noopAsync}
          onStopComposer={composerEnabled ? handleStopStream : noopAsync}
          onToggleWebSearch={noopVoid}
          onThinkingEnabledChange={noopVoid}
          onReasoningEffortChange={noopVoid}
          onManualAgentChange={noopVoid}
          onClearManualAgentId={noopVoid}
          composerPlaceholder={effectivePlaceholder}
        />
      </LatestAssistantMessageContext>
    </>
  );
}
