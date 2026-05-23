/**
 * ChatPage 重试与历史编辑域 hook（域 E · Phase E）
 *
 * 聚合"重试 / 编辑历史消息"的状态与操作：
 * - `retryPrompt` / `historyEditPrompt` 弹窗状态
 * - `handleRetryInCurrentSession`：在当前会话截断后重发
 * - `handleEditResendInCurrentSession`：编辑后截断重发
 * - `handleRetryInNewSession`：分支到新会话后重发
 * - 内部工具：`truncateSessionMessagesInPlace`、`trimMessagesFromSource`
 *
 * 设计原则：
 *   1. 本 hook 不拥有 `sendMessage` / `createBranchSessionFromMessage` —
 *      它们由调用方注入（域 B 暴露后可改为从 B 导入）。
 *   2. `setMessages` / `resetStreamState` / `setStreamError` 同样注入。
 *   3. 弹窗状态（`retryPrompt` / `historyEditPrompt`）的 setter 也暴露,
 *      因为 `useChatMessageActions` 需要它们来触发弹窗。
 *
 * @see docs/architecture/chat-page-split-plan.md 域 E
 */

import { useCallback } from 'react';
import type { InputImageContent, Message } from '@openAwork/shared';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import { filterTranscriptMessages } from '../../../components/conversation-runtime/messages/transcript-visibility.js';
import type { HistoryEditPrompt, RetryPrompt } from './use-chat-message-actions.js';

export interface UseChatRetryAndEditOptions {
  gatewayUrl: string;
  token: string | null;
  currentSessionId: string | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  resetStreamState: () => void;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  /** 重试弹窗状态（由父组件拥有,因为 useChatMessageActions 也需要 setter）。 */
  retryPrompt: RetryPrompt | null;
  setRetryPrompt: React.Dispatch<React.SetStateAction<RetryPrompt | null>>;
  /** 编辑弹窗状态（由父组件拥有,因为 useChatMessageActions 也需要 setter）。 */
  historyEditPrompt: HistoryEditPrompt | null;
  /**
   * 发送消息的核心函数（域 B 暴露）。
   * 重试 / 编辑后截断消息列表,然后调用此函数重新发送。
   */
  sendMessage: (
    text: string,
    options?: {
      existingInputParts?: InputImageContent[];
      forcedSessionId?: string;
    },
  ) => Promise<unknown>;
  /**
   * 从当前消息创建分支会话（域 A 暴露）。
   * 用于"在新会话中重试"场景。
   */
  createBranchSessionFromMessage: (
    text: string,
    sourceMessageId: string,
    inputParts?: InputImageContent[],
  ) => Promise<string | undefined>;
}

export interface ChatRetryAndEdit {
  // ─── 操作 ────────────────────────────────────────────────────────────
  /** 在当前会话中截断到源消息后重发。 */
  handleRetryInCurrentSession: () => Promise<void>;
  /** 编辑后截断到源消息后重发。 */
  handleEditResendInCurrentSession: (
    text: string,
    sourceMessageId: string,
    editedInputParts?: InputImageContent[],
  ) => Promise<void>;
  /** 分支到新会话后重发。 */
  handleRetryInNewSession: () => Promise<void>;

  // ─── 工具回调（也可被外部使用） ────────────────────────────────────────
  /** 调用后端截断消息列表（inclusive）。 */
  truncateSessionMessagesInPlace: (
    sessionId: string,
    messageId: string,
    messageText?: string,
  ) => Promise<Message[]>;
  /** 本地截断消息列表到 sourceMessageId 之前。 */
  trimMessagesFromSource: <TMessage extends { id: string }>(
    sourceMessages: TMessage[],
    sourceMessageId: string,
  ) => TMessage[];
}

