import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../store/auth';
import { useGatewayClient } from '../hooks/useGatewayClient';
import { createSessionsClient } from '@openAwork/web-client';
import { extractRuntimeTextDelta } from '../chat-message-content.js';
import type { AgentActivity } from '../components/AgentActivityPanel';
import { AgentActivityPanel } from '../components/AgentActivityPanel';
import { MobileVoiceRecorder } from '../components/MobileVoiceRecorder';
import { MobileAttachmentBar } from '../components/MobileAttachmentBar';
import type { MobileAttachmentItem } from '../components/MobileAttachmentBar';
import type { DialogueMode } from '../components/DialogueModeSelector';
import {
  DialogueModeSelector,
  applyDialogueModeToMessage,
} from '../components/DialogueModeSelector';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface ChatScreenProps {
  sessionId: string;
}

interface ArtifactRecord {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  preview?: string;
  createdAt?: number;
}

export function ChatScreen({ sessionId }: ChatScreenProps) {
  const { accessToken, gatewayUrl } = useAuthStore();
  const { stream, disconnect } = useGatewayClient(gatewayUrl, accessToken);
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const [attachments, setAttachments] = useState<MobileAttachmentItem[]>([]);
  const [artifactHistory, setArtifactHistory] = useState<MobileAttachmentItem[]>([]);
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('coding');
  const listRef = useRef<FlatList>(null);

  const loadArtifactHistory = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/artifacts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { artifacts?: ArtifactRecord[] };
      setArtifactHistory(
        [...(data.artifacts ?? [])]
          .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
          .map((artifact) => ({
            id: artifact.id,
            artifactId: artifact.id,
            name: artifact.name,
            mimeType: artifact.mimeType,
            type: artifact.mimeType?.startsWith('image/')
              ? 'image'
              : artifact.mimeType?.startsWith('audio/')
                ? 'audio'
                : 'file',
            sizeBytes: artifact.sizeBytes ?? 0,
          })),
      );
    } catch {
      void 0;
    }
  }, [accessToken, gatewayUrl, sessionId]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const session = await createSessionsClient(gatewayUrl).get(accessToken, sessionId);
        if (cancelled) return;
        const msgs: Message[] = (session.messages ?? []).map((m) => ({
          id: (m as { id?: string }).id ?? `hist-${Math.random()}`,
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content:
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? (m.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
                : '',
        }));
        setMessages(msgs);
      } catch {
        void 0;
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    void loadArtifactHistory();
    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl, loadArtifactHistory, sessionId]);

  const handleSend = useCallback(() => {
    void (async () => {
      const text = input.trim();
      if (!text || sending) return;
      const uploadedAttachmentLines: string[] = [];
      for (const attachment of attachments) {
        if (!attachment.uri || !accessToken) {
          uploadedAttachmentLines.push(`- ${attachment.name} (${attachment.type})`);
          continue;
        }
        try {
          const contentBase64 = await FileSystem.readAsStringAsync(attachment.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/artifacts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              contentBase64,
            }),
          });
          if (!res.ok) {
            uploadedAttachmentLines.push(`- ${attachment.name} (${attachment.type}, 上传失败)`);
            continue;
          }
          const data = (await res.json()) as {
            artifact?: { id: string; name: string; preview?: string; mimeType?: string };
          };
          uploadedAttachmentLines.push(
            data.artifact
              ? `- ${data.artifact.name} (artifact:${data.artifact.id})${data.artifact.preview ? `\n内容摘录:\n${data.artifact.preview}` : ''}`
              : `- ${attachment.name} (${attachment.type})`,
          );
        } catch {
          uploadedAttachmentLines.push(`- ${attachment.name} (${attachment.type}, 上传失败)`);
        }
      }
      const attachmentSummary =
        uploadedAttachmentLines.length > 0
          ? `\n\n[附件]\n${uploadedAttachmentLines.join('\n')}`
          : '';
      const finalText = applyDialogueModeToMessage(dialogueMode, `${text}${attachmentSummary}`);

      const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
      const assistantId = `a-${Date.now()}`;
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setActivities([]);
      setAttachments([]);
      setInput('');
      setSending(true);
      await loadArtifactHistory();

      stream(sessionId, finalText, {
        onDelta: (delta) => {
          const safeDelta = extractRuntimeTextDelta(delta);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + safeDelta } : m)),
          );
        },
        onDone: () => {
          setActivities((prev) =>
            prev.map((activity) =>
              activity.status === 'running' ? { ...activity, status: 'done' } : activity,
            ),
          );
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
          );
          setSending(false);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        },
        onError: (_code, message) => {
          setActivities((prev) =>
            prev.map((activity) =>
              activity.status === 'running' ? { ...activity, status: 'error' } : activity,
            ),
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: `错误：${message}`, streaming: false } : m,
            ),
          );
          setSending(false);
        },
        onActivity: (event) => {
          setActivities((prev) => {
            if (event.kind === 'tool_start') {
              if (prev.some((activity) => activity.id === event.id)) {
                return prev.map((activity) =>
                  activity.id === event.id
                    ? { ...activity, name: event.name, status: 'running' }
                    : activity,
                );
              }
              return [
                ...prev,
                {
                  id: event.id,
                  kind: 'tool',
                  name: event.name,
                  status: 'running',
                },
              ];
            }

            return prev.map((activity) =>
              activity.id === event.id
                ? {
                    ...activity,
                    name: event.name,
                    status: event.isError ? 'error' : 'done',
                  }
                : activity,
            );
          });
        },
      });
    })();
  }, [
    accessToken,
    attachments,
    dialogueMode,
    gatewayUrl,
    input,
    loadArtifactHistory,
    sending,
    sessionId,
    stream,
  ]);

  const handleStop = useCallback(() => {
    disconnect();
    setSending(false);
    setMessages((prev) =>
      prev.map((message) =>
        message.streaming
          ? { ...message, streaming: false, content: `${message.content}\n[已停止]` }
          : message,
      ),
    );
    setActivities((prev) =>
      prev.map((activity) =>
        activity.status === 'running'
          ? { ...activity, status: 'error', output: '用户已停止' }
          : activity,
      ),
    );
  }, [disconnect]);

  const handleAddAttachment = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setAttachments((prev) => [
        ...prev,
        ...result.assets.map((asset) => ({
          id: `att-${asset.uri}-${asset.name}`,
          name: asset.name,
          uri: asset.uri,
          mimeType: asset.mimeType ?? undefined,
          type: asset.mimeType?.startsWith('image/')
            ? ('image' as const)
            : asset.mimeType?.startsWith('audio/')
              ? ('audio' as const)
              : ('file' as const),
          sizeBytes: asset.size ?? 0,
        })),
      ]);
    } catch {
      void 0;
    }
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.toolbar}>
        <DialogueModeSelector mode={dialogueMode} onChange={setDialogueMode} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          historyLoading ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
          ) : (
            <Text style={styles.empty}>开始对话…</Text>
          )
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={styles.bubbleText}>
              {item.content}
              {item.streaming ? '▌' : ''}
            </Text>
          </View>
        )}
      />

      {activities.length > 0 ? <AgentActivityPanel activities={activities} /> : null}

      {showVoice ? (
        <MobileVoiceRecorder
          onTranscript={(text) => {
            setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
            setShowVoice(false);
          }}
          onClose={() => setShowVoice(false)}
        />
      ) : null}

      <MobileAttachmentBar
        attachments={attachments}
        onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
      />

      {artifactHistory.length > 0 ? (
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>已上传附件</Text>
          <MobileAttachmentBar attachments={artifactHistory} />
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleAddAttachment}>
          <Text style={styles.iconBtnText}>📎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowVoice(true)}>
          <Text style={styles.iconBtnText}>🎤</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="发送消息…"
          placeholderTextColor="#64748b"
          multiline
          editable={!sending}
        />
        {sending ? (
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: '#ef4444' }]}
            onPress={handleStop}
          >
            <Text style={styles.sendBtnText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            disabled={!input.trim()}
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  list: { padding: 12, paddingBottom: 4 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, fontSize: 14 },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 10, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#6366f1' },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  bubbleText: { color: '#f8fafc', fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 18 },
  historySection: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 6,
  },
  historyTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 12,
    marginBottom: 2,
  },
});
