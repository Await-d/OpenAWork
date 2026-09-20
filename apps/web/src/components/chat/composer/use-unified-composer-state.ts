import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { CommandDescriptor } from '@openAwork/shared';
import { useComposerCallbacks } from '../../../pages/chat-page/conversation/composer/use-composer-callbacks.js';
import { useComposerMenuItems } from '../../../pages/chat-page/conversation/composer/use-composer-menu-items.js';
import { useComposerQueue } from '../../../pages/chat-page/conversation/composer/use-composer-queue.js';
import { useComposerInputHistory } from './use-composer-input-history.js';
import { useComposerInputHistoryStore } from '../../../stores/chat/composer-input-history.js';

import { buildQueuedComposerScopeKey } from '../../../pages/chat-page/conversation/render/chat-page-utils.js';
import {
  createQueuedComposerPreview,
  hydrateQueuedComposerMessage,
  type QueuedComposerMessage,
  toPersistedQueuedComposerMessage,
} from '../../../pages/chat-page/conversation/composer/queued-composer-state.js';
import { restoreQueuedComposerFiles } from '../../../pages/chat-page/conversation/composer/queued-composer-file-store.js';
import type {
  ComposerMenuState,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import { sanitizeComposerPlainText } from '../../conversation-runtime/messages/support.js';
import { useMentionFileSearch } from './use-mention-file-search.js';
import type { MentionFileSearchFn } from './use-mention-file-search.js';
import { useChatQueueStore } from '../../../stores/chat/chat-queue.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type { UnifiedComposerFeatures, UnifiedComposerSubmitPayload } from './UnifiedComposer.js';
import type { ImageEditReferenceArtifact } from '../../../pages/chat-page/conversation/render/image-edit-reference-artifacts.js';
import type { ComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';

/**
 * 共享的空队列常量：内存队列在"不属于当前 scope"时必须复用同一引用，
 * 否则每次 render 产生的全新空数组会让 flush / 持久化 effect 空转。
 */
const EMPTY_QUEUED_COMPOSER_MESSAGES: QueuedComposerMessage[] = [];

/**
 * 内存待发队列始终携带它所属的 scope，避免切换会话时与 `queuedComposerScope`
 * 脱节——否则旧会话的队列会在异步水合完成前被 flush 到新会话或写入新 scope。
 */
interface QueuedComposerState {
  scope: string | null;
  items: QueuedComposerMessage[];
}

export interface UseUnifiedComposerStateOptions {
  sessionId: string | null;
  gatewayUrl: string;
  token: string | null;
  currentUserEmail: string;
  streaming: boolean;
  stoppingStream: boolean;
  canStopSession: boolean;
  stopCapability: 'none' | 'precise' | 'best_effort' | 'observe_only';
  sessionBusyState: 'running' | 'paused' | null;
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  dialogueMode: DialogueMode;
  manualAgentId: string;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  features: Required<UnifiedComposerFeatures>;
  imageReferenceArtifacts: ImageEditReferenceArtifact[];
  selectedImageReferenceArtifactId: string | null;
  onSubmit: (payload: UnifiedComposerSubmitPayload) => boolean | void | Promise<boolean | void>;
  onStop: () => void | Promise<void>;
  stopActiveMessage: () => void;

  imageGenerationMode?: boolean;
  hasConfiguredImageModel?: boolean;
  imageGenerationBusy?: boolean;
  imageGenerationDefaults?: SavedChatImageDefaults;
  imageModelLabel?: string;
  imagePluginEnabled?: boolean;
  toggleImageGenerationMode?: () => void;
  updateImageGenerationDefaults?: (defaults: Partial<SavedChatImageDefaults>) => void;

  composerWorkspaceCatalog?: ComposerWorkspaceCatalog;
  composerCommandDescriptors?: CommandDescriptor[];

  agentOptions?: Array<{ id: string; label: string }>;
  effectiveAgentId?: string;
  defaultAgentLabel?: string;

  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  attachmentItems: AttachmentItem[];
  setAttachmentItems: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  workspaceFileItems: WorkspaceFileMentionItem[];
  setWorkspaceFileItems: React.Dispatch<React.SetStateAction<WorkspaceFileMentionItem[]>>;
  searchMentionFiles?: MentionFileSearchFn;
  composerMenu: ComposerMenuState;
  setComposerMenu: React.Dispatch<React.SetStateAction<ComposerMenuState>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useUnifiedComposerState(opts: UseUnifiedComposerStateOptions) {
  const {
    sessionId,
    gatewayUrl,
    token,
    currentUserEmail,
    streaming,
    stoppingStream,
    canStopSession,
    stopCapability,
    sessionBusyState,
    providers,
    activeProviderId,
    activeModelId,
    dialogueMode,
    manualAgentId,
    webSearchEnabled,
    thinkingEnabled,
    features,
    imageReferenceArtifacts,
    selectedImageReferenceArtifactId,
    onSubmit,
    stopActiveMessage,

    imageGenerationMode = false,
    hasConfiguredImageModel = false,
    imageGenerationBusy = false,
    imageGenerationDefaults = {
      providerId: '',
      modelId: '',
      size: '1024x1024',
      quality: 'medium',
      outputFormat: 'png',
      background: 'auto',
    } as SavedChatImageDefaults,
    imageModelLabel = '',
    imagePluginEnabled = false,
    toggleImageGenerationMode: toggleImageGenerationModeProp,
    updateImageGenerationDefaults: updateImageGenerationDefaultsProp,

    composerWorkspaceCatalog = {
      agents: [],
      agentTools: [],
      installedSkills: [],
      mcpServers: [],
    } as ComposerWorkspaceCatalog,
    composerCommandDescriptors = [],

    agentOptions = [],
    effectiveAgentId = '',
    defaultAgentLabel = '',

    input,
    setInput,
    attachmentItems,
    setAttachmentItems,
    workspaceFileItems,
    setWorkspaceFileItems,
    searchMentionFiles,
    composerMenu,
    setComposerMenu,
    textareaRef,
  } = opts;

  // ─── Composer-local state (truly internal) ────────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [queuedComposerState, setQueuedComposerState] = useState<QueuedComposerState>({
    scope: null,
    items: EMPTY_QUEUED_COMPOSER_MESSAGES,
  });
  const [streamError, setStreamError] = useState<string | null>(null);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerBtnRef = useRef<HTMLButtonElement>(null);
  const modelSettingsBtnRef = useRef<HTMLButtonElement>(null);
  const queueFlushInFlightScopesRef = useRef<Set<string>>(new Set());
  const queueHydratingRef = useRef(false);
  const queueDeletedWhileHydratingRef = useRef<Set<string>>(new Set());

  // ─── Fallback callbacks for optional props ────────────────────────────────
  const toggleImageGenerationMode: () => void = toggleImageGenerationModeProp ?? (() => undefined);
  const updateImageGenerationDefaults: (defaults: Partial<SavedChatImageDefaults>) => void =
    updateImageGenerationDefaultsProp ?? (() => undefined);

  // ─── Derived values ───────────────────────────────────────────────────────
  const queuedComposerScope = useMemo(() => {
    if (!sessionId) return null;
    return buildQueuedComposerScopeKey(currentUserEmail, sessionId);
  }, [sessionId, currentUserEmail]);
  const queuedComposerScopeRef = useRef<string | null>(queuedComposerScope);
  useLayoutEffect(() => {
    queuedComposerScopeRef.current = queuedComposerScope;
  }, [queuedComposerScope]);
  const queueInScope = queuedComposerState.scope === queuedComposerScope;
  const queuedComposerMessages = queueInScope
    ? queuedComposerState.items
    : EMPTY_QUEUED_COMPOSER_MESSAGES;
  const setQueuedComposerMessages = useCallback<
    React.Dispatch<React.SetStateAction<QueuedComposerMessage[]>>
  >(
    (value) => {
      setQueuedComposerState((previous) => {
        const base =
          previous.scope === queuedComposerScope ? previous.items : EMPTY_QUEUED_COMPOSER_MESSAGES;
        return {
          scope: queuedComposerScope,
          items: typeof value === 'function' ? value(base) : value,
        };
      });
    },
    [queuedComposerScope],
  );
  const inputHistoryIdentity = useMemo(() => {
    if (!token) return null;
    const normalizedEmail = currentUserEmail.trim().toLowerCase();
    if (normalizedEmail.length === 0) return null;
    const normalizedGatewayUrl = gatewayUrl.trim().toLowerCase();
    return `${normalizedGatewayUrl}::${normalizedEmail}`;
  }, [currentUserEmail, gatewayUrl, token]);
  const pendingInputHistoryScope = useMemo(() => {
    if (!inputHistoryIdentity) return null;
    return `${inputHistoryIdentity}::pending`;
  }, [inputHistoryIdentity]);
  const inputHistoryScope = useMemo(() => {
    if (!inputHistoryIdentity) return null;
    return sessionId ? `${inputHistoryIdentity}::session:${sessionId}` : pendingInputHistoryScope;
  }, [inputHistoryIdentity, pendingInputHistoryScope, sessionId]);
  const {
    isBrowsingInputHistory,
    navigateInputHistory,
    exitInputHistoryBrowsing,
    restoreInputFromHistory,
    recordSubmittedInputHistory,
  } = useComposerInputHistory({
    input,
    setInput,
    historyScope: inputHistoryScope,
    textareaRef,
  });
  const moveInputHistoryEntries = useComposerInputHistoryStore((state) => state.moveEntries);
  const pendingInputHistoryEntryCount = useComposerInputHistoryStore(
    useCallback(
      (state) =>
        pendingInputHistoryScope
          ? (state.historyByScope[pendingInputHistoryScope]?.length ?? 0)
          : 0,
      [pendingInputHistoryScope],
    ),
  );

  // ─── Queue hook ───────────────────────────────────────────────────────────
  const replacePersistedQueue = useChatQueueStore((state) => state.replaceQueue);
  const {
    appendFiles,
    handleFileChange,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage: enqueueComposerMessageDirect,
    removeQueuedComposerMessage,
    restoreQueuedComposerMessage,
  } = useComposerQueue({
    input,
    setInput,
    attachedFiles,
    setAttachedFiles,
    attachmentItems,
    setAttachmentItems,
    queuedComposerMessages,
    setQueuedComposerMessages,
    queuedComposerScope,
    queuedComposerScopeRef,
    queueHydratingRef,
    queueDeletedWhileHydratingRef,
    setComposerMenu,
    setStreamError,
    textareaRef,
    fileInputRef,
  });
  const composerDraftRevisionRef = useRef(0);
  useLayoutEffect(() => {
    composerDraftRevisionRef.current += 1;
  }, [attachmentItems, attachedFiles, input]);
  const enqueueComposerMessage = useCallback(
    async (overrideText?: string): Promise<boolean> => {
      const queuedText = sanitizeComposerPlainText(overrideText ?? input).trim();
      const queued = await enqueueComposerMessageDirect(overrideText);
      if (queued) {
        recordSubmittedInputHistory(queuedText);
      }
      return queued;
    },
    [enqueueComposerMessageDirect, input, recordSubmittedInputHistory],
  );

  useEffect(() => {
    if (
      !pendingInputHistoryScope ||
      !sessionId ||
      !inputHistoryScope ||
      pendingInputHistoryEntryCount === 0
    ) {
      return;
    }

    moveInputHistoryEntries(pendingInputHistoryScope, inputHistoryScope);
  }, [
    inputHistoryScope,
    moveInputHistoryEntries,
    pendingInputHistoryEntryCount,
    pendingInputHistoryScope,
    sessionId,
  ]);

  // ─── Send handler (constructs payload and delegates to parent) ────────────
  const sendMessage = useCallback(
    async (overrideText?: string): Promise<boolean> => {
      const submittedText = overrideText ?? input;
      const submittedDraftRevision = composerDraftRevisionRef.current;
      const payload: UnifiedComposerSubmitPayload = {
        text: submittedText,
        files: attachedFiles,
        attachmentItems,
        imageGenerationMode,
        imageGenerationDefaults,
        hasConfiguredImageModel,
        selectedImageReferenceArtifactId,
        selectedImageReferenceArtifact: selectedImageReferenceArtifactId
          ? (imageReferenceArtifacts.find(
              (a) => a.artifactId === selectedImageReferenceArtifactId,
            ) ?? null)
          : null,
        composerCommandDescriptors,
        effectiveAgentId: effectiveAgentId ?? '',
        imageModelLabel,
      };
      const submitResult = await onSubmit(payload);
      if (submitResult === false) {
        return false;
      }
      // 显式传入的文本（粘贴卡片合并）不经受控 input 往返：调用方的写回会先让
      // draftRevision 变化，若沿用同一判据就会漏掉清空。这条路径直接清空。
      if (
        overrideText !== undefined ||
        composerDraftRevisionRef.current === submittedDraftRevision
      ) {
        clearComposerDraft();
      }
      recordSubmittedInputHistory(submittedText);
      return true;
    },
    [
      input,
      attachedFiles,
      attachmentItems,
      imageGenerationMode,
      imageGenerationDefaults,
      hasConfiguredImageModel,
      selectedImageReferenceArtifactId,
      imageReferenceArtifacts,
      composerCommandDescriptors,
      effectiveAgentId,
      imageModelLabel,
      clearComposerDraft,
      onSubmit,
      recordSubmittedInputHistory,
    ],
  );

  // ─── Menu items hook ──────────────────────────────────────────────────────
  const mentionSearchState = useMentionFileSearch({
    enabled: composerMenu?.type === 'mention',
    query: composerMenu?.type === 'mention' ? composerMenu.query : null,
    search: searchMentionFiles,
  });
  const { slashCommandItems, mentionItems } = useComposerMenuItems({
    composerMenu,
    composerCommandDescriptors,
    composerWorkspaceCatalog,
    mentionSearch: mentionSearchState.result,
  });

  // ─── Composer callbacks hook ──────────────────────────────────────────────
  const {
    handleKeyDown,
    handleInputChange,
    handleInputSelect,
    handlePaste,
    applyComposerSelection,
  } = useComposerCallbacks({
    composerMenu,
    setComposerMenu,
    input,
    setInput,
    textareaRef,
    slashCommandItems,
    mentionItems,
    stopCapability,
    streaming,
    canStopCurrentSessionStream: canStopSession,
    remoteSessionBusyState: sessionBusyState,
    stopActiveMessage,
    enqueueComposerMessage,
    sendMessage,
    appendFiles,
    navigateInputHistory,
    isBrowsingInputHistory,
    exitInputHistoryBrowsing,
  });

  // ─── Queue hydration effect ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    queueHydratingRef.current = true;
    queueDeletedWhileHydratingRef.current = new Set();
    if (queuedComposerScope !== null) {
      queueFlushInFlightScopesRef.current.delete(queuedComposerScope);
    }

    const persistedQueue = queuedComposerScope
      ? (useChatQueueStore.getState().queuesByScope[queuedComposerScope] ?? [])
      : [];
    const persistedIds = new Set(persistedQueue.map((item) => item.id));

    const finishHydration = (items: QueuedComposerMessage[]) => {
      if (cancelled) return;
      queueHydratingRef.current = false;
      setQueuedComposerState((previous) => {
        const deletedIds = queueDeletedWhileHydratingRef.current;
        const hydrationIds = new Set(items.map((item) => item.id));
        // 水合是异步的：期间用户可能已向当前 scope 追加了新条目（不在持久化快照里，
        // 须保留，否则会被水合结果覆盖丢失）；也可能删除了快照里的旧条目（须尊重
        // 删除，否则会被水合结果复活）。
        const appended =
          previous.scope === queuedComposerScope
            ? previous.items.filter(
                (item) => !persistedIds.has(item.id) && !hydrationIds.has(item.id),
              )
            : [];
        return {
          scope: queuedComposerScope,
          items: [...items.filter((item) => !deletedIds.has(item.id)), ...appended],
        };
      });
    };

    if (!queuedComposerScope || persistedQueue.length === 0) {
      finishHydration([]);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      persistedQueue.map(async (item) => {
        const hydratedItem = hydrateQueuedComposerMessage(item);
        if (item.attachmentItems.length === 0) return hydratedItem;

        const restoredFiles = await restoreQueuedComposerFiles({
          attachmentItems: item.attachmentItems,
          queueId: item.id,
          scope: queuedComposerScope,
        });

        if (restoredFiles.restored) {
          return {
            ...hydratedItem,
            files: restoredFiles.files,
            requiresAttachmentRebind: false,
          } satisfies QueuedComposerMessage;
        }

        return {
          ...hydratedItem,
          requiresAttachmentRebind:
            hydratedItem.requiresAttachmentRebind || item.attachmentItems.length > 0,
        } satisfies QueuedComposerMessage;
      }),
    )
      .then((items) => finishHydration(items))
      .catch(() => {
        finishHydration(
          persistedQueue.map((item) => ({
            ...hydrateQueuedComposerMessage(item),
            requiresAttachmentRebind:
              item.requiresAttachmentRebind || item.attachmentItems.length > 0,
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [queuedComposerScope]);

  // ─── Queue persistence effect ─────────────────────────────────────────────
  useEffect(() => {
    if (!queuedComposerScope || !queueInScope) return;
    if (queueHydratingRef.current) return;
    replacePersistedQueue(
      queuedComposerScope,
      queuedComposerMessages.map((item) => toPersistedQueuedComposerMessage(item)),
    );
  }, [queuedComposerMessages, queuedComposerScope, queueInScope, replacePersistedQueue]);

  // ─── Queue flush effect ───────────────────────────────────────────────────
  const sendMessageRef = useRef<
    (
      overrideText?: string,
      options?: {
        queuedAttachmentItems?: AttachmentItem[];
        queuedFiles?: File[];
        queuedMessageId?: string;
      },
    ) => Promise<boolean>
  >(async () => false);

  // Keep sendMessageRef in sync with parent's onSubmit
  useEffect(() => {
    sendMessageRef.current = async (
      overrideText?: string,
      options?: {
        queuedAttachmentItems?: AttachmentItem[];
        queuedFiles?: File[];
        queuedMessageId?: string;
      },
    ) => {
      const payload: UnifiedComposerSubmitPayload = {
        text: overrideText ?? input,
        files: options?.queuedFiles ?? attachedFiles,
        attachmentItems: options?.queuedAttachmentItems ?? attachmentItems,
        imageGenerationMode,
        imageGenerationDefaults,
        hasConfiguredImageModel,
        selectedImageReferenceArtifactId,
        selectedImageReferenceArtifact: selectedImageReferenceArtifactId
          ? (imageReferenceArtifacts.find(
              (a) => a.artifactId === selectedImageReferenceArtifactId,
            ) ?? null)
          : null,
        composerCommandDescriptors,
        effectiveAgentId: effectiveAgentId ?? '',
        imageModelLabel,
        queuedMessageId: options?.queuedMessageId,
      };
      if (overrideText === undefined && options?.queuedFiles === undefined) {
        clearComposerDraft();
      }
      const submitResult = await onSubmit(payload);
      if (submitResult === false) {
        return false;
      }
      return true;
    };
  });

  useEffect(() => {
    if (
      queuedComposerMessages.length === 0 ||
      streaming ||
      stoppingStream ||
      canStopSession ||
      sessionBusyState !== null ||
      queuedComposerScope === null ||
      queueFlushInFlightScopesRef.current.has(queuedComposerScope)
    ) {
      return;
    }

    const [nextQueuedMessage] = queuedComposerMessages;
    if (!nextQueuedMessage || nextQueuedMessage.requiresAttachmentRebind) return;

    const flushScope = queuedComposerScope;
    queueFlushInFlightScopesRef.current.add(flushScope);
    setQueuedComposerMessages((previous) => previous.slice(1));

    const requeue = () => {
      if (flushScope === queuedComposerScopeRef.current) {
        setQueuedComposerMessages((previous) => [nextQueuedMessage, ...previous]);
        return;
      }
      const store = useChatQueueStore.getState();
      store.replaceQueue(flushScope, [
        toPersistedQueuedComposerMessage(nextQueuedMessage),
        ...(store.queuesByScope[flushScope] ?? []),
      ]);
    };

    void sendMessageRef
      .current(nextQueuedMessage.text, {
        queuedAttachmentItems: nextQueuedMessage.attachmentItems,
        queuedFiles: nextQueuedMessage.files,
        queuedMessageId: nextQueuedMessage.id,
      })
      .then((sent) => {
        if (!sent) {
          requeue();
        }
      })
      .catch(() => {
        requeue();
      })
      .finally(() => {
        queueFlushInFlightScopesRef.current.delete(flushScope);
      });
  }, [
    canStopSession,
    queuedComposerMessages,
    queuedComposerScope,
    sessionBusyState,
    stoppingStream,
    streaming,
  ]);

  // ─── Queued composer previews ─────────────────────────────────────────────
  const queuedComposerPreviews = useMemo(
    () => queuedComposerMessages.map((item) => createQueuedComposerPreview(item)),
    [queuedComposerMessages],
  );

  return {
    // State (controlled from ChatPage)
    input,
    setInput,
    attachmentItems,
    workspaceFileItems,
    composerMenu,
    setComposerMenu,

    // State (internal)
    attachedFiles,
    showVoice,
    setShowVoice,
    showModelPicker,
    setShowModelPicker,
    showModelSettings,
    setShowModelSettings,
    streamError,
    setStreamError,
    isBrowsingInputHistory,

    // Refs
    textareaRef,
    fileInputRef,
    modelPickerBtnRef,
    modelSettingsBtnRef,

    // Derived (from props)
    composerWorkspaceCatalog,
    composerCommandDescriptors,
    agentOptions,
    effectiveAgentId,
    defaultAgentLabel,
    queuedComposerPreviews,

    // Image generation (from props)
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationDefaults,
    imageGenerationMode,
    imageModelLabel,
    imagePluginEnabled,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,

    // Queue
    appendFiles,
    handleFileChange,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage,
    removeQueuedComposerMessage,
    restoreQueuedComposerMessage,

    // Callbacks
    handleKeyDown,
    handleInputChange,
    handleInputSelect,
    handlePaste,
    applyComposerSelection,
    sendMessage,
    restoreInputFromHistory,

    // Menu items
    slashCommandItems,
    mentionItems,
    mentionSearchState,
  };
}