export function useChatRetryAndEdit(options: UseChatRetryAndEditOptions): ChatRetryAndEdit {
  const {
    gatewayUrl,
    token,
    currentSessionId,
    messages,
    setMessages,
    resetStreamState,
    setStreamError,
    retryPrompt,
    setRetryPrompt,
    historyEditPrompt,
    sendMessage,
    createBranchSessionFromMessage,
  } = options;

  // ── 工具回调 ──────────────────────────────────────────────────────────
  const truncateSessionMessagesInPlace = useCallback(
    async (sessionId: string, messageId: string, messageText?: string): Promise<Message[]> => {
      if (!token) return [];
      return createSessionsClient(gatewayUrl).truncateMessages(token, sessionId, messageId, {
        inclusive: true,
        ...(messageText !== undefined ? { messageText } : {}),
      });
    },
    [gatewayUrl, token],
  );

  const trimMessagesFromSource = useCallback(
    <TMessage extends { id: string }>(
      sourceMessages: TMessage[],
      sourceMessageId: string,
    ): TMessage[] => {
      const sourceIndex = sourceMessages.findIndex((message) => message.id === sourceMessageId);
      return sourceIndex >= 0 ? sourceMessages.slice(0, sourceIndex) : sourceMessages;
    },
    [],
  );

  // ── 重试 / 编辑操作 ───────────────────────────────────────────────────
  const handleRetryInCurrentSession = useCallback(async () => {
    if (!retryPrompt) return;
    if (!currentSessionId || !token) return;
    const remainingMessages = await truncateSessionMessagesInPlace(
      currentSessionId,
      retryPrompt.sourceMessageId,
      retryPrompt.text,
    );
    const normalizedRemainingMessages = filterTranscriptMessages(
      normalizeChatMessages(remainingMessages),
    );
    const fallbackMessages = trimMessagesFromSource(messages, retryPrompt.sourceMessageId);
    const sourceFoundLocally =
      messages.findIndex((message) => message.id === retryPrompt.sourceMessageId) >= 0;
    const nextMessages = sourceFoundLocally
      ? fallbackMessages
      : normalizedRemainingMessages.length > 0
        ? normalizedRemainingMessages
        : fallbackMessages;
    setMessages(nextMessages);
    resetStreamState();
    setStreamError(null);
    await sendMessage(retryPrompt.text, {
      ...(retryPrompt.inputParts ? { existingInputParts: retryPrompt.inputParts } : {}),
    });
    setRetryPrompt(null);
  }, [
    currentSessionId,
    messages,
    resetStreamState,
    retryPrompt,
    sendMessage,
    setMessages,
    setStreamError,
    token,
    trimMessagesFromSource,
    truncateSessionMessagesInPlace,
  ]);

  const handleEditResendInCurrentSession = useCallback(
    async (text: string, sourceMessageId: string, editedInputParts?: InputImageContent[]) => {
      if (!currentSessionId || !token) return;
      const sourceMessage = messages.find((message) => message.id === sourceMessageId);
      const remainingMessages = await truncateSessionMessagesInPlace(
        currentSessionId,
        sourceMessageId,
        sourceMessage?.content,
      );
      const normalizedRemainingMessages = filterTranscriptMessages(
        normalizeChatMessages(remainingMessages),
      );
      const fallbackMessages = trimMessagesFromSource(messages, sourceMessageId);
      const sourceFoundLocally =
        messages.findIndex((message) => message.id === sourceMessageId) >= 0;
      const nextMessages = sourceFoundLocally
        ? fallbackMessages
        : normalizedRemainingMessages.length > 0
          ? normalizedRemainingMessages
          : fallbackMessages;
      setMessages(nextMessages);
      resetStreamState();
      setStreamError(null);
      const effectiveInputParts = editedInputParts ?? historyEditPrompt?.inputParts;
      await sendMessage(text, {
        ...(effectiveInputParts ? { existingInputParts: effectiveInputParts } : {}),
      });
    },
    [
      currentSessionId,
      historyEditPrompt,
      messages,
      resetStreamState,
      sendMessage,
      setMessages,
      setStreamError,
      token,
      trimMessagesFromSource,
      truncateSessionMessagesInPlace,
    ],
  );

  const handleRetryInNewSession = useCallback(async () => {
    if (!retryPrompt) return;
    if (retryPrompt.inputParts && retryPrompt.inputParts.length > 0) {
      await createBranchSessionFromMessage(
        retryPrompt.text,
        retryPrompt.sourceMessageId,
        retryPrompt.inputParts,
      );
    } else {
      const branchSessionId = await createBranchSessionFromMessage(
        retryPrompt.text,
        retryPrompt.sourceMessageId,
      );
      if (!branchSessionId) return;
      await sendMessage(retryPrompt.text, { forcedSessionId: branchSessionId });
    }
    setRetryPrompt(null);
  }, [createBranchSessionFromMessage, retryPrompt, sendMessage]);

  return {
    handleRetryInCurrentSession,
    handleEditResendInCurrentSession,
    handleRetryInNewSession,

    truncateSessionMessagesInPlace,
    trimMessagesFromSource,
  };
}
