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
  type PersistedQueuedComposerMessage,
  type QueuedComposerMessage,
  toPersistedQueuedComposerMessage,
} from '../../../pages/chat-page/conversation/composer/queued-composer-state.js';
import {
  deleteQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from '../../../pages/chat-page/conversation/composer/queued-composer-file-store.js';
import { useComposerQueueBackend } from '../../../pages/chat-page/conversation/composer/use-composer-queue-backend.js';
import type {
  ComposerMenuState,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import { sanitizeComposerPlainText } from '../../conversation-runtime/messages/support.js';
import { useMentionFileSearch } from './use-mention-file-search.js';
import type { MentionFileSearchFn } from './use-mention-file-search.js';
import { useChatQueueStore } from '../../../stores/chat/chat-queue.js';
import { logger } from '../../../utils/log/logger.js';
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
 * flush 失败（claim 没问成 / 发送失败）后的退避起点与上限。
 *
 * 为什么必须退避：flush 失败会 requeue，而 requeue 改的是 `queuedComposerMessages`——
 * 正是 flush effect 的依赖。没有退避，effect 会在每次重渲染后立刻重试，形成紧密循环
 * （实测同一测试内可打出数千次 onSubmit）。首次 2s 让用户几乎无感，连续失败按 2 的幂
 * 增长并封顶 30s，避免长时间故障时仍持续打请求。
 */
const QUEUE_FLUSH_BACKOFF_BASE_MS = 2_000;
const QUEUE_FLUSH_BACKOFF_MAX_MS = 30_000;

/** 第 `attempt` 次连续失败应等待多久（attempt 从 1 起）：2s → 4s → 8s → … → 30s。 */
function computeQueueFlushBackoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(QUEUE_FLUSH_BACKOFF_MAX_MS, QUEUE_FLUSH_BACKOFF_BASE_MS * 2 ** exponent);
}

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
  const queueFlushRetryTimerRef = useRef<number | null>(null);
  const [queueFlushRetryNonce, setQueueFlushRetryNonce] = useState(0);
  /** 连续 flush 失败次数，用于计算退避；成功一次即清零。 */
  const queueFlushFailureCountRef = useRef(0);
  /** 退避计数所属的 scope；切会话时据此重置，避免旧会话的失败拖慢新会话。 */
  const queueFlushBackoffScopeRef = useRef<string | null>(null);
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
  // 逐方法解构而非直接用对象：`useComposerQueueBackend` 返回的是字面量对象，每次渲染
  // 都是新引用，直接把它放进 useEffect 依赖会让水合 / 同步逻辑每帧重跑。各方法内部
  // 已是稳定引用（依赖收敛到 gatewayUrl）。
  const {
    claim: claimQueueItemOnBackend,
    enqueue: enqueueOnBackend,
    hydrate: hydrateQueueFromBackend,
    releaseClaim: releaseQueueClaimOnBackend,
    remove: removeQueueItemFromBackend,
  } = useComposerQueueBackend({ gatewayUrl, sessionId, token });
  const {
    appendFiles,
    handleFileChange,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage: enqueueComposerMessageDirect,
    removeQueuedComposerMessage: removeQueuedComposerMessageDirect,
    restoreQueuedComposerMessage: restoreQueuedComposerMessageDirect,
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
  /**
   * 当前附件数量的实时快照。
   *
   * 入队回滚时需要判断「输入框此刻是否已被用户填了新附件」——callback 闭包里的
   * `attachmentItems` 是创建时的快照，覆盖不了 await 期间发生的选择，故走 ref。
   */
  const liveAttachmentCountRef = useRef(attachmentItems.length);
  liveAttachmentCountRef.current = attachmentItems.length;
  const enqueueComposerMessage = useCallback(
    async (overrideText?: string): Promise<boolean> => {
      const queuedText = sanitizeComposerPlainText(overrideText ?? input).trim();
      const queuedItem = await enqueueComposerMessageDirect(overrideText);
      if (!queuedItem) {
        return false;
      }
      recordSubmittedInputHistory(queuedText);

      // 入队即落库——这是「刷新 / 换端不丢」的唯一保证点。写入失败必须回滚：
      // 否则用户看到「已排队」，一刷新就没了，而文本已被 clearComposerDraft 清空。
      const persisted = await enqueueOnBackend({
        attachmentItems: queuedItem.attachmentItems,
        enqueuedAt: Date.now(),
        id: queuedItem.id,
        requiresAttachmentRebind: queuedItem.requiresAttachmentRebind,
        text: queuedItem.text,
      });
      if (persisted) {
        return true;
      }

      setQueuedComposerMessages((previous) => previous.filter((item) => item.id !== queuedItem.id));
      // 把文本还回输入框而不是静默丢弃：用户可以立即重试，或改用其它发送方式。
      setInput((previous) =>
        previous.trim().length > 0 ? `${queuedItem.text}\n\n${previous}` : queuedItem.text,
      );
      // 附件同样要还回去——clearComposerDraft 已经把它们清空，不回填就等于连带丢了文件。
      // 仅在输入框此刻确实没有新附件时回填，避免覆盖用户在 await 期间新选的文件。
      if (queuedItem.files.length > 0 && liveAttachmentCountRef.current === 0) {
        setAttachedFiles(queuedItem.files);
        setAttachmentItems(queuedItem.attachmentItems);
      }
      // 条目已从队列移除，IndexedDB 里那份附件记录不再有人引用，顺手清掉避免残留。
      if (queuedComposerScope) {
        void deleteQueuedComposerFiles({
          queueId: queuedItem.id,
          scope: queuedComposerScope,
        });
      }
      setStreamError('待发队列同步到网关失败，消息已退回输入框，请重试。');
      return false;
    },
    [
      enqueueComposerMessageDirect,
      enqueueOnBackend,
      input,
      queuedComposerScope,
      recordSubmittedInputHistory,
      setAttachedFiles,
      setAttachmentItems,
      setInput,
      setQueuedComposerMessages,
      setStreamError,
    ],
  );

  // 移出队列 / 恢复到输入框都要同步删掉网关记录，否则下次水合会把用户已经
  // 主动丢弃的条目复活回来。两处都是本地优先：网关删除失败只记日志，不阻塞 UI。
  const removeQueuedComposerMessage = useCallback(
    (messageId: string) => {
      removeQueuedComposerMessageDirect(messageId);
      void removeQueueItemFromBackend(messageId);
    },
    [removeQueuedComposerMessageDirect, removeQueueItemFromBackend],
  );

  const restoreQueuedComposerMessage = useCallback(
    (messageId: string) => {
      restoreQueuedComposerMessageDirect(messageId);
      void removeQueueItemFromBackend(messageId);
    },
    [restoreQueuedComposerMessageDirect, removeQueueItemFromBackend],
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
  // 网关是队列的唯一真相源：每次进入会话都从服务端拉全量，刷新 / 换端 / 换浏览器都能
  // 恢复。localStorage 快照降级为**只读兜底**——仅当网关没问成（离线、token 未就绪）
  // 时才顶上，避免把已有队列误清空；正常路径不再写它。
  useEffect(() => {
    let cancelled = false;
    queueHydratingRef.current = true;
    queueDeletedWhileHydratingRef.current = new Set();
    if (queuedComposerScope !== null) {
      queueFlushInFlightScopesRef.current.delete(queuedComposerScope);
    }

    const localSnapshot = queuedComposerScope
      ? (useChatQueueStore.getState().queuesByScope[queuedComposerScope] ?? [])
      : [];
    // 「水合期间新追加」的判定基准：以实际采用的那份快照为准。
    let sourceIds = new Set(localSnapshot.map((item) => item.id));

    const finishHydration = (items: QueuedComposerMessage[]) => {
      if (cancelled) return;
      queueHydratingRef.current = false;
      setQueuedComposerState((previous) => {
        const deletedIds = queueDeletedWhileHydratingRef.current;
        const hydrationIds = new Set(items.map((item) => item.id));
        // 水合是异步的：期间用户可能已向当前 scope 追加了新条目（不在快照里，
        // 须保留，否则会被水合结果覆盖丢失）；也可能删除了快照里的旧条目（须尊重
        // 删除，否则会被水合结果复活）。
        const appended =
          previous.scope === queuedComposerScope
            ? previous.items.filter((item) => !sourceIds.has(item.id) && !hydrationIds.has(item.id))
            : [];
        return {
          scope: queuedComposerScope,
          items: [...items.filter((item) => !deletedIds.has(item.id)), ...appended],
        };
      });
    };

    if (!queuedComposerScope) {
      finishHydration([]);
      return () => {
        cancelled = true;
      };
    }

    /** 逐条补齐本地附件 Blob；附件拿不回来就降级为「需重新选择」。 */
    const attachLocalFiles = async (
      items: PersistedQueuedComposerMessage[],
    ): Promise<QueuedComposerMessage[]> =>
      Promise.all(
        items.map(async (item) => {
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
      );

    void (async () => {
      const serverQueue = await hydrateQueueFromBackend();
      if (cancelled) return;

      // null = 没问成（网关不可用 / 未登录），此时保留本地快照而不是清空队列。
      const sourceQueue = serverQueue ?? localSnapshot;
      sourceIds = new Set(sourceQueue.map((item) => item.id));

      if (sourceQueue.length === 0) {
        finishHydration([]);
        return;
      }

      try {
        finishHydration(await attachLocalFiles(sourceQueue));
      } catch {
        // 附件恢复整体失败：文本与附件元数据仍可用，只是要求重新选择文件。
        finishHydration(
          sourceQueue.map((item) => ({
            ...hydrateQueuedComposerMessage(item),
            requiresAttachmentRebind:
              item.requiresAttachmentRebind || item.attachmentItems.length > 0,
          })),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateQueueFromBackend, queuedComposerScope, token]);

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
    // 切会话先重置退避：新会话的队列不该被旧会话的连续失败次数拖慢。
    if (queueFlushBackoffScopeRef.current !== queuedComposerScope) {
      queueFlushBackoffScopeRef.current = queuedComposerScope;
      queueFlushFailureCountRef.current = 0;
      if (queueFlushRetryTimerRef.current !== null) {
        window.clearTimeout(queueFlushRetryTimerRef.current);
        queueFlushRetryTimerRef.current = null;
      }
    }

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

    // 退避中：交给定时器驱动下一次尝试。否则 requeue 引发的重渲染会立刻再发一遍，
    // 而 requeue 本身就是失败路径的一环 —— 不退避就是紧密循环。
    if (queueFlushRetryTimerRef.current !== null) {
      return;
    }

    const [nextQueuedMessage] = queuedComposerMessages;
    if (!nextQueuedMessage || nextQueuedMessage.requiresAttachmentRebind) return;

    const flushScope = queuedComposerScope;
    queueFlushInFlightScopesRef.current.add(flushScope);
    // 注意：这里**不能**预先摘掉队首。必须等 claim 成功后再摘——否则 claim 失败
    // （网关不可达）时条目已经被摘走，消息就静默消失了。摘除动作移到了下面各分支里。

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

    /**
     * 安排一次退避重试（claim 没问成 / 发送失败都走这里）。
     *
     * 两个作用缺一不可：
     * 1. **不让流程卡死**——claim 抛错后 effect 直接 return，本端再没有任何依赖变化能
     *    触发下一轮，条目就一直躺着；定时 bump nonce 是唯一能主动重新驱动的手段。
     * 2. **不让流程空转**——发送失败会 requeue，而 requeue 改的正是 flush effect 的依赖；
     *    不延迟就会重渲染后立刻重发，形成紧密循环。
     */
    const scheduleFlushRetry = () => {
      if (queueFlushRetryTimerRef.current !== null) {
        return;
      }
      queueFlushFailureCountRef.current += 1;
      const delayMs = computeQueueFlushBackoffMs(queueFlushFailureCountRef.current);
      queueFlushRetryTimerRef.current = window.setTimeout(() => {
        queueFlushRetryTimerRef.current = null;
        setQueueFlushRetryNonce((value) => value + 1);
      }, delayMs);
    };

    void (async () => {
      // ① 认领发送权——多端互斥的关键一步。必须先于任何发送动作。
      let ownsItem: boolean;
      try {
        ownsItem = await claimQueueItemOnBackend(nextQueuedMessage.id);
      } catch (error) {
        // 没问成（网关不可达）：所有权未知，**保留**本地条目并退避重试。
        // 若在这里移除，消息会静默消失；硬发则可能出现重复——都不接受。
        logger.warn('待发队列发送权认领失败，稍后重试', error);
        scheduleFlushRetry();
        return;
      }

      if (!ownsItem) {
        // ② 另一端正在发：本地副本作废即可，**不要**触发重新水合。
        // 那会拉回同一条仍在服务端的条目 → 再次 claim 失败 → 再次水合，形成死循环。
        // 交由持有权的那一端负责发出并删除，本端移除后自然收敛。
        setQueuedComposerMessages((previous) =>
          previous.filter((item) => item.id !== nextQueuedMessage.id),
        );
        return;
      }

      // ③ 拿到权：从本地摘除队首并发送。
      setQueuedComposerMessages((previous) => previous.slice(1));

      let sent = false;
      try {
        sent = await sendMessageRef.current(nextQueuedMessage.text, {
          queuedAttachmentItems: nextQueuedMessage.attachmentItems,
          queuedFiles: nextQueuedMessage.files,
          queuedMessageId: nextQueuedMessage.id,
        });
      } catch {
        sent = false;
      }

      if (!sent) {
        // ④ 发送失败：先交还发送权再回填，否则本条目要等租约过期才能被接手。
        await releaseQueueClaimOnBackend(nextQueuedMessage.id);
        requeue();
        // 退避后再重试：requeue 会改 effect 依赖，不锁住下一轮就会立刻重发形成紧密循环。
        scheduleFlushRetry();
        return;
      }

      // 发送成功即清零退避计数，避免一次抖动把后续正常发送也一并拖慢。
      queueFlushFailureCountRef.current = 0;
    })().finally(() => {
      queueFlushInFlightScopesRef.current.delete(flushScope);
    });
  }, [
    canStopSession,
    claimQueueItemOnBackend,
    queuedComposerMessages,
    queuedComposerScope,
    queueFlushRetryNonce,
    releaseQueueClaimOnBackend,
    sessionBusyState,
    stoppingStream,
    streaming,
  ]);

  // 卸载时清掉退避定时器，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (queueFlushRetryTimerRef.current !== null) {
        window.clearTimeout(queueFlushRetryTimerRef.current);
        queueFlushRetryTimerRef.current = null;
      }
    },
    [],
  );

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
