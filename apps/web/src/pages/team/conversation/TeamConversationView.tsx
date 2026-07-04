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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { canConfigureThinkingForModel, categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import { LatestAssistantMessageContext } from '../../../components/chat/message/collapsible-assistant-content.js';
import type {
  ChatRenderAction,
  ChatRenderGroup,
} from '../../../components/chat/message/chat-message-group-list.js';
import type { UnifiedComposerSubmitPayload } from '../../../components/chat/composer/UnifiedComposer.js';
import type { HistoryEditPromptInput, RetryPromptInput } from './TeamConversationLayout.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  dismissPermissionEventMessage,
  hasActivePendingPermissionRequest,
  normalizeChatMessages,
} from '../../../components/conversation-runtime/messages/support.js';
import { prepareStandardChatSendInput } from '../../chat-page/conversation/composer/prepare-standard-chat-send-input.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { PendingPermissionRequest, PermissionDecision } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type { InputImageContent } from '@openAwork/shared';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useChatKeyboardShortcuts } from '../../../hooks/chat/useChatKeyboardShortcuts.js';
import { useComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useMessageMultiSelect } from '../../../components/chat/message/message-multi-select.js';
import {
  copyExportToClipboard,
  downloadExport,
  exportMessages,
} from '../../../components/chat/message/message-export.js';
import { PromptTemplatePanel } from '../../../components/chat/misc/prompt-template-panel.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { TeamConversationLayout } from './TeamConversationLayout.js';
import { TeamSubstateProgressBar } from './extras/TeamSubstateProgressBar.js';
import { TeamRunStateBanner } from './extras/TeamRunStateBanner.js';
import { TeamSessionEmptyState } from './extras/TeamSessionEmptyState.js';
import { TeamSessionHeader } from './extras/TeamSessionHeader.js';
import { TeamUserJumpRail } from './extras/TeamUserJumpRail.js';
import { TeamRoleTypingIndicator } from './extras/TeamRoleTypingIndicator.js';
import { TeamInitModal } from './extras/TeamInitModal.js';
import { TeamPendingInteractionChip } from './extras/TeamPendingInteractionChip.js';
import { TeamRunEventsPreview } from './extras/TeamRunEventsPreview.js';
import {
  TeamViewModeToggle,
  type ViewMode,
  type MultiLayerViewMode,
} from './extras/TeamViewModeToggle.js';
import { type LayerMessages } from './extras/TeamMultiLayerPanel.js';
import { TeamLayerChatPanel } from './extras/TeamLayerChatPanel.js';
import { useTeamConversationState } from './use-team-conversation-state.js';
import { resolveTeamSubmitStrategy } from './submit/team-submit-router.js';
import { buildTeamGroupedMessageEntries } from './build-team-grouped-message-entries.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  isComposerReferenceEvent,
} from '../../../utils/chat/composer-reference-events.js';
import {
  getPermissionReplyStatusCode,
  getPermissionReplySuccessMessage,
} from '../../../utils/permission/permission-reply.js';
import { useTeamRuntimeReferenceViewData } from '../runtime/data/team-runtime-reference-data.js';

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
}

const TEAM_CONVERSATION_LAYER_ORDER = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'tester',
  'reviewer',
] as const;

function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

async function disabledComposerAsyncAction(): Promise<void> {
  return Promise.resolve();
}

