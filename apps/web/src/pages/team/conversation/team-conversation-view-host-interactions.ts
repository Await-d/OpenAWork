/**
 * team-conversation-view-host-interactions · `<TeamConversationView/>` 的宿主交互绑定
 *
 *   - `useTeamConversationViewInteractions`：复制末条助手消息 / 用户消息跳转 /
 *     全局快捷键 / 视图模式切换 / 待处理交互定位。
 *   - `useTeamConversationViewComposerBridge`：starter chip 与 composer 之间的
 *     文本桥接，以及 window 级 composer 事件（reference / insert / templates / export）。
 *
 * 两个 hook 都在 `<TeamConversationView/>` 的原始位置调用，hook 顺序与拆分前一致。
 */

import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  copyExportToClipboard,
  downloadExport,
  exportMessages,
} from '../../../components/chat/message/message-export.js';
import type { UseMessageMultiSelectReturn } from '../../../components/chat/message/message-multi-select.js';
import type { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useChatKeyboardShortcuts } from '../../../hooks/chat/useChatKeyboardShortcuts.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  isComposerReferenceEvent,
} from '../../../utils/chat/composer-reference-events.js';
import type { ViewMode } from './extras/TeamViewModeToggle.js';
import { escapeCssAttributeValue } from './team-conversation-view-helpers.js';
import type { TeamConversationState } from './use-team-conversation-state.js';

export function useTeamConversationViewInteractions(input: {
  chatSearch: ReturnType<typeof useChatSearch>;
  clarificationPendingCount: number;
  composerEnabled: boolean;
  isNarrowLayout: boolean;
  multiSelect: UseMessageMultiSelectReturn;
  setShowTemplatePanel: Dispatch<SetStateAction<boolean>>;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  state: TeamConversationState;
}) {
  const {
    chatSearch,
    clarificationPendingCount,
    composerEnabled,
    isNarrowLayout,
    multiSelect,
    setShowTemplatePanel,
    setViewMode,
    state,
  } = input;

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
    [isNarrowLayout, setViewMode],
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

    if (clarificationPendingCount > 0 && typeof document !== 'undefined') {
      const clarificationPanel = document.querySelector<HTMLElement>(
        '[data-team-clarification-anchor="true"]',
      );
      if (clarificationPanel) {
        clarificationPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    state.scrollToBottom('smooth', 'latest-edge');
  }, [clarificationPendingCount, state]);

  const activePendingPermissionCount = useMemo(
    () => state.pendingPermissions.filter((permission) => permission.status === 'pending').length,
    [state.pendingPermissions],
  );

  return {
    activePendingPermissionCount,
    handleFocusPendingInteraction,
    handleScrollToNextUser,
    handleScrollToPrevUser,
    handleViewModeChange,
  };
}

export function useTeamConversationViewComposerBridge(input: {
  composerEnabled: boolean;
  messagesRef: { current: ChatMessage[] };
  setShowTemplatePanel: Dispatch<SetStateAction<boolean>>;
  state: TeamConversationState;
}) {
  const { composerEnabled, messagesRef, setShowTemplatePanel, state } = input;

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
  }, [composerEnabled, setShowTemplatePanel]);

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

  return { handleSelectStarter };
}
