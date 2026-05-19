import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { CommandDescriptor } from '@openAwork/shared';
import { useComposerCallbacks } from '../../../pages/chat-page/conversation/composer/use-composer-callbacks.js';
import { useComposerMenuItems } from '../../../pages/chat-page/conversation/composer/use-composer-menu-items.js';
import { useComposerQueue } from '../../../pages/chat-page/conversation/composer/use-composer-queue.js';

import { buildQueuedComposerScopeKey } from '../../../pages/chat-page/conversation/render/chat-page-utils.js';
import {
  createQueuedComposerPreview,
  hydrateQueuedComposerMessage,
  type QueuedComposerMessage,
  toPersistedQueuedComposerMessage,
} from '../../../pages/chat-page/conversation/composer/queued-composer-state.js';
import {
  deleteQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from '../../../pages/chat-page/conversation/composer/queued-composer-file-store.js';
import type {
  ComposerMenuState,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import { useChatQueueStore } from '../../../stores/chat/chat-queue.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';
import type { SavedChatImageDefaults } from '../../../utils/chat/chat-session-defaults.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type { UnifiedComposerFeatures, UnifiedComposerSubmitPayload } from './UnifiedComposer.js';
import type { ImageEditReferenceArtifact } from '../../../pages/chat-page/conversation/render/image-edit-reference-artifacts.js';
import type { ComposerWorkspaceCatalog } from '../../../hooks/chat/useComposerWorkspaceCatalog.js';

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
  onSubmit: (payload: UnifiedComposerSubmitPayload) => void | Promise<void>;
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
    composerMenu,
    setComposerMenu,
    textareaRef,
  } = opts;

  // ─── Composer-local state (truly internal) ────────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [queuedComposerMessages, setQueuedComposerMessages] = useState<QueuedComposerMessage[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerBtnRef = useRef<HTMLButtonElement>(null);
  const modelSettingsBtnRef = useRef<HTMLButtonElement>(null);
  const queueFlushInFlightRef = useRef(false);
  const queueHydratingRef = useRef(false);

  // ─── Fallback callbacks for optional props ────────────────────────────────
  const toggleImageGenerationMode: () => void = toggleImageGenerationModeProp ?? (() => undefined);
  const updateImageGenerationDefaults: (defaults: Partial<SavedChatImageDefaults>) => void =
    updateImageGenerationDefaultsProp ?? (() => undefined);

  // ─── Derived values ───────────────────────────────────────────────────────
  const queuedComposerScope = useMemo(() => {
    if (!sessionId) return null;
    return buildQueuedComposerScopeKey(currentUserEmail, sessionId);
  }, [sessionId, currentUserEmail]);

  // ─── Queue hook ───────────────────────────────────────────────────────────
  const replacePersistedQueue = useChatQueueStore((state) => state.replaceQueue);
  const {
    appendFiles,
    handleFileChange,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage,
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
    setComposerMenu,
    setStreamError,
    textareaRef,
    fileInputRef,
  });

  // ─── Send handler (constructs payload and delegates to parent) ────────────
  const sendMessage = useCallback(async (): Promise<boolean> => {
    const payload: UnifiedComposerSubmitPayload = {
      text: input,
      files: attachedFiles,
      attachmentItems,
      imageGenerationMode,
      imageGenerationDefaults,
      hasConfiguredImageModel,
      selectedImageReferenceArtifactId,
      selectedImageReferenceArtifact: selectedImageReferenceArtifactId
        ? (imageReferenceArtifacts.find((a) => a.artifactId === selectedImageReferenceArtifactId) ??
          null)
        : null,
      composerCommandDescriptors,
      effectiveAgentId: effectiveAgentId ?? '',
      imageModelLabel,
    };
    clearComposerDraft();
    await onSubmit(payload);
    return true;
  }, [
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
  ]);

  // ─── Menu items hook ──────────────────────────────────────────────────────
  const { slashCommandItems, mentionItems } = useComposerMenuItems({
    composerMenu,
    composerCommandDescriptors,
    composerWorkspaceCatalog,
    workspaceFileItems,
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
  });

  // ─── Queue hydration effect ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    queueHydratingRef.current = true;
    queueFlushInFlightRef.current = false;

    const persistedQueue = queuedComposerScope
      ? (useChatQueueStore.getState().queuesByScope[queuedComposerScope] ?? [])
      : [];

    const finishHydration = (items: QueuedComposerMessage[]) => {
      if (cancelled) return;
      setQueuedComposerMessages(items);
      queueHydratingRef.current = false;
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
    if (!queuedComposerScope) return;
    if (queueHydratingRef.current) {
      queueHydratingRef.current = false;
      return;
    }
    replacePersistedQueue(
      queuedComposerScope,
      queuedComposerMessages.map((item) => toPersistedQueuedComposerMessage(item)),
    );
  }, [queuedComposerMessages, queuedComposerScope, replacePersistedQueue]);

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
      await onSubmit(payload);
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
      queueFlushInFlightRef.current
    ) {
      return;
    }

    const [nextQueuedMessage] = queuedComposerMessages;
    if (!nextQueuedMessage || nextQueuedMessage.requiresAttachmentRebind) return;

    queueFlushInFlightRef.current = true;
    setQueuedComposerMessages((previous) => previous.slice(1));

    void sendMessageRef
      .current(nextQueuedMessage.text, {
        queuedAttachmentItems: nextQueuedMessage.attachmentItems,
        queuedFiles: nextQueuedMessage.files,
        queuedMessageId: nextQueuedMessage.id,
      })
      .then((sent) => {
        if (!sent) {
          setQueuedComposerMessages((previous) => [nextQueuedMessage, ...previous]);
        }
      })
      .catch(() => {
        setQueuedComposerMessages((previous) => [nextQueuedMessage, ...previous]);
      })
      .finally(() => {
        queueFlushInFlightRef.current = false;
      });
  }, [canStopSession, queuedComposerMessages, sessionBusyState, stoppingStream, streaming]);

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

    // Menu items
    slashCommandItems,
    mentionItems,
  };
}
