import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
  Alert,
  Share,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useAuthStore } from '../store/auth';
import { useGatewayClient } from '../hooks/useGatewayClient';
import { createArtifactsClient, createSessionsClient } from '@openAwork/web-client';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
} from '@openAwork/shared';
import type { InputImageContent } from '@openAwork/shared';
import {
  buildChatStreamToken,
  shouldApplyChatSessionMutation,
  shouldApplyChatStreamMutation,
} from '../hooks/chat-stream-guard.js';
import type { AgentActivity } from '../components/AgentActivityPanel';
import { AgentActivityPanel } from '../components/AgentActivityPanel';
import { MobileVoiceRecorder } from '../components/MobileVoiceRecorder';
import { MobileAttachmentBar } from '../components/MobileAttachmentBar';
import type { MobileAttachmentItem } from '../components/MobileAttachmentBar';
import { ChatMessageBubble } from '../components/chat-message-bubble';
import { MobileCompanionStage } from '../components/MobileCompanionStage';
import { MobileChatSearchBar } from '../components/MobileChatSearchBar';
import { ActionSheet } from '../components/ActionSheet';
import type { ActionSheetButton } from '../components/ActionSheet';
import type { DialogueMode } from '@openAwork/shared';
import { DialogueModeSelector } from '../components/DialogueModeSelector';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { reconcileTaskActivities } from './chat-task-activities.js';
import {
  buildChatScreenSessionResetState,
  buildChatScreenStaleSendAbortState,
} from './chat-screen-state.js';
import { createChatScreenGuardedStreamHandlers } from './chat-screen-stream-handlers.js';
import ExpoPersistenceAdapter, {
  DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  loadImageGenerationDefaults,
  type MobileImageGenerationDefaults,
} from '../store/providerPersistence';
import { normalizeMobileChatMessages, type MobileChatMessage } from '../chat-message-content.js';
import {
  buildChatDraftSummary,
  findChatMessageMatches,
  findPreviousUserMessage,
  getChatRestoreFocusLabel,
  insertMobilePromptTemplate,
  isNearChatBottom,
  MOBILE_PROMPT_TEMPLATES,
  moveChatSearchCursor,
  toInputImageParts,
} from './chat-message-actions.js';

