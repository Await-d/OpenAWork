import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { DialogueMode } from '@openAwork/shared';

import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { resolveNewSessionWorkspace } from '../../../utils/session/new-session-workspace.js';

type UseChatComposerShortcutsDeps = {
  readonly currentSessionId: string | null;
  readonly handleEditRetryMessage: (message: ChatMessage) => void;
  readonly handleRetryMessage: (messageId: string) => void;
  readonly messages: ChatMessage[];
  readonly navigate: (to: string) => void | Promise<void>;
  readonly selectedSshConnectionId: string | null;
  readonly selectedWorkspacePath: string | null;
  readonly setDialogueMode: (mode: DialogueMode) => void;
  readonly setInput: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * 输入框的快捷写入与「新建会话」编排，以及消息列表上的「重试 / 编辑上一条」入口。
 *
 * 从 `ChatPage` 下沉：这些动作只依赖输入框状态、路由与消息列表，不涉及流式状态机。
 */
export function useChatComposerShortcuts(deps: UseChatComposerShortcutsDeps) {
  const {
    currentSessionId,
    handleEditRetryMessage,
    handleRetryMessage,
    messages,
    navigate,
    selectedSshConnectionId,
    selectedWorkspacePath,
    setDialogueMode,
    setInput,
    textareaRef,
  } = deps;

  const focusComposerWithText = useCallback(
    (text: string) => {
      setInput(text);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        const caret = text.length;
        textareaRef.current.setSelectionRange(caret, caret);
      });
      // 把 textareaRef（useChatUiState 返回的 ref）列入依赖：编译器要求 memo 内
      // 用到的 ref 在依赖里可查；ref 身份稳定，行为不变。
    },
    [setInput, textareaRef],
  );

  /**
   * 欢迎页「新建会话」：把当前视图复位为空白草稿并聚焦输入框，不立即在服务端
   * 创建空会话——真正的会话在首条消息发出时才落库，因此连续点击不会堆积空对话。
   *
   * 草稿工作区按「点击来源」继承当前上下文：已有会话取 store 里已解析的工作区
   * 绑定（含父会话链 / SSH，与 useWorkspace 同源），尚未解析时回落当前全局选中值
   * （不能把「未知」当成「未绑定」而误清）；草稿态沿用当前草稿工作区。
   */
  const handleStartNewSession = useCallback(() => {
    setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
    focusComposerWithText('');
    const resolvedWorkspace = resolveNewSessionWorkspace({
      contextSessionId: currentSessionId,
      activeSessionWorkspace: useUIStateStore.getState().activeSessionWorkspace,
      fallbackWorkspacePath: selectedWorkspacePath,
      // 全局选中工作区的「路径 + 连接」是成对的，路径回落时连接必须一起回落：
      // 在远端工作区里点 ⌘N 时漏掉这一步，新会话会以裸路径落库。
      fallbackSshConnectionId: selectedSshConnectionId,
    });
    useUIStateStore
      .getState()
      .openDraftSession(resolvedWorkspace.workspacePath, resolvedWorkspace.sshConnectionId);
    if (currentSessionId) {
      void navigate('/chat');
    }
  }, [
    currentSessionId,
    focusComposerWithText,
    navigate,
    selectedSshConnectionId,
    selectedWorkspacePath,
    setDialogueMode,
  ]);

  const appendTextToComposer = useCallback(
    (text: string) => {
      setInput((previous) => {
        const separator = previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
        return `${previous}${separator}${text}`;
      });
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        const caret = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(caret, caret);
      });
      // 同上：textareaRef 列入依赖，满足编译器对既有 memo 的依赖校验。
    },
    [setInput, textareaRef],
  );

  const handleEditPreviousUserMessage = useCallback(() => {
    const previousUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!previousUserMessage) {
      return;
    }
    handleEditRetryMessage(previousUserMessage);
  }, [handleEditRetryMessage, messages]);

  const handleRetryLastFailedTurn = useCallback(() => {
    // Prefer the most recent assistant error / cancelled message as the
    // retry target; fall back to the latest user turn.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      if (
        message.role === 'assistant' &&
        (message.status === 'error' ||
          message.status === 'cancelled' ||
          message.stopReason === 'error' ||
          message.stopReason === 'cancelled')
      ) {
        handleRetryMessage(message.id);
        return;
      }
    }
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUser) {
      handleRetryMessage(lastUser.id);
    }
  }, [handleRetryMessage, messages]);

  return {
    appendTextToComposer,
    focusComposerWithText,
    handleEditPreviousUserMessage,
    handleRetryLastFailedTurn,
    handleStartNewSession,
  };
}
