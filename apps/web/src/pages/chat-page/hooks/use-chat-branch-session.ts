import { useCallback } from 'react';
import type { InputImageContent } from '@openAwork/shared';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import { filterTranscriptMessages } from '../../../components/conversation-runtime/messages/transcript-visibility.js';
import { createSessionMetadataSnapshot } from '../conversation/render/chat-page-utils.js';

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
      const baseRecovery = currentSessionId
        ? await sessionsClient.getRecovery(token, currentSessionId)
        : null;
      const baseSession = baseRecovery?.session ?? null;
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
      lastPersistedSessionMetadataSnapshotRef.current =
        createSessionMetadataSnapshot(buildSessionMetadata());

      if (activeSessionRef.current !== originSessionId) {
        return;
      }

      activeSessionRef.current = imported.sessionId;
      pendingBootstrapSessionRef.current = imported.sessionId;
      setCurrentSessionId(imported.sessionId);
      setMessages(filterTranscriptMessages(normalizeChatMessages(truncatedMessages)));
      clearSessionMetadataDirty();
      setSessionModesHydrated(true);
      resetStreamState();
      setStreamError(null);

      if (inputParts && inputParts.length > 0) {
        requestSessionListRefresh();
        navigateToSession(imported.sessionId);
        await sendMessage(text, {
          existingInputParts: inputParts,
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