interface Message extends MobileChatMessage {
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

interface UploadedMobileAttachment {
  artifactId: string;
  fileName: string;
  localUri?: string;
  mimeType?: string;
  preview?: string;
  type: MobileAttachmentItem['type'];
}

interface RetryableTextRequest {
  displayMessage: string;
  inputParts?: InputImageContent[];
  requestMessage: string;
  userContent: string;
  userInputImages?: Message['inputImages'];
}

export function ChatScreen({ sessionId }: ChatScreenProps) {
  const { accessToken, gatewayUrl } = useAuthStore();
  const { stream, disconnect } = useGatewayClient(gatewayUrl, accessToken);
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);
  const persistence = useMemo(() => new ExpoPersistenceAdapter(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(-1);
  const [showRestoreFocus, setShowRestoreFocus] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [attachments, setAttachments] = useState<MobileAttachmentItem[]>([]);
  const [artifactHistory, setArtifactHistory] = useState<MobileAttachmentItem[]>([]);
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('coding');
  const [imageGenerationMode, setImageGenerationMode] = useState(false);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageDefaults, setImageDefaults] = useState<MobileImageGenerationDefaults>(
    DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  );
  const [hasConfiguredImageModel, setHasConfiguredImageModel] = useState(false);
  const [imageModelLabel, setImageModelLabel] = useState('GPT Image 2 · OpenAI');
  const listRef = useRef<FlatList>(null);
  const isMountedRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const lastContentHeightRef = useRef(0);
  const latestSessionIdRef = useRef(sessionId);
  const streamRequestVersionRef = useRef(0);
  const activeStreamTokenRef = useRef<string | null>(null);
  const lastTextRequestRef = useRef<RetryableTextRequest | null>(null);
  const hasAppliedStoredImageDefaultsRef = useRef(false);
  const hasRunningSubagents = activities.some(
    (activity) => activity.kind === 'subagent' && activity.status === 'running',
  );
  const taskSyncIntervalMs = sending || hasRunningSubagents ? 1800 : 10000;
  const streamOptions = useMemo(() => ({ dialogueMode }), [dialogueMode]);
  const searchMatches = useMemo(
    () => findChatMessageMatches(messages, searchQuery),
    [messages, searchQuery],
  );
  const activeSearchMatch = searchMatches[activeSearchResultIndex] ?? null;
  const draftSummary = useMemo(
    () =>
      buildChatDraftSummary({
        attachmentCount: attachments.length,
        imageGenerationMode,
        text: input,
      }),
    [attachments.length, imageGenerationMode, input],
  );

  const applySessionResetState = useCallback(() => {
    const resetState = buildChatScreenSessionResetState<
      Message,
      AgentActivity,
      MobileAttachmentItem
    >();
    setHistoryLoading(resetState.historyLoading);
    setMessages(resetState.messages);
    setArtifactHistory(resetState.artifactHistory);
    setActivities(resetState.activities);
    setSending(resetState.sending);
    setStreamError(null);
    setSearchOpen(false);
    setSearchQuery('');
    setActiveSearchResultIndex(-1);
    setShowRestoreFocus(false);
    isNearBottomRef.current = true;
    lastContentHeightRef.current = 0;
  }, []);

  const clearSendingAfterStaleAbort = useCallback(() => {
    const nextState = buildChatScreenStaleSendAbortState({
      activities,
      artifactHistory,
      historyLoading,
      messages,
      sending,
    });
    setSending(nextState.sending);
  }, [activities, artifactHistory, historyLoading, messages, sending]);

  useEffect(() => {
    latestSessionIdRef.current = sessionId;
    streamRequestVersionRef.current += 1;
    activeStreamTokenRef.current = null;
    applySessionResetState();
  }, [applySessionResetState, sessionId]);

  useEffect(() => {
    let cancelled = false;

    const loadMobileImageSettings = async () => {
      const [config, storedImageDefaults] = await Promise.all([
        persistence.loadProviderConfig(),
        loadImageGenerationDefaults(),
      ]);

      if (cancelled) {
        return;
      }

      // Only seed image defaults from storage on first load. Re-applying on
      // every sessionId change would silently revert any size/quality/format/
      // background the user just adjusted in the image panel.
      if (!hasAppliedStoredImageDefaultsRef.current) {
        setImageDefaults(storedImageDefaults);
        hasAppliedStoredImageDefaultsRef.current = true;
      }
      const activeImage = config?.active.image;
      const provider = activeImage
        ? config?.providers.find((item) => item.id === activeImage.providerId)
        : undefined;
      const model = provider?.defaultModels.find((item) => item.id === activeImage?.modelId);
      const imageApiKey = activeImage ? await persistence.loadApiKey(activeImage.providerId) : null;
      setHasConfiguredImageModel(Boolean(provider && model && imageApiKey?.trim()));
      if (provider && model) {
        setImageModelLabel(`${model.label} · ${provider.name}`);
      }
    };

    void loadMobileImageSettings();

    return () => {
      cancelled = true;
    };
  }, [persistence, sessionId]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      streamRequestVersionRef.current += 1;
      activeStreamTokenRef.current = null;
    };
  }, []);

  useEffect(() => {
    setActiveSearchResultIndex(searchMatches.length > 0 ? 0 : -1);
  }, [searchMatches.length, searchQuery]);

  useEffect(() => {
    if (!activeSearchMatch) {
      return;
    }

    listRef.current?.scrollToIndex({
      animated: true,
      index: activeSearchMatch.index,
      viewPosition: 0.42,
    });
  }, [activeSearchMatch]);

  const canApplySessionMutation = useCallback(
    (requestSessionId: string | undefined) =>
      shouldApplyChatSessionMutation({
        currentSessionId: latestSessionIdRef.current,
        mounted: isMountedRef.current,
        requestSessionId,
      }),
    [],
  );

  const syncTaskActivities = useCallback(
    async (requestSessionId = sessionId): Promise<void> => {
      if (!accessToken) {
        return;
      }

      try {
        const tasks = await sessionsClient.getTasks(accessToken, requestSessionId);
        if (!canApplySessionMutation(requestSessionId)) {
          return;
        }
        setActivities((prev) => reconcileTaskActivities(prev, tasks));
      } catch (error) {
        console.warn('Failed to sync mobile task activities', error);
      }
    },
    [accessToken, canApplySessionMutation, sessionId, sessionsClient],
  );

  useEffect(() => {
    void syncTaskActivities();
  }, [syncTaskActivities]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let cancelled = false;
    const sync = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      await syncTaskActivities(sessionId);
    };

    void sync();
    const timer = setInterval(() => {
      void sync();
    }, taskSyncIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, sessionId, syncTaskActivities, taskSyncIntervalMs]);

  const loadArtifactHistory = useCallback(
    async (requestSessionId = sessionId) => {
      if (!accessToken) return;
      try {
        const data = (await createArtifactsClient(gatewayUrl).listForSession(
          accessToken,
          requestSessionId,
        )) as { artifacts?: ArtifactRecord[] };
        if (!canApplySessionMutation(requestSessionId)) {
          return;
        }
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
      } catch (error) {
        console.warn('Failed to load mobile artifact history', error);
      }
    },
    [accessToken, canApplySessionMutation, gatewayUrl, sessionId],
  );

  const uploadSelectedAttachments = useCallback(
    async (requestSessionId: string, selectedAttachments: MobileAttachmentItem[]) => {
      const uploaded: UploadedMobileAttachment[] = [];
      for (const attachment of selectedAttachments) {
        if (!attachment.uri || !accessToken) {
          continue;
        }

        try {
          const contentBase64 = await FileSystem.readAsStringAsync(attachment.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const data = (await createArtifactsClient(gatewayUrl).uploadToSession(
            accessToken,
            requestSessionId,
            {
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              contentBase64,
            },
          )) as {
            artifact?: { id: string; name: string; preview?: string; mimeType?: string };
          };
          if (!data.artifact?.id) {
            continue;
          }

          uploaded.push({
            artifactId: data.artifact.id,
            fileName: data.artifact.name,
            localUri: attachment.uri,
            mimeType: data.artifact.mimeType ?? attachment.mimeType,
            preview: data.artifact.preview,
            type: attachment.type,
          });
        } catch (error) {
          console.warn('Failed to upload mobile attachment', error);
        }
      }

      return uploaded;
    },
    [accessToken, gatewayUrl],
  );

  const generateImageForSession = useCallback(
    async (params: {
      inputArtifacts?: Array<{ artifactId: string; fileName?: string; mimeType?: string }>;
      prompt: string;
      requestSessionId: string;
    }) => {
      if (!accessToken) {
        throw new Error('当前未登录，无法生成图片。');
      }

      const payload = (await createArtifactsClient(gatewayUrl).generateImage(
        accessToken,
        params.requestSessionId,
        {
          ...(params.inputArtifacts ? { inputArtifacts: params.inputArtifacts } : {}),
          prompt: params.prompt,
          size: imageDefaults.size,
          quality: imageDefaults.quality,
          outputFormat: imageDefaults.outputFormat,
          background: imageDefaults.background,
        },
      )) as {
        artifact?: { id: string; title: string; type: 'image' };
        error?: { message?: string };
        messageSummary?: string;
        parameters?: { modelId?: string; providerId?: string };
        revisedPrompt?: string | null;
      };

      return payload;
    },
    [accessToken, gatewayUrl, imageDefaults],
  );

  useEffect(() => {
    applySessionResetState();
    if (!accessToken) {
      setHistoryLoading(false);
      return;
    }

    const requestSessionId = sessionId;
    void (async () => {
      try {
        const session = await createSessionsClient(gatewayUrl).get(accessToken, requestSessionId);
        if (!canApplySessionMutation(requestSessionId)) {
          return;
        }
        const msgs: Message[] = normalizeMobileChatMessages(session.messages ?? []);
        setMessages(msgs);
      } catch (error) {
        console.warn('Failed to load mobile chat history', error);
      } finally {
        if (canApplySessionMutation(requestSessionId)) {
          setHistoryLoading(false);
        }
      }
    })();
    void loadArtifactHistory(requestSessionId);
  }, [
    accessToken,
    applySessionResetState,
    canApplySessionMutation,
    gatewayUrl,
    loadArtifactHistory,
    sessionId,
  ]);

  const startTextStream = useCallback(
    async (draft: RetryableTextRequest, options: { appendUserMessage: boolean }) => {
      if (sending || imageGenerationBusy) {
        return;
      }

      const requestSessionId = sessionId;
      const assistantId = `a-${Date.now()}`;
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };

      setMessages((prev) => {
        if (!options.appendUserMessage) {
          return [...prev, assistantMsg];
        }

        const userMsg: Message = {
          id: `u-${Date.now()}`,
          role: 'user',
          content: draft.userContent,
          ...(draft.userInputImages && draft.userInputImages.length > 0
            ? { inputImages: draft.userInputImages }
            : {}),
        };

        return [...prev, userMsg, assistantMsg];
      });
      setActivities([]);
      setStreamError(null);
      setSending(true);
      lastTextRequestRef.current = draft;

      await loadArtifactHistory(requestSessionId);
      if (!canApplySessionMutation(requestSessionId)) {
        clearSendingAfterStaleAbort();
        return;
      }

      const requestVersion = streamRequestVersionRef.current + 1;
      streamRequestVersionRef.current = requestVersion;
      const requestToken = buildChatStreamToken(requestSessionId, requestVersion);
      activeStreamTokenRef.current = requestToken;

      const canApplyMutation = () =>
        shouldApplyChatStreamMutation({
          activeToken: activeStreamTokenRef.current,
          callbackToken: requestToken,
          currentSessionId: latestSessionIdRef.current,
          mounted: isMountedRef.current,
          requestSessionId,
        });

      const handlers = createChatScreenGuardedStreamHandlers<Message>({
        assistantId,
        canApplyMutation,
        clearActiveStreamToken: () => {
          activeStreamTokenRef.current = null;
        },
        requestSessionId,
        scheduleScrollToBottom: () => {
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        },
        setActivities,
        setMessages,
        setSending,
        setStreamError,
        syncTaskActivities,
      });

      stream(requestSessionId, draft.requestMessage, handlers, {
        ...streamOptions,
        displayMessage: draft.displayMessage,
        ...(draft.inputParts && draft.inputParts.length > 0
          ? { inputParts: draft.inputParts }
          : {}),
      });
    },
    [
      canApplySessionMutation,
      clearSendingAfterStaleAbort,
      imageGenerationBusy,
      loadArtifactHistory,
      sending,
      sessionId,
      stream,
      streamOptions,
      syncTaskActivities,
    ],
  );

  const handleSend = useCallback(() => {
    void (async () => {
      const text = input.trim();
      if ((!text && attachments.length === 0) || sending || imageGenerationBusy) return;
      const requestSessionId = sessionId;
      if (imageGenerationMode) {
        if (!hasConfiguredImageModel) {
          Alert.alert('图片模式未配置', '请先在设置中配置 OpenAI / GPT Image 2。');
          return;
        }

        const sizeValidation = validateImageGenerationSize(imageDefaults.size);
        if (!sizeValidation.valid) {
          Alert.alert('图片尺寸无效', sizeValidation.message ?? '请输入合法的自定义尺寸');
          return;
        }

        if (!text) {
          Alert.alert('缺少提示词', '请输入图片描述后再生成。');
          return;
        }

        const invalidAttachment = attachments.find((attachment) => attachment.type !== 'image');
        if (invalidAttachment) {
          Alert.alert('参考图格式不支持', '图片模式只支持图片作为参考图，请移除非图片附件。');
          return;
        }

        setImageGenerationBusy(true);
        try {
          const uploadedAttachments = await uploadSelectedAttachments(
            requestSessionId,
            attachments,
          );
          if (!canApplySessionMutation(requestSessionId)) {
            return;
          }

          const userMsg: Message = {
            id: `u-${Date.now()}`,
            role: 'user',
            content: text,
            ...(uploadedAttachments.length > 0
              ? {
                  inputImages: uploadedAttachments
                    .filter((attachment) => attachment.type === 'image')
                    .map((attachment) => ({
                      artifactId: attachment.artifactId,
                      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
                      ...(attachment.localUri ? { imageUrl: attachment.localUri } : {}),
                      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
                    })),
                }
              : {}),
          };
          setMessages((prev) => [...prev, userMsg]);
          setAttachments([]);
          setInput('');

          const payload = await generateImageForSession({
            ...(uploadedAttachments.length > 0
              ? {
                  inputArtifacts: uploadedAttachments
                    .filter((attachment) => attachment.type === 'image')
                    .map((attachment) => ({
                      artifactId: attachment.artifactId,
                      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
                      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
                    })),
                }
              : {}),
            prompt: text,
            requestSessionId,
          });

          if (!canApplySessionMutation(requestSessionId)) {
            return;
          }

          const summary =
            payload.revisedPrompt?.trim() && payload.revisedPrompt !== text
              ? `${payload.messageSummary}\n结果：${payload.artifact?.title ?? '图片结果'}\n提示词改写：${payload.revisedPrompt}\n已写入附件历史。`
              : `${payload.messageSummary}\n结果：${payload.artifact?.title ?? '图片结果'}\n已写入附件历史。`;
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content: summary,
            },
          ]);
          await loadArtifactHistory(requestSessionId);
          Alert.alert('已生成', '图片已生成，可在下方附件历史中查看。');
        } catch (error) {
          if (canApplySessionMutation(requestSessionId)) {
            Alert.alert('图片生成失败', error instanceof Error ? error.message : '请稍后重试');
          }
        } finally {
          if (canApplySessionMutation(requestSessionId)) {
            setImageGenerationBusy(false);
          }
        }
        return;
      }

      const uploadedAttachments = await uploadSelectedAttachments(requestSessionId, attachments);
      if (!canApplySessionMutation(requestSessionId)) {
        return;
      }

      const imageInputParts: InputImageContent[] = uploadedAttachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => ({
          type: 'input_image',
          artifactId: attachment.artifactId,
          ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        }));
      const attachmentSummary = uploadedAttachments
        .filter((attachment) => attachment.type !== 'image')
        .map((attachment) => `- ${attachment.fileName}（已附加文件）`);
      const requestMessage =
        attachmentSummary.length > 0 ? `${text}\n\n[附件]\n${attachmentSummary.join('\n')}` : text;
      const displayMessage =
        text.length > 0
          ? text
          : imageInputParts.length > 0
            ? `上传了 ${imageInputParts.length} 张图片`
            : requestMessage;

      const userInputImages = uploadedAttachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => ({
          artifactId: attachment.artifactId,
          ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
          ...(attachment.localUri ? { imageUrl: attachment.localUri } : {}),
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        }));
      setAttachments([]);
      setInput('');
      await startTextStream(
        {
          displayMessage,
          ...(imageInputParts.length > 0 ? { inputParts: imageInputParts } : {}),
          requestMessage,
          userContent: text,
          ...(userInputImages.length > 0 ? { userInputImages } : {}),
        },
        { appendUserMessage: true },
      );
    })();
  }, [
    accessToken,
    attachments,
    canApplySessionMutation,
    generateImageForSession,
    gatewayUrl,
    hasConfiguredImageModel,
    imageDefaults,
    imageGenerationBusy,
    imageGenerationMode,
    input,
    loadArtifactHistory,
    sending,
    sessionId,
    startTextStream,
    streamOptions,
    syncTaskActivities,
    uploadSelectedAttachments,
  ]);

  const handleStop = useCallback(() => {
    activeStreamTokenRef.current = null;
    streamRequestVersionRef.current += 1;
    disconnect();
    void syncTaskActivities();
    setSending(false);
    setStreamError(null);
    setMessages((prev) =>
      prev.map((message) =>
        message.streaming
          ? { ...message, streaming: false, content: `${message.content}\n[已停止]` }
          : message,
      ),
    );
    setActivities((prev) =>
      prev.map((activity) =>
        activity.kind !== 'subagent' && activity.status === 'running'
          ? { ...activity, status: 'error', output: '用户已停止' }
          : activity,
      ),
    );
  }, [disconnect, syncTaskActivities]);

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
    } catch (error) {
      console.warn('Failed to pick mobile attachment', error);
    }
  }, []);

  const clearComposerDraft = useCallback(() => {
    setInput('');
    setAttachments([]);
  }, []);

  const applyPromptTemplate = useCallback((templatePrompt: string) => {
    setInput((current) => insertMobilePromptTemplate(current, templatePrompt));
  }, []);

  const shareMessageText = useCallback(async (message: Message) => {
    const text = message.content.trim();
    if (!text) {
      Alert.alert('暂无可分享内容', '这条消息没有文本内容。');
      return;
    }

    try {
      await Share.share({ message: text });
    } catch (error) {
      Alert.alert('分享失败', error instanceof Error ? error.message : '无法打开系统分享面板');
    }
  }, []);

  const resendUserMessage = useCallback(
    async (message: Message) => {
      const text = message.content.trim();
      const inputParts = toInputImageParts(message);
      if (!text && inputParts.length === 0) {
        Alert.alert('无法重新发送', '这条消息没有可重新发送的内容。');
        return;
      }

      await startTextStream(
        {
          displayMessage: text || `上传了 ${inputParts.length} 张图片`,
          ...(inputParts.length > 0 ? { inputParts } : {}),
          requestMessage: text,
          userContent: text,
          ...(message.inputImages && message.inputImages.length > 0
            ? { userInputImages: message.inputImages }
            : {}),
        },
        { appendUserMessage: true },
      );
    },
    [startTextStream],
  );

  const regenerateAssistantMessage = useCallback(
    async (message: Message) => {
      const previousUserMessage = findPreviousUserMessage(messages, message.id);

      if (!previousUserMessage) {
        Alert.alert('无法重新生成', '没有找到这条回复对应的上一条用户消息。');
        return;
      }

      const inputParts = toInputImageParts(previousUserMessage);
      const text = previousUserMessage.content.trim();
      await startTextStream(
        {
          displayMessage: text || `上传了 ${inputParts.length} 张图片`,
          ...(inputParts.length > 0 ? { inputParts } : {}),
          requestMessage: text,
          userContent: text,
          ...(previousUserMessage.inputImages && previousUserMessage.inputImages.length > 0
            ? { userInputImages: previousUserMessage.inputImages }
            : {}),
        },
        { appendUserMessage: false },
      );
    },
    [messages, startTextStream],
  );

  const retryLastTextRequest = useCallback(async () => {
    const draft = lastTextRequestRef.current;
    if (!draft) {
      Alert.alert('暂无可重试内容', '当前会话还没有可重试的文本请求。');
      return;
    }

    await startTextStream(draft, { appendUserMessage: false });
  }, [startTextStream]);

  const moveSearchResult = useCallback(
    (direction: 'next' | 'previous') => {
      setActiveSearchResultIndex((current) =>
        moveChatSearchCursor(current, searchMatches.length, direction),
      );
    },
    [searchMatches.length],
  );

  const scrollToLatestMessage = useCallback((animated = true) => {
    isNearBottomRef.current = true;
    setShowRestoreFocus(false);
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const handleChatScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nearBottom = isNearChatBottom({
      contentHeight: event.nativeEvent.contentSize.height,
      offsetY: event.nativeEvent.contentOffset.y,
      viewportHeight: event.nativeEvent.layoutMeasurement.height,
    });
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setShowRestoreFocus(false);
    }
  }, []);

  const handleChatContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const previousHeight = lastContentHeightRef.current;
      const contentGrew = height > previousHeight;
      lastContentHeightRef.current = height;

      if (previousHeight === 0 || isNearBottomRef.current) {
        scrollToLatestMessage(false);
        return;
      }

      if (contentGrew && messages.length > 0) {
        setShowRestoreFocus(true);
      }
    },
    [messages.length, scrollToLatestMessage],
  );

  const selectedMessageActions: ActionSheetButton[] = useMemo(() => {
    if (!selectedMessage) {
      return [];
    }

    const actions: ActionSheetButton[] = [
      {
        label: '分享文本',
        onPress: () => {
          const message = selectedMessage;
          setSelectedMessage(null);
          void shareMessageText(message);
        },
        disabled: selectedMessage.content.trim().length === 0,
      },
    ];

    if (selectedMessage.role === 'user') {
      actions.push(
        {
          label: '编辑并重新发送',
          onPress: () => {
            setInput(selectedMessage.content);
            setSelectedMessage(null);
          },
          disabled: selectedMessage.content.trim().length === 0,
        },
        {
          label: '再次发送',
          onPress: () => {
            const message = selectedMessage;
            setSelectedMessage(null);
            void resendUserMessage(message);
          },
          disabled: sending || imageGenerationBusy,
        },
      );
    } else {
      actions.push({
        label: '重新生成',
        onPress: () => {
          const message = selectedMessage;
          setSelectedMessage(null);
          void regenerateAssistantMessage(message);
        },
        disabled: sending || imageGenerationBusy,
      });
    }

    actions.push({ label: '取消', variant: 'cancel', onPress: () => setSelectedMessage(null) });
    return actions;
  }, [
    imageGenerationBusy,
    regenerateAssistantMessage,
    resendUserMessage,
    selectedMessage,
    sending,
    shareMessageText,
  ]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.toolbar}>
        <DialogueModeSelector mode={dialogueMode} onChange={setDialogueMode} />
        <TouchableOpacity
          style={[styles.imageModeToggle, searchOpen && styles.searchToggleActive]}
          onPress={() => setSearchOpen((prev) => !prev)}
        >
          <Text style={[styles.imageModeToggleText, searchOpen && styles.searchToggleTextActive]}>
            搜索
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.imageModeToggle,
            imageGenerationMode && styles.imageModeToggleActive,
            !hasConfiguredImageModel && styles.imageModeToggleDisabled,
          ]}
          disabled={!hasConfiguredImageModel || sending || imageGenerationBusy}
          onPress={() => setImageGenerationMode((prev) => !prev)}
        >
          <Text
            style={[
              styles.imageModeToggleText,
              imageGenerationMode && styles.imageModeToggleTextActive,
            ]}
          >
            {imageGenerationMode ? '生图模式' : '图片模式'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.modeHintBar}>
        <Text style={styles.modeHintText}>
          当前：{draftSummary.modeLabel}
          {imageGenerationMode
            ? ' · 发送会调用图片生成，附件仅支持参考图'
            : ` · ${dialogueMode === 'clarify' ? '偏需求澄清' : dialogueMode === 'programmer' ? '偏工程协作' : '偏直接实现'}`}
        </Text>
      </View>

      {searchOpen ? (
        <MobileChatSearchBar
          activePosition={activeSearchResultIndex}
          matchCount={searchMatches.length}
          query={searchQuery}
          onChangeQuery={setSearchQuery}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery('');
          }}
          onNext={() => moveSearchResult('next')}
          onPrevious={() => moveSearchResult('previous')}
        />
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={handleChatContentSizeChange}
        onScroll={handleChatScroll}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({ animated: true, offset: Math.max(0, index * 96) });
        }}
        scrollEventThrottle={80}
        ListEmptyComponent={
          historyLoading ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
          ) : (
            <Text style={styles.empty}>开始对话…</Text>
          )
        }
        renderItem={({ item }) => (
          <ChatMessageBubble
            highlighted={activeSearchMatch?.messageId === item.id}
            isStreaming={item.streaming}
            message={item}
            onLongPress={() => setSelectedMessage(item)}
          />
        )}
      />

      {showRestoreFocus ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="恢复到最新对话"
          style={styles.restoreFocusButton}
          onPress={() => scrollToLatestMessage(true)}
        >
          <Text style={styles.restoreFocusText}>{getChatRestoreFocusLabel(sending)}</Text>
        </TouchableOpacity>
      ) : null}

      {activities.length > 0 ? <AgentActivityPanel activities={activities} /> : null}

      {streamError ? (
        <View style={styles.streamErrorBar}>
          <Text style={styles.streamErrorIcon}>!</Text>
          <Text style={styles.streamErrorText} numberOfLines={2}>
            {streamError}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="关闭流式错误提示"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            onPress={() => setStreamError(null)}
          >
            <Text style={styles.streamErrorDismiss}>知道了</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="重试上一次聊天请求"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            disabled={sending || imageGenerationBusy || !lastTextRequestRef.current}
            onPress={() => {
              void retryLastTextRequest();
            }}
          >
            <Text
              style={[
                styles.streamErrorRetry,
                (sending || imageGenerationBusy || !lastTextRequestRef.current) &&
                  styles.streamErrorRetryDisabled,
              ]}
            >
              重试
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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

      {imageGenerationMode ? (
        <View style={styles.imagePanel}>
          <Text style={styles.imagePanelTitle}>图片生成 / 编辑</Text>
          <Text style={styles.imagePanelText}>
            {hasConfiguredImageModel
              ? `当前模型：${imageModelLabel}`
              : '请先在设置中配置图片模型。'}
          </Text>
          <Text style={styles.imagePanelHint}>
            支持 1K / 2K / 4K 档位下的横图 / 方图 / 竖图预设，也可输入合法自定义尺寸。可附加 1
            张参考图。
          </Text>
          <View style={styles.imagePresetGroups}>
            {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
              <View key={group.tier} style={styles.imagePresetGroup}>
                <Text style={styles.imagePresetGroupTitle}>{group.label}</Text>
                <Text style={styles.imagePresetGroupHint}>{group.description}</Text>
                <View style={styles.imageOptionRow}>
                  {group.presets.map((preset) => (
                    <TouchableOpacity
                      key={preset.id}
                      style={[
                        styles.optionChip,
                        resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                          styles.optionChipActive,
                      ]}
                      onPress={() => setImageDefaults((prev) => ({ ...prev, size: preset.size }))}
                      disabled={imageGenerationBusy}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                            styles.optionChipTextActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[
                styles.optionChip,
                resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
                  styles.optionChipActive,
              ]}
              onPress={() =>
                setImageDefaults((prev) => ({
                  ...prev,
                  size:
                    resolveImageGenerationSizePresetId(prev.size) === 'custom'
                      ? prev.size
                      : sizeForPreset('1k'),
                }))
              }
              disabled={imageGenerationBusy}
            >
              <Text
                style={[
                  styles.optionChipText,
                  resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
                    styles.optionChipTextActive,
                ]}
              >
                自定义尺寸
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={imageDefaults.size}
            onChangeText={(size) => setImageDefaults((prev) => ({ ...prev, size }))}
            placeholder="例如 2560x1440"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!imageGenerationBusy}
          />
          <Text
            style={[
              styles.imagePanelHint,
              !validateImageGenerationSize(imageDefaults.size).valid && styles.imagePanelHintDanger,
            ]}
          >
            {validateImageGenerationSize(imageDefaults.size).valid
              ? '合法范围：最长边 ≤ 3840、宽高为 16 的倍数、比例不超过 3:1。'
              : validateImageGenerationSize(imageDefaults.size).message}
          </Text>
          <View style={styles.imageOptionRow}>
            {(['low', 'medium', 'high'] as const).map((quality) => (
              <TouchableOpacity
                key={quality}
                style={[
                  styles.optionChip,
                  imageDefaults.quality === quality && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, quality }))}
                disabled={imageGenerationBusy}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.quality === quality && styles.optionChipTextActive,
                  ]}
                >
                  {quality}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.imageOptionRow}>
            {(['png', 'jpeg', 'webp'] as const).map((outputFormat) => (
              <TouchableOpacity
                key={outputFormat}
                style={[
                  styles.optionChip,
                  imageDefaults.outputFormat === outputFormat && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, outputFormat }))}
                disabled={imageGenerationBusy}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.outputFormat === outputFormat && styles.optionChipTextActive,
                  ]}
                >
                  {outputFormat.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
            {(['auto', 'opaque'] as const).map((background) => (
              <TouchableOpacity
                key={background}
                style={[
                  styles.optionChip,
                  imageDefaults.background === background && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, background }))}
                disabled={imageGenerationBusy}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.background === background && styles.optionChipTextActive,
                  ]}
                >
                  {background === 'auto' ? '自动背景' : '不透明背景'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {artifactHistory.length > 0 ? (
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>已上传附件</Text>
          <MobileAttachmentBar attachments={artifactHistory} />
        </View>
      ) : null}

      {input.trim().length > 0 || attachments.length > 0 || imageGenerationMode ? (
        <View style={styles.composerMetaBar}>
          <Text style={styles.composerMetaText}>
            {draftSummary.modeLabel} · {draftSummary.charCount} 字 · {draftSummary.lineCount} 行
            {draftSummary.attachmentCount > 0 ? ` · ${draftSummary.attachmentCount} 个附件` : ''}
          </Text>
          {(input.trim().length > 0 || attachments.length > 0) &&
          !sending &&
          !imageGenerationBusy ? (
            <TouchableOpacity
              onPress={clearComposerDraft}
              accessibilityRole="button"
              accessibilityLabel="清空输入草稿"
            >
              <Text style={styles.composerMetaAction}>清空</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {!imageGenerationMode ? (
        <View style={styles.promptTemplateBar}>
          <Text style={styles.promptTemplateLabel}>快捷</Text>
          {MOBILE_PROMPT_TEMPLATES.map((template) => (
            <TouchableOpacity
              key={template.id}
              accessibilityRole="button"
              accessibilityLabel={`插入${template.label}模板`}
              disabled={sending || imageGenerationBusy}
              onPress={() => applyPromptTemplate(template.prompt)}
              style={[
                styles.promptTemplateChip,
                (sending || imageGenerationBusy) && styles.promptTemplateChipDisabled,
              ]}
            >
              <Text style={styles.promptTemplateChipText}>{template.label}</Text>
            </TouchableOpacity>
          ))}
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
          placeholder={imageGenerationMode ? '描述你想生成或编辑的图片…' : '发送消息…'}
          placeholderTextColor="#64748b"
          multiline
          editable={!sending && !imageGenerationBusy}
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
            disabled={(!input.trim() && attachments.length === 0) || imageGenerationBusy}
            style={[
              styles.sendBtn,
              (!input.trim() && attachments.length === 0) || imageGenerationBusy
                ? styles.sendBtnDisabled
                : undefined,
            ]}
          >
            <Text style={styles.sendBtnText}>
              {imageGenerationBusy ? '…' : imageGenerationMode ? '✦' : '↑'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <MobileCompanionStage
        input={input}
        sessionId={sessionId}
        streaming={sending}
        pendingPermissionCount={0}
        attachedCount={attachments.length}
        todoCount={0}
        sessionBusyState={sending ? 'running' : null}
        currentUserEmail={''}
        showVoice={showVoice}
        queuedCount={0}
        rightOpen={false}
      />

      <ActionSheet
        visible={Boolean(selectedMessage)}
        title={selectedMessage?.role === 'user' ? '用户消息' : '助手回复'}
        message={selectedMessage?.content.trim().slice(0, 120)}
        actions={selectedMessageActions}
        onDismiss={() => setSelectedMessage(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  list: { padding: 12, paddingBottom: 4 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 60, fontSize: 14 },
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
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  imageModeToggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  imageModeToggleActive: {
    borderColor: '#8b5cf6',
    backgroundColor: '#8b5cf622',
  },
  searchToggleActive: {
    borderColor: '#fbbf24',
    backgroundColor: '#fbbf2422',
  },
  imageModeToggleDisabled: { opacity: 0.45 },
  imageModeToggleText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  imageModeToggleTextActive: { color: '#8b5cf6' },
  searchToggleTextActive: { color: '#fbbf24' },
  modeHintBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    backgroundColor: '#020617',
  },
  modeHintText: { color: '#64748b', fontSize: 11, lineHeight: 15 },
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
  composerMetaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  composerMetaText: { flex: 1, color: '#64748b', fontSize: 11, lineHeight: 15 },
  composerMetaAction: { color: '#fca5a5', fontSize: 11, fontWeight: '800' },
  promptTemplateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  promptTemplateLabel: { color: '#475569', fontSize: 11, fontWeight: '800' },
  promptTemplateChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  promptTemplateChipDisabled: { opacity: 0.45 },
  promptTemplateChipText: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  streamErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#ef444414',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  streamErrorIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#ef444422',
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  streamErrorText: { flex: 1, color: '#fca5a5', fontSize: 12, lineHeight: 17 },
  streamErrorDismiss: { color: '#fecaca', fontSize: 12, fontWeight: '700' },
  streamErrorRetry: { color: '#fee2e2', fontSize: 12, fontWeight: '800' },
  streamErrorRetryDisabled: { opacity: 0.45 },
  restoreFocusButton: {
    position: 'absolute',
    right: 14,
    bottom: 108,
    zIndex: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#6366f166',
    backgroundColor: '#111827ee',
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  restoreFocusText: { color: '#c7d2fe', fontSize: 12, fontWeight: '800' },
  imagePanel: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8b5cf655',
    backgroundColor: '#8b5cf612',
    padding: 12,
    gap: 8,
  },
  imagePanelTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  imagePanelText: { color: '#cbd5e1', fontSize: 12, lineHeight: 18 },
  imagePanelHint: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  imagePanelHintDanger: { color: '#f87171' },
  imagePresetGroups: { gap: 10 },
  imagePresetGroup: { gap: 6 },
  imagePresetGroupTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  imagePresetGroupHint: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  imageOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  optionChipActive: { borderColor: '#8b5cf6', backgroundColor: '#8b5cf622' },
  optionChipText: { color: '#94a3b8', fontSize: 11 },
  optionChipTextActive: { color: '#8b5cf6', fontWeight: '600' },
});
