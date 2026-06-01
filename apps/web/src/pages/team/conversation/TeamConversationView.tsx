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
import type {
  HistoryEditPromptInput,
  RetryPromptInput,
} from './TeamConversationLayout.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import { prepareStandardChatSendInput } from '../../chat-page/conversation/composer/prepare-standard-chat-send-input.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type { InputImageContent } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useChatKeyboardShortcuts } from '../../../hooks/chat/useChatKeyboardShortcuts.js';
import { useComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useMessageMultiSelect } from '../../../components/chat/message/message-multi-select.js';
import { copyExportToClipboard } from '../../../components/chat/message/message-export.js';
import { PromptTemplatePanel } from '../../../components/chat/misc/prompt-template-panel.js';
import { TeamConversationLayout } from './TeamConversationLayout.js';
import { TeamSubstateProgressBar } from './extras/TeamSubstateProgressBar.js';
import { TeamRunStateBanner } from './extras/TeamRunStateBanner.js';
import { TeamSessionEmptyState } from './extras/TeamSessionEmptyState.js';
import { TeamSessionHeader } from './extras/TeamSessionHeader.js';
import { TeamMessageRoleHeader } from './extras/TeamMessageRoleHeader.js';
import { TeamUserJumpRail } from './extras/TeamUserJumpRail.js';
import { TeamRoleTypingIndicator } from './extras/TeamRoleTypingIndicator.js';
import { TeamInitModal } from './extras/TeamInitModal.js';
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
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog({
    enabled: composerEnabled,
    gatewayUrl,
    sessionId,
    token,
  });

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

  // 默认 topBar：
  //   - reception 层：显示「团队整体运行状态」横幅（TeamRunStateBanner，自聚合
  //     handoff/连接/活动信号；无任何 handoff 时自渲染为 null）。它解决了
  //     「提交需求后看不出团队是在跑/卡住/异常停」的可观测性缺口。reception 会话
  //     自身常回 idle，原来的 substate 进度条对 reception 没意义，故不再用它。
  //   - 其它层（pm1/pm2/executor/reviewer）：保留 substate 进度条（对单层有意义）。
  const effectiveTopBar =
    topBar ??
    (state.roleLayer === 'reception' ? (
      <TeamRunStateBanner receptionStateStatus={state.sessionStateStatus} />
    ) : (
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
    // 流式进行中：明确提示当前不可发送（与 handleComposerSubmit 的 busy 守卫呼应）。
    if (state.streaming) {
      return '团队正在回复中，可点击停止后再发送…';
    }
    if (state.substate === 'clarifying') {
      return '团队在等你回答澄清问题，直接输入答案后回车发送…';
    }
    if (state.roleLayer === 'reception') {
      return '告诉团队你想做什么，回车发送 · Shift+Enter 换行';
    }
    if (state.roleLayer && state.roleLayer !== 'reception') {
      return '与当前层对话，回车发送 · Shift+Enter 换行';
    }
    return '输入消息与团队对话，回车发送 · Shift+Enter 换行';
  }, [composerPlaceholder, state.roleLayer, state.substate, state.streaming]);

  // ─── handlers ───────────────────────────────────────────────────────
  const noopAsync = useCallback(async () => {
    // intentionally empty
  }, []);

  const noopVoid = useCallback(() => {
    // intentionally empty
  }, []);

  // ─── 统一文本派发（提交路由 D5 决策：按 roleLayer/substate 选 inbound / stream）──
  // 抽成可复用单元，让「正常提交 / 编辑重发 / 重试 / 追加」都走同一条路由，避免
  // 编辑重试在 clarifying 环节误绕过 inbound 通道。
  //   - clarifying → inbound (clarification_answer)
  //   - 其它 → stream（reception 走 b 路由，其它 layer 是普通 chat 风格 session）
  //   - inbound 端点 404 / 5xx → 自动 fallback 到 stream
  const dispatchTeamText = useCallback(
    async (text: string, inputParts?: InputImageContent[]): Promise<boolean> => {
      // 每次新的派发尝试先清除上一轮的错误提示，避免旧错误遮挡新内容。
      state.setStreamError(null);
      const strategy = resolveTeamSubmitStrategy(state.roleLayer, state.substate);

      if (strategy.kind === 'inbound') {
        if (strategy.messageType === 'clarification_answer') {
          // #6 澄清答案路径：必须携带 questionId 才能让后端把对应的 escalation
          // 标记 'answered'。inline-question UI 走的是另一条 onReplyInlineQuestion
          // 路径（带 requestId），而 composer 派发到这里时拿不到 questionId。
          // 早期实现直接 submit `{ answer: text }`——后端会落库 inbound 但
          // **resolveClarificationEscalationRequest 因缺 questionId 静默 no-op**，
          // c session 永远不会得知答案，substate 卡死。
          //
          // 复查后的修法：composer 派发时把这条改写成 `user_input`（语义同
          // "给当前 session 追加一条用户输入"，c runner 会从消息流读到），
          // 既不污染 session（被 c runner 主动消费而非 stream 注入），又
          // 保证用户输入真的进入流程。如果 inbound 失败再交给下方 stream 兜底。
          try {
            await state.submitInbound('user_input', { text } as never);
            await state.reload();
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : '提交输入失败';
            console.warn(
              '[TeamConversationView] clarifying inbound submit (as user_input) failed:',
              message,
            );
            // 澄清环节失败仍不能错路由到 stream（c session 处于 LLM 循环中）：
            // 报错让用户重试。
            state.setStreamError(`输入提交失败，请重试：${message}`);
            return false;
          }
        }

        if (strategy.messageType === 'user_input') {
          // user_input 走 inbound 失败时回退 stream 是安全的（同为"给当前 session
          // 追加一条用户消息"语义），保留原有 fallback 行为。
          // 注意：UserInputPayload 字段是 `text`（不是 `answer`），后端
          // team-inbound.ts 读 body.payload['text']。早期实现误写成 `answer`
          // 导致 inbound 路径吞输入；这里同时纠正字段名。
          try {
            await state.submitInbound(strategy.messageType, { text } as never);
            await state.reload();
            return true;
          } catch (err) {
            console.warn(
              '[TeamConversationView] user_input inbound submit failed, falling back to stream:',
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

      if (strategy.kind === 'handoff') {
        console.warn(
          '[TeamConversationView] handoff submit strategy not implemented; falling back to stream',
        );
      }

      try {
        await state.startStream(text, inputParts ? { inputParts } : undefined);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stream 请求失败';
        state.setStreamError(message);
        return false;
      }
    },
    [state],
  );

  const handleComposerSubmit = useCallback(
    async (payload: UnifiedComposerSubmitPayload) => {
      if (!composerEnabled) return;
      const text = payload.text.trim();
      // 纯附件（无文本）也允许发送：用一个占位描述让后端/LLM 知道用户发了图片。
      // 早期实现 `if (!text) return` 会静默丢弃纯图片提交，用户无任何反馈。
      const hasFiles = payload.files.length > 0;
      if (!text && !hasFiles) return;

      // 流式进行中直接挡掉，并保留输入框内容 + 给出明确提示，避免"清空输入框→
      // startStream 静默 return→消息凭空消失"的旧行为（端到端健壮性 🔴#2）。
      if (state.streaming) {
        state.setStreamError('正在生成回复，请等待当前回复完成或点击停止后再发送。');
        return;
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
          state.setStreamError(
            `附件上传失败，消息未发送（请重试或移除附件后重发）：${message}`,
          );
          return;
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
    },
    [composerEnabled, state, gatewayUrl, sessionId, token, dispatchTeamText],
  );

  const handleStopStream = useCallback(async () => {
    if (!composerEnabled) return;
    await state.stopStream();
  }, [composerEnabled, state]);

  // ─── 会话内容编辑 / 重试（对齐 chat）──────────────────────────────────
  // team 之前把这些全接成 noop；这里补上真实实现：
  //   - 编辑重发（user 消息）：截断到该消息之前 → 用新文本重新 startStream
  //   - 重试（assistant 消息）：回溯到最近的 user 消息 → 截断 → 重发其文本
  // 截断走 sessionsClient.truncateMessages（与 chat 同一后端端点）。
  // team 暂不支持「新建会话重试 / 分支」（无分支会话概念），故 onRetryBranch /
  // onCreateBranchFromHistoryEdit 回退为「在当前会话重发」。
  const [historyEditPrompt, setHistoryEditPrompt] = useState<HistoryEditPromptInput | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<RetryPromptInput | null>(null);

  const truncateAndResend = useCallback(
    async (sourceMessageId: string, text: string, inputParts?: InputImageContent[]) => {
      // 流式中不允许重试/编辑重发（与正常提交一致的 busy 保护）。
      if (state.streaming) {
        state.setStreamError('正在生成回复，请等待当前回复完成后再重试。');
        return;
      }
      if (gatewayUrl && token) {
        try {
          const sessionsClient = createSessionsClient(gatewayUrl);
          const remaining = await sessionsClient.truncateMessages(
            token,
            sessionId,
            sourceMessageId,
          );
          state.setMessages(normalizeChatMessages(remaining));
        } catch (err) {
          console.warn(
            '[TeamConversationView] truncate failed, resend without truncation:',
            err instanceof Error ? err.message : err,
          );
        }
      }
      // 重发也走统一路由（与正常提交一致，避免在 clarifying 环节误绕过 inbound）。
      await dispatchTeamText(text, inputParts);
    },
    [gatewayUrl, sessionId, state, token, dispatchTeamText],
  );

  const handleResendHistoryEdit = useCallback(
    (text: string, editedInputParts?: unknown[]) => {
      if (!historyEditPrompt) return;
      void truncateAndResend(
        historyEditPrompt.messageId,
        text,
        editedInputParts as InputImageContent[] | undefined,
      );
      setHistoryEditPrompt(null);
    },
    [historyEditPrompt, truncateAndResend],
  );

  const handleContinueHistoryEdit = useCallback(
    (text: string) => {
      // 「追加到末尾」：不截断，直接作为新一条发送（同样走统一路由）。
      void dispatchTeamText(text);
      setHistoryEditPrompt(null);
    },
    [dispatchTeamText],
  );

  const handleRetryCurrent = useCallback(() => {
    if (!retryPrompt) return;
    void truncateAndResend(
      retryPrompt.messageId,
      retryPrompt.text,
      retryPrompt.inputParts as InputImageContent[] | undefined,
    );
    setRetryPrompt(null);
  }, [retryPrompt, truncateAndResend]);

  const handleComposerModelSelect = useCallback(
    async (providerId: string, modelId: string) => {
      state.setActiveProviderId(providerId);
      state.setActiveModelId(modelId);
    },
    [state],
  );

  // 找某条消息对应的「重试源」：assistant 消息 → 向上回溯到最近 user 消息。
  const findRetrySource = useCallback(
    (messageId: string): { id: string; text: string; inputParts?: InputImageContent[] } | null => {
      const idx = state.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return null;
      for (let i = idx; i >= 0; i--) {
        const m = state.messages[i];
        if (m && m.role === 'user') {
          return { id: m.id, text: m.content };
        }
      }
      return null;
    },
    [state.messages],
  );

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
   * 把消息列表 group 成 ChatRenderGroup[]，喂给 TeamConversationLayout 内部的
   * ChatMessageGroupList 渲染（与 chat 端视觉一致）。
   *
   * 相比早期「最简路径」，现在补齐了与 chat 对齐的两类能力：
   *   1. 每个 assistant 组首注入团队角色身份头（多级角色展示）。
   *   2. 每条消息注入 hover actions：复制 / 编辑重试（user）/ 重试（assistant）。
   *      仅在 composerEnabled（可交互）时注入编辑/重试，避免只读视图出现无效按钮。
   */
  const buildEntryActions = useCallback(
    (message: ChatMessage): ChatRenderEntry['actions'] => {
      const actions: NonNullable<ChatRenderEntry['actions']> = [
        {
          id: 'copy',
          label: '复制',
          title: '复制此消息',
          onClick: () => {
            void copyExportToClipboard([message], 'text');
          },
        },
      ];
      if (composerEnabled) {
        if (message.role === 'user') {
          actions.push({
            id: 'edit-retry',
            label: '编辑重试',
            title: '编辑这条消息并从此处重新发送',
            onClick: () => {
              const inputParts = Array.isArray(message.rawContent)
                ? (message.rawContent.filter(
                    (p) => (p as { type?: string }).type === 'input_image',
                  ) as unknown[])
                : undefined;
              setRetryPrompt(null);
              setHistoryEditPrompt({
                messageId: message.id,
                text: message.content,
                ...(inputParts && inputParts.length > 0 ? { inputParts } : {}),
              });
            },
          });
        } else if (message.role === 'assistant') {
          actions.push({
            id: 'retry',
            label: '重试',
            title: '从最近一条用户消息重新生成',
            onClick: () => {
              const src = findRetrySource(message.id);
              if (!src) return;
              setHistoryEditPrompt(null);
              setRetryPrompt({
                messageId: src.id,
                text: src.text,
                ...(src.inputParts ? { inputParts: src.inputParts } : {}),
              });
            },
          });
        }
      }
      return actions;
    },
    [composerEnabled, findRetrySource],
  );

  const groupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    const entries: ChatRenderEntry[] = state.messages.map((message) => ({
      message,
      renderContent: (m) => renderChatMessageContentWithOptions(m),
      actions: buildEntryActions(message),
    }));
    const groups = groupChatRenderEntries(entries);

    // team 多级角色展示：给每个「assistant 消息组」的首条注入角色身份头
    // （彩色头像点 + 层级名 + 代号），让用户一眼看出是哪一层在说话，使 team 对话
    // 在视觉上彻底区别于普通 chat。
    //   - 覆盖全部已知层（含 reception 主对话——它本就是接待层在说话，标注准确且
    //     让默认界面脱离纯 chat 观感）。
    //   - roleLayer 缺失（null/未知）时不注入：拿不到层级信息，避免臆造身份。
    //   - 只在组首注入，相邻同层消息不重复刷头；user 组不注入（那是用户自己）。
    if (!state.roleLayer) {
      return groups;
    }
    const layer = state.roleLayer;
    return groups.map((group) => {
      if (group.role !== 'assistant') return group;
      const [firstEntry, ...rest] = group.entries;
      if (!firstEntry) return group;
      const wrappedFirst: ChatRenderEntry = {
        ...firstEntry,
        renderContent: (m) => (
          <>
            <TeamMessageRoleHeader roleLayer={layer} />
            {firstEntry.renderContent(m)}
          </>
        ),
      };
      return { ...group, entries: [wrappedFirst, ...rest] };
    });
  }, [state.messages, state.roleLayer, buildEntryActions]);

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

  // 用户输入条数 —— 驱动右侧「用户输入快捷跳转」控件（<=1 条时控件自隐）。
  const userMessageCount = useMemo(
    () => state.messages.filter((m) => m.role === 'user').length,
    [state.messages],
  );

  // canStopCurrentSessionStream: true while the user is actively streaming
  // through THIS hook (gatewayClient runs internally) — gives the composer a
  // working "stop" button.
  const canStopCurrentSessionStream = composerEnabled && state.streaming;

  return (
    <>
      {state.roleLayer === 'reception' ? (
        <TeamInitModal sessionId={sessionId} sessionMetadata={state.sessionMetadata} />
      ) : null}
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
            <TeamUserJumpRail
              scrollRegionRef={state.scrollRegionRef}
              userCount={userMessageCount}
              onPrev={handleScrollToPrevUser}
              onNext={handleScrollToNextUser}
            />
          }
          anchorConversationToBottom
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
          streamError={state.streamError ?? state.snapshotError ?? state.providersError}
          onDismissStreamError={() => {
            state.setStreamError(null);
            state.setSnapshotError(null);
            state.setProvidersError(null);
          }}
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
          historyEditPrompt={historyEditPrompt}
          onCloseHistoryEdit={() => setHistoryEditPrompt(null)}
          onResendHistoryEdit={handleResendHistoryEdit}
          onContinueHistoryEdit={handleContinueHistoryEdit}
          onCreateBranchFromHistoryEdit={handleResendHistoryEdit}
          retryPrompt={retryPrompt}
          onCloseRetry={() => setRetryPrompt(null)}
          onRetryCurrent={handleRetryCurrent}
          onRetryBranch={handleRetryCurrent}
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
          onComposerModelSelect={handleComposerModelSelect}
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
