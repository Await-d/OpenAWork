import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/auth';
import { useGatewayClient } from '../hooks/useGatewayClient';
import { useAuthErrorHandler } from '../hooks/use-auth-error-handler';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { createSessionsClient } from '@openAwork/web-client';
import { validateImageGenerationSize } from '@openAwork/shared';
import type { DialogueMode, InputImageContent } from '@openAwork/shared';
import {
  buildChatStreamToken,
  shouldApplyChatSessionMutation,
  shouldApplyChatStreamMutation,
} from '../hooks/chat-stream-guard';
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
import * as DocumentPicker from 'expo-document-picker';
import { reconcileTaskActivities } from './chat-task-activities';
import {
  buildChatScreenSessionResetState,
  buildChatScreenStaleSendAbortState,
  reconcileMobileChatMessages,
} from './chat-screen-state';
import { createChatScreenGuardedStreamHandlers } from './chat-screen-stream-handlers';
import ExpoPersistenceAdapter from '../store/providerPersistence';
import { normalizeMobileChatMessages } from '../chat/chat-message-content';
import {
  buildChatDraftSummary,
  findChatMessageMatches,
  findPreviousUserMessage,
  getChatRestoreFocusLabel,
  insertMobilePromptTemplate,
  isNearChatBottom,
  moveChatSearchCursor,
  toInputImageParts,
} from './chat-message-actions';
import { Screen } from '../components/Screen';
import { resolveComposerBottomInset } from '../layout/keyboard';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatComposer } from './chat-screen/chat-composer';
import { ChatComposerMetaBar, ChatPromptTemplateBar } from './chat-screen/composer-extras';
import { ChatHeader } from './chat-screen/chat-header';
import { ChatImageGenerationPanel } from './chat-screen/image-generation-panel';
import { ChatImageViewerLayer } from './chat-screen/chat-image-viewer-layer';
import { ChatModeBar } from './chat-screen/chat-mode-bar';
import { ChatStreamErrorBar } from './chat-screen/stream-error-bar';
import { styles } from './chat-screen/styles';
import type { ChatScreenProps, Message, RetryableTextRequest } from './chat-screen/types';
import { inferAttachmentType, resolveAttachmentMimeType } from './chat-screen/chat-attachments';
import { useChatArtifacts } from './chat-screen/use-chat-artifacts';
import { useChatImageViewer } from './chat-screen/use-chat-image-viewer';
import { useMobileImageGenerationSettings } from './chat-screen/use-mobile-image-generation-settings';