function disabledComposerAction(): void {
  return undefined;
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
  onOpenLayerSession,
}: TeamConversationViewProps) {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';
  const { diagnostics } = useTeamRuntimeReferenceViewData();

  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [multiLayerMode, setMultiLayerMode] = useState<MultiLayerViewMode>('tab');
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
    setMultiLayerMode('tab');
    setSelectedLayer(focusedLayer);
    setShowTemplatePanel(false);
    hasAutoOpenedMultiLayerRef.current = false;
    multiSelect.disableMultiSelect();
    chatSearch.close();
  }, [sessionId, focusedLayer, multiSelect, chatSearch]);

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

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode === 'dual' && isNarrowLayout ? 'single' : mode);
    },
    [isNarrowLayout],
  );

  const handleFocusPendingInteraction = useCallback(() => {
    const firstPendingPermissionRequestId = state.pendingPermissions.find(
      (permission) => permission.status === 'pending',
    )?.requestId;
    if (firstPendingPermissionRequestId && typeof document !== 'undefined') {
      const targetApprovalBar = document.querySelector<HTMLElement>(
        `[data-permission-request-id="${escapeCssAttributeValue(firstPendingPermissionRequestId)}"]`,
      );
      if (targetApprovalBar) {
        targetApprovalBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    if (
      state.pendingQuestions.some((question) => question.status === 'pending') &&
      typeof document !== 'undefined'
    ) {
      const firstPendingQuestionRequestId = state.pendingQuestions.find(
        (question) => question.status === 'pending',
      )?.requestId;
      const questionPanel = firstPendingQuestionRequestId
        ? document.querySelector<HTMLElement>(
            `[data-question-request-id="${escapeCssAttributeValue(firstPendingQuestionRequestId)}"]`,
          )
        : document.querySelector<HTMLElement>('.inline-question-panel');
      if (questionPanel) {
        questionPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    state.scrollToBottom('smooth', 'latest-edge');
  }, [state]);

  const activePendingPermissionCount = useMemo(
    () => state.pendingPermissions.filter((permission) => permission.status === 'pending').length,
    [state.pendingPermissions],
  );
  const activePendingQuestionCount = useMemo(
    () => state.pendingQuestions.filter((question) => question.status === 'pending').length,
    [state.pendingQuestions],
  );

  // 默认 topBar：
  //   - reception 层：显示「团队整体运行状态」横幅（TeamRunStateBanner，自聚合
  //     handoff/连接/活动信号；无任何 handoff 时自渲染为 null）。它解决了
  //     「提交需求后看不出团队是在跑/卡住/异常停」的可观测性缺口。reception 会话
  //     自身常回 idle，原来的 substate 进度条对 reception 没意义，故不再用它。
  //   - 其它层（pm1/pm2/executor/reviewer）：保留 substate 进度条（对单层有意义）。
  const effectiveTopBar = (
    <>
      {topBar ??
        (state.roleLayer === 'reception' ? (
          <TeamRunStateBanner
            diagnostics={diagnostics}
            receptionStateStatus={state.sessionStateStatus}
            sessionId={sessionId}
            rightSlot={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TeamPendingInteractionChip
                  pendingPermissionCount={activePendingPermissionCount}
                  pendingQuestionCount={activePendingQuestionCount}
                  onClick={handleFocusPendingInteraction}
                />
                <TeamViewModeToggle
                  viewMode={viewMode}
                  multiLayerMode={multiLayerMode}
                  dualDisabled={isNarrowLayout}
                  onViewModeChange={handleViewModeChange}
                  onMultiLayerModeChange={setMultiLayerMode}
                />
              </div>
            }
          />
        ) : (
          <TeamSubstateProgressBar
            roleLayer={state.roleLayer}
            substate={state.substate}
            stateStatus={state.sessionStateStatus}
            rightSlot={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <TeamPendingInteractionChip
                  pendingPermissionCount={activePendingPermissionCount}
                  pendingQuestionCount={activePendingQuestionCount}
                  onClick={handleFocusPendingInteraction}
                />
                <TeamViewModeToggle
                  viewMode={viewMode}
                  multiLayerMode={multiLayerMode}
                  dualDisabled={isNarrowLayout}
                  onViewModeChange={handleViewModeChange}
                  onMultiLayerModeChange={setMultiLayerMode}
                />
              </div>
            }
          />
        ))}
    </>
  );

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

  const appendTextToComposer = useCallback(
    (text: string) => {
      state.setInput((previous) => {
        const separator = previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
        return `${previous}${separator}${text}`;
      });
      requestAnimationFrame(() => {
        const textarea = state.textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        const caret = textarea.value.length;
        try {
          textarea.setSelectionRange(caret, caret);
        } catch {
          // 某些 textarea 可能不支持 setSelectionRange，忽略。
        }
      });
    },
    [state],
  );

  useEffect(() => {
    if (!composerEnabled) {
      return;
    }

    const handleComposerReference = (event: Event) => {
      if (!isComposerReferenceEvent(event)) {
        return;
      }

      appendTextToComposer(event.detail.text);
    };

    window.addEventListener(COMPOSER_REFERENCE_EVENT_NAME, handleComposerReference);
    return () => {
      window.removeEventListener(COMPOSER_REFERENCE_EVENT_NAME, handleComposerReference);
    };
  }, [appendTextToComposer, composerEnabled]);

  useEffect(() => {
    if (!composerEnabled || typeof window === 'undefined') {
      return;
    }

    const handleOpenTemplates = () => setShowTemplatePanel(true);
    const handleExportChat = () => {
      const content = exportMessages(messagesRef.current, 'markdown');
      downloadExport(content, `team-chat-export-${Date.now()}.md`, 'text/markdown');
    };

    window.addEventListener('openAwork:open-templates', handleOpenTemplates);
    window.addEventListener('openAwork:export-chat', handleExportChat);
    return () => {
      window.removeEventListener('openAwork:open-templates', handleOpenTemplates);
      window.removeEventListener('openAwork:export-chat', handleExportChat);
    };
  }, [composerEnabled]);

  useEffect(() => {
    if (!composerEnabled || typeof window === 'undefined') {
      return;
    }

    const handleComposerInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: 'append' | 'replace'; text?: string }>).detail;
      const insertText = detail?.text;
      if (typeof insertText !== 'string' || insertText.length === 0) {
        return;
      }

      state.setInput((previous) => {
        if (detail?.mode === 'replace') {
          return insertText;
        }
        if (previous.trim().length === 0) {
          return insertText;
        }
        return `${previous.trimEnd()}\n${insertText}`;
      });
      requestAnimationFrame(() => state.textareaRef.current?.focus());
    };

    window.addEventListener('openawork:composer:insert', handleComposerInsert);
    return () => {
      window.removeEventListener('openawork:composer:insert', handleComposerInsert);
    };
  }, [composerEnabled, state]);

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

  // ─── 统一文本派发（提交路由 D5 决策：按 roleLayer/substate 选 inbound / stream）──
  // 抽成可复用单元，让「正常提交 / 编辑重发 / 重试 / 追加」都走同一条路由，避免
  // 编辑重试在 clarifying 环节误绕过 inbound 通道。
  //   - clarifying → inbound:user_input（带 questionId 的 clarification_answer 由任务 tab 处理）
  //   - reception → inbound:user_input（触发团队自动编排）
  //   - 其它 → stream（普通 chat 风格 session）
  const dispatchTeamText = useCallback(
    async (text: string, inputParts?: InputImageContent[]): Promise<boolean> => {
      // 每次新的派发尝试先清除上一轮的错误提示，避免旧错误遮挡新内容。
      state.setStreamError(null);
      const strategy = resolveTeamSubmitStrategy(state.roleLayer, state.substate);

      if (strategy.kind === 'inbound') {
        if (strategy.messageType === 'user_input') {
          // user_input 对 reception 根会话必须走 inbound：这是团队自动派发链的入口。
          // 若这里失败再偷偷回退到 stream，会把请求重新送回接待层自己回答，等于绕过
          // team-inbound → reception-orchestrator → pm1/... 整条分层链路。
          // clarifying 下的普通 composer 同样不应回退到 stream，否则会绕过 c runner。
          try {
            await state.submitInbound(strategy.messageType, { text } as never);
            await state.reload();
            // inbound 提交成功后，后端会 fire-and-forget 启动后台流
            // （reception-orchestrator 的 direct 路径调用 runSessionInBackground）。
            // 尝试 attach 到该后台流，以获取逐 token 的流式回复展示。
            // attach 失败（如走了 orchestrate 路径无活跃流）不会影响流程，
            // 前端仍会通过 team-events + 轮询刷新消息。
            // 使用 await 而非 void：确保 streamingRef.current 在返回前被设置，
            // 避免"快速双击回车→第二条消息绕过 streaming 守卫"的竞态。
            await state.attachToSessionStream();
            return true;
          } catch (err) {
            const message = err instanceof Error ? err.message : '提交输入失败';
            if (state.roleLayer === 'reception' || state.substate === 'clarifying') {
              console.warn('[TeamConversationView] team inbound submit failed:', message);
              state.setStreamError(
                state.substate === 'clarifying'
                  ? `输入提交失败，请重试：${message}`
                  : `需求提交失败，请重试：${message}`,
              );
              return false;
            }
            console.warn(
              '[TeamConversationView] user_input inbound submit failed, falling back to stream:',
              message,
            );
          }
        } else {
          console.warn(
            '[TeamConversationView] inbound messageType not yet supported:',
            strategy.messageType,
          );
        }
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
          state.setStreamError(`附件上传失败，消息未发送（请重试或移除附件后重发）：${message}`);
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
  // team 暂不支持「新建会话重试 / 分支」（无分支会话概念），因此不再向弹窗暴露
  // 对应入口，只保留「当前会话重发 / 追加到末尾」两种真实可用动作。
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
  const [inlinePermissionPendingDecision, setInlinePermissionPendingDecision] = useState<{
    decision: PermissionDecision;
    requestId: string;
  } | null>(null);
  const [inlinePermissionErrors, setInlinePermissionErrors] = useState<Record<string, string>>({});
  const [selectedPermissionScopeLevels, setSelectedPermissionScopeLevels] = useState<
    Record<string, AlwaysScopeLevel>
  >({});
  const activePendingQuestion = state.pendingQuestions[0] ?? null;
  const activeQuestionIdRef = useRef<string | null>(null);
  const pendingPermissionsById = useMemo(
    () => new Map(state.pendingPermissions.map((permission) => [permission.requestId, permission])),
    [state.pendingPermissions],
  );

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
          { targetSessionId: activePendingQuestion.sessionId },
        );
        setInlineQuestionReplyStatus(status);
      } catch (err) {
        setInlineQuestionReplyError(err instanceof Error ? err.message : '回复失败');
      }
    },
    [activePendingQuestion, inlineQuestionAnswers, inlineQuestionCustomInputs, state],
  );

  const handleInlinePermissionDecision = useCallback(
    async (request: PendingPermissionRequest, decision: PermissionDecision) => {
      setInlinePermissionPendingDecision({
        decision,
        requestId: request.requestId,
      });
      setInlinePermissionErrors((previous) => {
        const next = { ...previous };
        delete next[request.requestId];
        return next;
      });

      const selectedScopeLevel =
        selectedPermissionScopeLevels[request.requestId] ??
        categorizeAlwaysPatterns(request.previewAction, request.scope, request.always).at(-1);
      const alwaysOverride =
        decision !== 'once' && decision !== 'reject' && selectedScopeLevel
          ? [selectedScopeLevel.pattern]
          : undefined;

      try {
        await state.replyPermission(request.requestId, decision, {
          ...(alwaysOverride ? { alwaysOverride } : {}),
          targetSessionId: request.sessionId,
        });
        setInlinePermissionErrors((previous) => {
          const next = { ...previous };
          delete next[request.requestId];
          return next;
        });
        state.setMessages((previous) =>
          dismissPermissionEventMessage(
            applyPermissionDecisionToLocalAssistantMessages(previous, request.requestId, decision),
            request.requestId,
          ),
        );
        toast(
          getPermissionReplySuccessMessage(decision),
          decision === 'reject' ? 'warning' : 'success',
          2200,
        );
      } catch (error) {
        const status = getPermissionReplyStatusCode(error);
        const errorMessage = error instanceof Error ? error.message : '权限处理失败，请重试。';
        if (status === 404 || status === 409) {
          state.setPendingPermissions((previous) =>
            previous.filter((permission) => permission.requestId !== request.requestId),
          );
          toast('该权限请求已被处理或已过期，已重新同步。', 'warning', 3000);
          return;
        }
        setInlinePermissionErrors((previous) => ({
          ...previous,
          [request.requestId]: errorMessage,
        }));
      } finally {
        setInlinePermissionPendingDecision((current) =>
          current?.requestId === request.requestId ? null : current,
        );
      }
    },
    [selectedPermissionScopeLevels, state],
  );

  const resolveInlinePermissionActions = useCallback(
    (requestId: string) => {
      const request = pendingPermissionsById.get(requestId);
      if (!request) {
        return undefined;
      }

      const pendingDecision =
        inlinePermissionPendingDecision?.requestId === requestId
          ? inlinePermissionPendingDecision.decision
          : null;
      const disabled = pendingDecision !== null;
      const scopeLevels = categorizeAlwaysPatterns(
        request.previewAction,
        request.scope,
        request.always,
      );
      const selectedScopeLevel =
        selectedPermissionScopeLevels[requestId] ?? scopeLevels[scopeLevels.length - 1];

      return {
        items: [
          {
            id: 'session',
            label: pendingDecision === 'session' ? '处理中…' : '本会话允许',
            disabled,
            hint: '仅在当前会话内记住这次授权选择，适合继续当前任务。',
            primary: true,
            onClick: () => void handleInlinePermissionDecision(request, 'session'),
          },
          {
            id: 'once',
            label: pendingDecision === 'once' ? '处理中…' : '允许一次',
            disabled,
            hint: '只批准当前这一次工具调用，不保留后续授权。',
            onClick: () => void handleInlinePermissionDecision(request, 'once'),
          },
          {
            id: 'permanent',
            label: pendingDecision === 'permanent' ? '处理中…' : '永久允许',
            disabled,
            hint: '会记住后续同类请求，请在充分确认风险后再使用。',
            onClick: () => void handleInlinePermissionDecision(request, 'permanent'),
          },
          {
            id: 'reject',
            label: pendingDecision === 'reject' ? '处理中…' : '拒绝',
            danger: true,
            disabled,
            hint: '阻止本次调用，工具不会继续执行。',
            onClick: () => void handleInlinePermissionDecision(request, 'reject'),
          },
        ],
        pendingLabel: pendingDecision
          ? '正在提交审批结果…'
          : '推荐：本会话允许 · 临时：允许一次 · 持久：永久允许',
        helperMessage: pendingDecision ? undefined : '永久允许会记住后续同类请求，请谨慎选择。',
        errorMessage: inlinePermissionErrors[requestId],
        scopeLevels,
        selectedScopeCategory: selectedScopeLevel?.category,
        selectedScopePattern: selectedScopeLevel?.pattern,
        onSelectScopeLevel: (level: AlwaysScopeLevel) => {
          setSelectedPermissionScopeLevels((previous) => ({
            ...previous,
            [requestId]: level,
          }));
        },
      };
    },
    [
      handleInlinePermissionDecision,
      inlinePermissionErrors,
      inlinePermissionPendingDecision,
      pendingPermissionsById,
      selectedPermissionScopeLevels,
    ],
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
    (message: ChatMessage): ChatRenderAction[] => {
      if (readOnly) {
        return [];
      }
      const actions: ChatRenderAction[] = [
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
    [composerEnabled, findRetrySource, readOnly],
  );

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
  const providerCatalog = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: string }>();
    for (const provider of state.providers) {
      map.set(provider.id, { id: provider.id, name: provider.name, type: provider.type });
    }
    return map;
  }, [state.providers]);

  const activeProvider = useMemo(
    () => state.providers.find((provider) => provider.id === state.activeProviderId),
    [state.activeProviderId, state.providers],
  );
  const activeModelOption = useMemo(
    () => activeProvider?.defaultModels.find((model) => model.id === state.activeModelId),
    [activeProvider, state.activeModelId],
  );
  const activeModelCanConfigureThinking = canConfigureThinkingForModel(
    activeProvider?.type,
    activeModelOption?.id ?? state.activeModelId,
  );
  const activeModelTooltip = activeModelOption?.label
    ? `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}`
    : activeProvider?.name
      ? `当前使用提供商：${activeProvider.name}`
      : '当前使用模型';

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

  useEffect(() => {
    setSelectedLayer(focusedLayer);
  }, [focusedLayer, sessionId]);

  const multiLayerMessages = useMemo<LayerMessages[]>(() => {
    // 按角色实例（session）独立分组，不再把同层多个角色实例的消息合并。
    // 每个角色实例（如"前端开发者"、"后端开发者"）各自成为一个 LayerMessages 条目，
    // 用户可以在群聊汇总面板中分别看到每个角色的完整对话。
    const entries: LayerMessages[] = [];

    // 当前 session 自身作为一个条目
    const currentLayer = state.roleLayer?.trim() || 'reception';

    // 当主对话处于流式状态时，构建一条流式占位消息注入汇总面板，
    // 让用户在群聊汇总中也能实时看到"正在输入"的流式回复。
    let streamingMessage: ChatMessage | null = null;
    if (state.visibleStreaming) {
      streamingMessage = {
        id: 'team-layer-streaming-assistant',
        role: 'assistant',
        content: state.streamBuffer.trim().length > 0 ? state.streamBuffer : '团队正在处理中…',
        ...(state.streamingSegments.length > 0 ? { parts: state.streamingSegments } : {}),
        ...(state.roleLayer ? { agentId: state.roleLayer } : {}),
        createdAt: Date.now(),
        status: 'streaming',
      };
    }

    entries.push({
      layer: currentLayer,
      messages: [...state.messages],
      sessionIds: [sessionId],
      isActive: true,
      displayName: null,
      streamingMessage,
    });

    // soloMode 下不包含子 session，只展示当前角色自身的消息
    if (!soloMode && Array.isArray(state.childSessions)) {
      for (const child of state.childSessions) {
        const childLayer = child.role_layer?.trim() || 'reception';
        entries.push({
          layer: childLayer,
          messages: [...child.messages],
          sessionIds: [child.id],
          isActive: false,
          displayName: child.displayName ?? null,
        });
      }
    }

    return entries;
  }, [
    sessionId,
    soloMode,
    state.childSessions,
    state.messages,
    state.roleLayer,
    state.visibleStreaming,
    state.streamBuffer,
    state.streamingSegments,
  ]);

  /** 是否有任何消息（包括当前层级自身）—— 有消息就自动展开左侧群聊汇总面板。 */
  const hasAnyMessages = useMemo(
    () => multiLayerMessages.some((layer) => layer.messages.length > 0),
    [multiLayerMessages],
  );
  const defaultDetailLayer = useMemo(
    () =>
      multiLayerMessages.find((layer) => !layer.isActive && layer.messages.length > 0)?.layer ??
      null,
    [multiLayerMessages],
  );

  useEffect(() => {
    if (readOnly || hasAutoOpenedMultiLayerRef.current || compact || viewMode !== 'single') return;
    // 有任何层级消息就自动展开左侧群聊汇总面板（不再要求必须有其它层级消息）
    if (!hasAnyMessages) return;
    if (isNarrowLayout) return;
    hasAutoOpenedMultiLayerRef.current = true;
    setSelectedLayer((previous) => previous ?? defaultDetailLayer);
    setViewMode('dual');
  }, [compact, defaultDetailLayer, hasAnyMessages, isNarrowLayout, readOnly, viewMode]);

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

  const DUAL_LAYOUT_STYLE: CSSProperties = {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  };

  // 左侧：用户与接待的主对话区（dual 模式下占 45%）
  const MAIN_PANEL_STYLE: CSSProperties = {
    flex: viewMode === 'dual' ? '0 0 clamp(320px, 45%, 520px)' : '1 1 100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    transition: 'flex 200ms ease',
  };

  // 右侧：各层级对话交互消息汇总面板（dual 模式下占 55%）
  const SIDE_PANEL_STYLE: CSSProperties = {
    flex: viewMode === 'dual' ? '1 1 55%' : '0 0 0%',
    minWidth: 0,
    minHeight: 0,
    display: viewMode === 'dual' ? 'flex' : 'none',
    flexDirection: 'column',
    transition: 'flex 200ms ease',
    position: 'relative',
    overflow: 'hidden',
    borderLeft: '1px solid var(--border-default)',
  };

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
      <div style={soloMode ? { display: 'flex', flex: 1, minHeight: 0 } : DUAL_LAYOUT_STYLE}>
        {/* 左侧：用户与接待的对话 */}
        <div
          style={
            soloMode
              ? { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }
              : MAIN_PANEL_STYLE
          }
        >
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
                  的是哪个子 session。readOnly 模式下全部禁用。 */}
                  {state.roleLayer && state.roleLayer !== 'reception' && !readOnly ? (
                    <TeamSessionHeader
                      roleLayer={state.roleLayer}
                      substate={state.substate}
                      stateStatus={state.sessionStateStatus}
                      sessionMetadata={state.sessionMetadata}
                    />
                  ) : null}
                  {state.runEvents.length > 0 && !readOnly ? (
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
                composerEnabled ? handleComposerSubmit : disabledComposerAsyncAction
              }
              onStopComposer={composerEnabled ? handleStopStream : disabledComposerAsyncAction}
              onComposerModelSelect={handleComposerModelSelect}
              onToggleWebSearch={disabledComposerAction}
              onThinkingEnabledChange={state.setThinkingEnabled}
              onReasoningEffortChange={state.setReasoningEffort}
              onManualAgentChange={disabledComposerAction}
              onClearManualAgentId={disabledComposerAction}
              composerPlaceholder={effectivePlaceholder}
            />
          </LatestAssistantMessageContext>
        </div>
        {/* 右侧：所有层级的对话消息汇总（群聊式，层级标识清晰不混合） */}
        {/* soloMode 下不显示群聊面板，只展示当前角色自身的对话 */}
        {soloMode ? null : (
          <div aria-label="团队层级消息汇总" style={SIDE_PANEL_STYLE}>
            <TeamLayerChatPanel
              activeLayer={state.roleLayer}
              currentSessionId={sessionId}
              layers={multiLayerMessages}
              onOpenLayerSession={onOpenLayerSession ? handleOpenLayerSession : undefined}
              onLayerSelect={handlePanelLayerSelect}
            />
          </div>
        )}
      </div>
    </>
  );
}
