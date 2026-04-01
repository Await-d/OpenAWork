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
import { useGatewayClient } from '../../src/hooks/useGatewayClient';
import {
  normalizeMobileChatMessages,
  type MobileChatMessage,
} from '../../src/chat-message-content.js';
import {
  getSession,
  upsertSession,
  appendMessage as dbAppendMessage,
  saveDraft,
} from '../../src/db/session-store';

const DRAFT_SAVE_DEBOUNCE_MS = 500;

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const navigation = useNavigation();
  const { accessToken, gatewayUrl } = useAuthStore();

  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { stream } = useGatewayClient(gatewayUrl, accessToken);

  useEffect(() => {
    navigation.setOptions({ title: 'Chat' });
  }, [navigation]);

  useEffect(() => {
    if (!sessionId) return;

    async function loadMessages() {
      const local = await getSession(sessionId);
      if (local) {
        const cached = normalizeMobileChatMessages(JSON.parse(local.messages_json) as unknown[]);
        if (cached.length > 0) {
          setMessages(cached);
          setInput(local.draft);
        }
      }

      if (!accessToken) {
        setLoadingHistory(false);
        return;
      }
      try {
        const session = await createSessionsClient(gatewayUrl).get(
          accessToken ?? '',
          sessionId ?? '',
        );
        const remote = normalizeMobileChatMessages(session.messages ?? []);
        setMessages(remote);
        await upsertSession({
          id: sessionId,
          title: session.title ?? null,
          messages_json: JSON.stringify(remote),
          draft: local?.draft ?? '',
          created_at: local?.created_at ?? Date.now(),
          updated_at: Date.now(),
        });
      } catch (error) {
        console.warn('Failed to load remote session messages', error);
      } finally {
        setLoadingHistory(false);
      }
    }

    void loadMessages();
  }, [sessionId, accessToken, gatewayUrl]);

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

  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming || !sessionId) return;
    const text = input.trim();
    setInput('');
    void saveDraft(sessionId, '');
    setStreaming(true);
    setStreamBuffer('');

    const userMsg: MobileChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    void dbAppendMessage(sessionId, { id: userMsg.id, role: 'user', content: text });

    let accumulated = '';
    stream(sessionId, text, {
      onDelta: (delta) => {
        accumulated += delta;
        setStreamBuffer(accumulated);
      },
      onDone: () => {
        const assistantMsg: MobileChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulated,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        void dbAppendMessage(sessionId, {
          id: assistantMsg.id,
          role: 'assistant',
          content: accumulated,
        });
        setStreamBuffer('');
        setStreaming(false);
      },
      onError: (code) => {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: `[Error: ${code}]` },
        ]);
        setStreamBuffer('');
        setStreaming(false);
      },
    });
  }, [input, streaming, sessionId, stream]);

  const allItems: MobileChatMessage[] = streamBuffer
    ? [...messages, { id: '__streaming__', role: 'assistant', content: streamBuffer }]
    : messages;

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
        data={allItems}
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
          const isUser = item.role === 'user';
          const isStreaming = item.id === '__streaming__';
          return (
            <View
              style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble,
                isStreaming && styles.streamingBubble,
              ]}
            >
              <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
                {item.content}
                {isStreaming && <Text style={styles.cursor}>▋</Text>}
              </Text>
            </View>
          );
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
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || streaming) && styles.sendButtonDisabled]}
          onPress={sendMessage}
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
  bubble: {
    maxWidth: '80%',
    borderRadius: 14,
    padding: 12,
    paddingHorizontal: 14,
  },
  userBubble: {
    backgroundColor: '#6366f1',
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: '#1e293b',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
  },
  streamingBubble: {
    opacity: 0.85,
  },
  bubbleText: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 22,
  },
  userBubbleText: {
    color: '#fff',
  },
  cursor: {
    color: '#6366f1',
  },
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