export function ChatScreen({ sessionId }: ChatScreenProps) {
  const { accessToken, gatewayUrl, userEmail } = useAuthStore();
  const handleAuthError = useAuthErrorHandler();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const composerBottomInset = resolveComposerBottomInset({
    keyboardHeight,
    safeBottom: insets.bottom,
    gap: 8,
    platform: Platform.OS,
  });
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
  const { hasConfiguredImageModel, imageDefaults, imageModelLabel, setImageDefaults } =
    useMobileImageGenerationSettings({ persistence, sessionId });
  const [todoCount, setTodoCount] = useState(0);
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);
  const imageViewer = useChatImageViewer();
  const { handlePressMessageImage, reset: resetImageViewer } = imageViewer;
  const listRef = useRef<FlatList>(null);
  const keyboardHeightRef = useRef(0);
  const isMountedRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const lastContentHeightRef = useRef(0);
  const latestSessionIdRef = useRef(sessionId);
  const streamRequestVersionRef = useRef(0);
  const activeStreamTokenRef = useRef<string | null>(null);
  const lastTextRequestRef = useRef<RetryableTextRequest | null>(null);
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
    resetImageViewer();
    isNearBottomRef.current = true;
    lastContentHeightRef.current = 0;
  }, [resetImageViewer]);
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

  // When the keyboard opens, keep the latest messages above the raised composer.
  useEffect(() => {
    const previous = keyboardHeightRef.current;
    keyboardHeightRef.current = keyboardHeight;
    if (keyboardHeight > 0 && previous === 0 && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [keyboardHeight]);

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
        if (handleAuthError(error)) return;
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

  // 同步 session status（todo + pending permission 计数）
  useEffect(() => {
    if (!accessToken) {
      setTodoCount(0);
      setPendingPermissionCount(0);
      return;
    }
    let cancelled = false;
    const syncStatus = async () => {
      if (cancelled) return;
      try {
        const status = await sessionsClient.getStatus(accessToken, sessionId);
        if (cancelled) return;
        const pendingTodos = (status.todoLanes?.main ?? []).filter(
          (t) => t.status === 'pending' || t.status === 'in_progress',
        ).length;
        setTodoCount(pendingTodos);
        setPendingPermissionCount(status.pendingPermissions?.length ?? 0);
      } catch {
        // 静默处理——状态同步失败不应阻塞聊天
      }
    };
    void syncStatus();
    const timer = setInterval(() => void syncStatus(), taskSyncIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, sessionId, sessionsClient, taskSyncIntervalMs]);
  const { generateImageForSession, loadArtifactHistory, uploadSelectedAttachments } =
    useChatArtifacts({
      accessToken,
      canApplySessionMutation,
      gatewayUrl,
      handleAuthError,
      imageDefaults,
      sessionId,
      setArtifactHistory,
    });
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
        setMessages((previous) => reconcileMobileChatMessages(previous, msgs));
      } catch (error) {
        if (handleAuthError(error)) return;
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
        ...result.assets.map((asset) => {
          const mimeType = resolveAttachmentMimeType({
            mimeType: asset.mimeType ?? undefined,
            name: asset.name,
          });
          return {
            id: `att-${asset.uri}-${asset.name}`,
            name: asset.name,
            uri: asset.uri,
            ...(mimeType ? { mimeType } : {}),
            type: inferAttachmentType({ mimeType, name: asset.name }),
            sizeBytes: asset.size ?? 0,
          };
        }),
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
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        <ChatHeader
          onBack={() => router.back()}
          onOpenAnswerRetry={() => router.push('/answer-retry')}
          onOpenAttachments={() => router.push('/attachments')}
          onOpenInputContext={() => router.push('/input-context')}
          onToggleSearch={() => setSearchOpen((prev) => !prev)}
          searchOpen={searchOpen}
        />

        <ChatModeBar
          dialogueMode={dialogueMode}
          imageGenerationBusy={imageGenerationBusy}
          imageGenerationMode={imageGenerationMode}
          imageModelConfigured={hasConfiguredImageModel}
          modeLabel={draftSummary.modeLabel}
          onChangeDialogueMode={setDialogueMode}
          onToggleImageGenerationMode={() => setImageGenerationMode((prev) => !prev)}
          sending={sending}
        />

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
          style={styles.messageList}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={handleChatContentSizeChange}
          onScroll={handleChatScroll}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({ animated: true, offset: Math.max(0, index * 96) });
          }}
          scrollEventThrottle={80}
          ListEmptyComponent={
            historyLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
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
              onPressImage={(image) => handlePressMessageImage(item, image)}
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
          <ChatStreamErrorBar
            hasRetryDraft={Boolean(lastTextRequestRef.current)}
            imageGenerationBusy={imageGenerationBusy}
            message={streamError}
            onDismiss={() => setStreamError(null)}
            onRetry={() => {
              void retryLastTextRequest();
            }}
            sending={sending}
          />
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

        {imageGenerationMode ? (
          <ChatImageGenerationPanel
            hasConfiguredImageModel={hasConfiguredImageModel}
            imageDefaults={imageDefaults}
            imageGenerationBusy={imageGenerationBusy}
            imageModelLabel={imageModelLabel}
            setImageDefaults={setImageDefaults}
          />
        ) : null}

        {artifactHistory.length > 0 ? (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>已上传附件</Text>
            <MobileAttachmentBar attachments={artifactHistory} />
          </View>
        ) : null}

        {input.trim().length > 0 || attachments.length > 0 || imageGenerationMode ? (
          <ChatComposerMetaBar
            attachments={attachments}
            clearComposerDraft={clearComposerDraft}
            draftSummary={draftSummary}
            imageGenerationBusy={imageGenerationBusy}
            input={input}
            sending={sending}
          />
        ) : null}

        {!imageGenerationMode ? (
          <ChatPromptTemplateBar
            applyPromptTemplate={applyPromptTemplate}
            imageGenerationBusy={imageGenerationBusy}
            sending={sending}
          />
        ) : null}

        {/* Compact Composer — bottom inset tracks keyboard height */}
        <ChatComposer
          applyPromptTemplate={applyPromptTemplate}
          attachments={attachments}
          composerBottomInset={composerBottomInset}
          handleAddAttachment={handleAddAttachment}
          handleSend={handleSend}
          handleStop={handleStop}
          imageGenerationBusy={imageGenerationBusy}
          imageGenerationMode={imageGenerationMode}
          input={input}
          sending={sending}
          setAttachments={setAttachments}
          setInput={setInput}
          setShowVoice={setShowVoice}
        />

        <MobileCompanionStage
          input={input}
          sessionId={sessionId}
          streaming={sending}
          pendingPermissionCount={pendingPermissionCount}
          attachedCount={attachments.length}
          todoCount={todoCount}
          sessionBusyState={sending ? 'running' : null}
          currentUserEmail={userEmail}
          showVoice={showVoice}
          queuedCount={sending ? 1 : 0}
          rightOpen={false}
        />

        <ActionSheet
          visible={Boolean(selectedMessage)}
          title={selectedMessage?.role === 'user' ? '用户消息' : '助手回复'}
          message={selectedMessage?.content.trim().slice(0, 120)}
          actions={selectedMessageActions}
          onDismiss={() => setSelectedMessage(null)}
        />

        <ChatImageViewerLayer viewer={imageViewer} />
      </View>
    </Screen>
  );
}
