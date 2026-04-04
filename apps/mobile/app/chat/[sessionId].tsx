import { useState, useEffect, useRef, useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useAuthStore } from '../../src/store/auth';
import { ChatMessageBubble } from '../../src/components/chat-message-bubble.js';
import type { MobileChatMessage } from '../../src/chat-message-content.js';
import { normalizeMobileChatMessages } from '../../src/chat-message-content.js';
import {
  buildChatRouteHistoryLocalHydrationState,
  buildChatRouteHistoryReadyState,
  buildChatRouteHistoryResetState,
} from '../../src/chat-route-history-state.js';
import { shouldApplyChatSessionMutation } from '../../src/hooks/chat-stream-guard.js';
import { useChatStreamState } from '../../src/hooks/use-chat-stream-state.js';
import { getSession, upsertSession, saveDraft } from '../../src/db/session-store';

const DRAFT_SAVE_DEBOUNCE_MS = 500;

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const navigation = useNavigation();
  const { accessToken, gatewayUrl } = useAuthStore();

  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const latestSessionIdRef = useRef(sessionId);

  const { replaceMessages, renderedMessages, sendMessage, streaming } = useChatStreamState({
    accessToken,
    gatewayUrl,
    sessionId,
  });

  useEffect(() => {
    latestSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const canApplySessionMutation = useCallback(
    (requestSessionId: string | undefined) =>
      shouldApplyChatSessionMutation({
        currentSessionId: latestSessionIdRef.current,
        mounted: isMountedRef.current,
        requestSessionId,
      }),
    [],
  );

  const applyHistoryState = useCallback(
    (nextState: { input: string; loadingHistory: boolean; messages: MobileChatMessage[] }) => {
      setInput(nextState.input);
      setLoadingHistory(nextState.loadingHistory);
      replaceMessages(nextState.messages);
    },
    [replaceMessages],
  );

  useEffect(() => {
    navigation.setOptions({ title: 'Chat' });
  }, [navigation]);

  useEffect(() => {
    if (!sessionId) {
      applyHistoryState(buildChatRouteHistoryResetState({ hasSessionId: false }));
      return;
    }

    applyHistoryState(buildChatRouteHistoryResetState({ hasSessionId: true }));
    const requestSessionId = sessionId;

    async function loadMessages() {
      const local = await getSession(requestSessionId);
      if (!canApplySessionMutation(requestSessionId)) {
        return;
      }

      let nextInput = '';
      let nextMessages: MobileChatMessage[] = [];

      if (local) {
        const cached = normalizeMobileChatMessages(JSON.parse(local.messages_json) as unknown[]);
        const nextState = buildChatRouteHistoryLocalHydrationState({
          draft: local.draft,
          messages: cached,
        });
        nextInput = nextState.input;
        nextMessages = nextState.messages;
        applyHistoryState(nextState);
      }

      if (!accessToken) {
        if (canApplySessionMutation(requestSessionId)) {
          applyHistoryState(
            buildChatRouteHistoryReadyState({
              input: nextInput,
              messages: nextMessages,
            }),
          );
        }
        return;
      }
      try {
        const session = await createSessionsClient(gatewayUrl).get(
          accessToken ?? '',
          requestSessionId,
        );
        if (!canApplySessionMutation(requestSessionId)) {
          return;
        }
        const remote = normalizeMobileChatMessages(session.messages ?? []);
        nextMessages = remote;
        applyHistoryState(
          buildChatRouteHistoryReadyState({
            input: nextInput,
            messages: remote,
          }),
        );
        await upsertSession({
          id: requestSessionId,
          title: session.title ?? null,
          messages_json: JSON.stringify(remote),
          draft: local?.draft ?? '',
          created_at: local?.created_at ?? Date.now(),
          updated_at: Date.now(),
        });
      } catch (error) {
        console.warn('Failed to load remote session messages', error);
      } finally {
        if (canApplySessionMutation(requestSessionId)) {
          applyHistoryState(
            buildChatRouteHistoryReadyState({
              input: nextInput,
              messages: nextMessages,
            }),
          );
        }
      }
    }

    void loadMessages();
  }, [accessToken, applyHistoryState, canApplySessionMutation, gatewayUrl, sessionId]);

  const handleInputChange = useCallback(
    (text: string) => {
      setInput(text);
      if (!sessionId) return;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        void saveDraft(sessionId, text);
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [sessionId],
  );

  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  const handleSendMessage = useCallback(() => {
    if (!sessionId) {
      return;
    }

    const didSend = sendMessage(input);
    if (!didSend) {
      return;
    }

    setInput('');
    void saveDraft(sessionId, '');
  }, [input, sendMessage, sessionId]);

  if (loadingHistory) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={renderedMessages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✦</Text>
            <Text style={styles.emptyText}>Start a conversation</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isStreaming = item.id === '__streaming__';
          return <ChatMessageBubble isStreaming={isStreaming} message={item} />;
        }}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={handleInputChange}
          placeholder="Message…"
          placeholderTextColor="#64748b"
          multiline
          editable={!streaming}
          returnKeyType="send"
          onSubmitEditing={handleSendMessage}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || streaming) && styles.sendButtonDisabled]}
          onPress={handleSendMessage}
          disabled={!input.trim() || streaming}
        >
          {streaming ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendButtonText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 32, color: '#6366f1', marginBottom: 10 },
  emptyText: { color: '#64748b', fontSize: 15 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 4 : 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#0f172a',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#f8fafc',
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
