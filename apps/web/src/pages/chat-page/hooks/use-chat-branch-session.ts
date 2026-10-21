import { useCallback } from 'react';
import type { InputImageContent } from '@openAwork/shared';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import { filterTranscriptMessages } from '../../../components/conversation-runtime/messages/transcript-visibility.js';
import { createSessionMetadataSnapshot } from '../conversation/render/chat-page-utils.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
import { reuploadOversizedInlineImages } from './reupload-oversized-input-images.js';

export interface UseChatBranchSessionOptions {
  token: string | null;
  gatewayUrl: string;
  currentSessionId: string | null;
  activeSessionRef: React.MutableRefObject<string | null>;
  pendingBootstrapSessionRef: React.MutableRefObject<string | null>;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clearSessionMetadataDirty: () => void;
  buildSessionMetadata: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  lastPersistedSessionMetadataSnapshotRef: React.MutableRefObject<string | null>;
  setSessionModesHydrated: React.Dispatch<React.SetStateAction<boolean>>;
  resetStreamState: () => void;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  focusComposerWithText: (text: string) => void;
  requestSessionListRefresh: () => void;
  navigateToSession: (sessionId: string) => void;
  sendMessage: (
    text: string,
    options?: { existingInputParts?: InputImageContent[]; forcedSessionId?: string },
  ) => Promise<unknown>;
}

export function useChatBranchSession(options: UseChatBranchSessionOptions) {
  const {
    token,
    gatewayUrl,
    currentSessionId,
    activeSessionRef,
    pendingBootstrapSessionRef,
    setCurrentSessionId,
    setMessages,
    clearSessionMetadataDirty,
    buildSessionMetadata,
    lastPersistedSessionMetadataSnapshotRef,
    setSessionModesHydrated,
    resetStreamState,
    setStreamError,
    focusComposerWithText,
    requestSessionListRefresh,
    navigateToSession,
    sendMessage,
  } = options;

  const createBranchSessionFromMessage = useCallback(
    async (text: string, sourceMessageId: string, inputParts?: InputImageContent[]) => {
      if (!token) return;
      const originSessionId = activeSessionRef.current;
      const sessionsClient = createSessionsClient(gatewayUrl);
      // 用 `get()`（`GET /sessions/:id`）取**完整转录**，而不是 `getRecovery`。
      //
      // 这些消息会被 `importSession` 持久化成新会话的权威历史，必须与存储一致：
      // `/recovery` 会对 tool 输出做瘦身（单字段截断 + 64KB 字节上限），拿它建分支
      // 等于把截断副本写回库，且不可逆。`/sessions/:id` 是完整转录的正规通道。
      //
      // 注意 `get()` 不返回 recovery 才有的 `activeStream` / `runEvents` / `todos`；
      // 这里只消费 `.messages`，故无影响。若将来要取这些字段，需另走 recovery。
      const baseSession = currentSessionId
        ? await sessionsClient.get(token, currentSessionId)
        : null;
      const baseMessages = Array.isArray(baseSession?.messages) ? baseSession.messages : [];
      const sourceIndex = baseMessages.findIndex((message) => message.id === sourceMessageId);
      const truncatedMessages = (sourceIndex >= 0 ? baseMessages.slice(0, sourceIndex) : []).map(
        (message) => ({
          ...message,
          id: makeOrderedMessageId(),
        }),
      );

      const imported = await sessionsClient.importSession(token, {
        messages: truncatedMessages,
      });
      const branchMetadata = buildSessionMetadata({
        editSourceMessageId: sourceMessageId,
        ...(currentSessionId ? { parentSessionId: currentSessionId } : {}),
      });
      await sessionsClient.updateMetadata(token, imported.sessionId, branchMetadata);
      // 下面三个 ref 都是 hook 参数（共享 ref 池）：直接写 .current 属「修改 hook
      // 参数」，会让本 hook 退出 React Compiler 优化（见 utils/ref/ref-current.ts）。
      writeRefCurrent(
        lastPersistedSessionMetadataSnapshotRef,
        createSessionMetadataSnapshot(buildSessionMetadata()),
      );

      if (activeSessionRef.current !== originSessionId) {
        return;
      }

      writeRefCurrent(activeSessionRef, imported.sessionId);
      writeRefCurrent(pendingBootstrapSessionRef, imported.sessionId);
      setCurrentSessionId(imported.sessionId);
      setMessages(filterTranscriptMessages(normalizeChatMessages(truncatedMessages)));
      clearSessionMetadataDirty();
      setSessionModesHydrated(true);
      resetStreamState();
      setStreamError(null);

      if (inputParts && inputParts.length > 0) {
        requestSessionListRefresh();
        navigateToSession(imported.sessionId);
        const resendInputParts = await reuploadOversizedInlineImages({
          gatewayUrl,
          inputParts,
          sessionId: imported.sessionId,
          token,
        });
        await sendMessage(text, {
          existingInputParts: resendInputParts,
          forcedSessionId: imported.sessionId,
        });
      } else {
        focusComposerWithText(text);
        requestSessionListRefresh();
        navigateToSession(imported.sessionId);
      }

      return imported.sessionId;
    },
    [
      activeSessionRef,
      buildSessionMetadata,
      clearSessionMetadataDirty,
      currentSessionId,
      focusComposerWithText,
      gatewayUrl,
      lastPersistedSessionMetadataSnapshotRef,
      navigateToSession,
      pendingBootstrapSessionRef,
      requestSessionListRefresh,
      resetStreamState,
      sendMessage,
      setCurrentSessionId,
      setMessages,
      setSessionModesHydrated,
      setStreamError,
      token,
    ],
  );

  return { createBranchSessionFromMessage };
}
