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
  persistQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from '../../../pages/chat-page/conversation/composer/queued-composer-file-store.js';
import { useComposerQueueBackend } from '../../../pages/chat-page/conversation/composer/use-composer-queue-backend.js';
import type { ComposerQueueBatchClaim, ComposerQueueClaimResult } from '@openAwork/web-client';
import { onQueuedMessageSendRejected } from '../../../utils/chat/composer-queue-events.js';
import type {
  ComposerMenuState,
  WorkspaceFileMentionItem,
} from '../../conversation-runtime/messages/support.js';
import { sanitizeComposerPlainText } from '../../conversation-runtime/messages/support.js';
import { DEFAULT_IMAGE_GENERATION_SIZE, IMAGE_GENERATION_COUNT_RANGE } from '@openAwork/shared';
import type { ImageGenerationPartialImage } from '@openAwork/web-client';
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

/**
 * 未注入 {@link SavedChatImageDefaults} 时的兜底值。
 * 之前这里是用 `as` 断言硬压过去的对象，新增字段不会同步补齐，
 * 控件会读到 `undefined`（下拉框看起来「什么都没选」）——改成完整字面量。
 */
const FALLBACK_IMAGE_GENERATION_DEFAULTS: SavedChatImageDefaults = {
  providerId: '',
  modelId: '',
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
  moderation: 'auto',
  count: IMAGE_GENERATION_COUNT_RANGE.min,
  maskArtifactId: null,
};

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
  imageGenerationPreview?: ImageGenerationPartialImage | null;
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

/**
 * 队列附件「同步到网关」的统一包装：try → finally 收尾（**无 catch**：全程静默降级，
 * 任何一步失败都只意味着「这条消息不跨端」，本端自动发送不受影响）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持「无 catch 的 try」与 finally 子句，本 hook
 * 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runQueuedAttachmentSyncOnce(ctx: {
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } finally {
    ctx.onFinally();
  }
}

/**
 * 认领待发队列条目的发送权（网关侧单飞锁）。
 *
 * 返回 `null` 表示「没问成」（网关不可达）——调用方保留本地条目并退避重试。
 * 必须留在模块级：try 内的 `??` / 数组链式调用都是值块，会让编译器报
 * "Support value blocks … within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
async function claimQueuedMessageOnBackend(ctx: {
  /** 队列 hook 的 `claimMany`（逐方法解构出来的稳定引用）。 */
  claimMany: (itemIds: readonly string[]) => Promise<ComposerQueueBatchClaim[]>;
  queue: readonly QueuedComposerMessage[];
  messageId: string;
}): Promise<ComposerQueueBatchClaim | ComposerQueueClaimResult | null> {
  try {
    const batchItemIds = ctx.queue.slice(0, 8).map((item) => item.id);
    const claimResults = await ctx.claimMany(batchItemIds);
    return (
      claimResults.find((result) => result.itemId === ctx.messageId) ?? {
        claimed: false,
        reason: 'held_by_other',
      }
    );
  } catch (error) {
    // 没问成（网关不可达）：状态未知，**保留**本地条目并退避重试。
    // 若在这里移除，消息会静默消失；硬发则可能出现重复——都不接受。
    logger.warn('待发队列发送权认领失败，稍后重试', error);
    return null;
  }
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
    imageGenerationDefaults = FALLBACK_IMAGE_GENERATION_DEFAULTS,
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
    persistHistoryEntries,
  } = useComposerInputHistory({
    input,
    setInput,
    historyScope: inputHistoryScope,
    textareaRef,
    persistence: { gatewayUrl, sessionId, token },
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
    claimMany: claimQueueItemsOnBackend,
    discardQueuedAttachmentArtifacts,
    downloadQueuedAttachments,
    enqueue: enqueueOnBackend,
    hydrate: hydrateQueueFromBackend,
    releaseClaim: releaseQueueClaimOnBackend,
    remove: removeQueueItemFromBackend,
    updateQueuedAttachments: updateQueuedAttachmentsOnBackend,
    uploadQueuedAttachments,
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
  // 渲染期直接写 ref 会被编译器判为 "Cannot update ref during render" 并放弃优化整个 hook，
  // 故与上面的 `queuedComposerScopeRef` 一致改走 useLayoutEffect 同步；读取点全在事件 /
  // 异步回调（入队回滚）里，晚于提交，拿到的仍是最新值。
  useLayoutEffect(() => {
    liveAttachmentCountRef.current = attachmentItems.length;
  }, [attachmentItems.length]);

  /**
   * 正在上传跨端副本的条目 id。
   *
   * 同一条目可能被两处同时触发上传：入队后的补传，以及水合时的补齐
   * （`backfillQueuedAttachmentRefs`）。两次并发上传会各自产出一份副本并互相覆盖
   * `attachmentItems`——后写入的赢，先完成的那份从此无人引用，成为不会被回收的孤儿，
   * 流量与磁盘都白付。按条目 id 串行化，后到者直接放弃（前者的结果同样会回填）。
   */
  const queuedAttachmentUploadsRef = useRef<Set<string>>(new Set());

  /**
   * 入队落库成功后，把附件跨端副本补传到网关并回填条目。
   *
   * 与入队**解耦**是刻意的：Enter 即入队（本地 + 服务端记录）不能被大附件上传的
   * 网络耗时拖慢；上传完成前换端只是暂时看到「需重新选择附件」，完成后自动补齐。
   * 任何一步失败都只意味着「这条消息不跨端」，本端自动发送不受影响，故全程静默降级。
   */
  const syncQueuedAttachmentsToGateway = useCallback(
    async (item: QueuedComposerMessage, scope: string): Promise<void> => {
      if (queuedAttachmentUploadsRef.current.has(item.id)) {
        return;
      }
      queuedAttachmentUploadsRef.current.add(item.id);
      // try/finally 下沉到模块级 `runQueuedAttachmentSyncOnce`（见其注释）。
      await runQueuedAttachmentSyncOnce({
        onFinally: () => {
          queuedAttachmentUploadsRef.current.delete(item.id);
        },
        run: async () => {
          const uploadedItems = await uploadQueuedAttachments({
            attachmentItems: item.attachmentItems,
            files: item.files,
          });
          if (!uploadedItems) {
            return;
          }
          const outcome = await updateQueuedAttachmentsOnBackend(item.id, {
            attachmentItems: uploadedItems,
            // 副本已就绪，两个「需重新选择」的成因此其消失：本地写入失败与无跨端副本。
            requiresAttachmentRebind: false,
          });
          if (outcome === 'missing') {
            // 上传期间条目已被消费 / 移出（例如会话恰好空闲、flush 已经把它发走）：刚上传
            // 的副本没有消费者，就地回收，避免留下孤儿磁盘文件。
            await discardQueuedAttachmentArtifacts(
              uploadedItems.flatMap((entry) => (entry.artifactId ? [entry.artifactId] : [])),
            );
            return;
          }
          if (outcome !== 'updated') {
            return;
          }
          // 只有回填确实成功才更新内存条目：否则本端展示的 attachmentItems 会领先于
          // 服务端，一旦此刻刷新，服务端仍是「无副本」，本端却以为跨端可用。
          if (queuedComposerScopeRef.current !== scope) {
            return;
          }
          setQueuedComposerMessages((previous) =>
            previous.map((entry) =>
              entry.id === item.id
                ? { ...entry, attachmentItems: uploadedItems, requiresAttachmentRebind: false }
                : entry,
            ),
          );
        },
      });
    },
    [
      discardQueuedAttachmentArtifacts,
      setQueuedComposerMessages,
      updateQueuedAttachmentsOnBackend,
      uploadQueuedAttachments,
    ],
  );

  /**
   * 水合时补齐「有本地文件但完全没有跨端副本」的条目。
   *
   * 覆盖两种断链：入队时上传失败（网关抖动 / 超限），以及上传进行中被刷新打断。
   * 只处理「全无 `artifactId`」的条目——部分缺失不会由本实现产生，而按条重传会
   * 覆盖已有引用，把旧副本变成无人回收的孤儿。顺序执行避免多条目并发打满网关。
   */
  const backfillQueuedAttachmentRefs = useCallback(
    async (items: QueuedComposerMessage[]): Promise<void> => {
      const scope = queuedComposerScopeRef.current;
      if (!scope) {
        return;
      }
      for (const item of items) {
        const hasLocalFiles = item.files.length > 0;
        const missingAllRefs =
          item.attachmentItems.length > 0 &&
          item.attachmentItems.every((attachment) => !attachment.artifactId);
        if (!hasLocalFiles || !missingAllRefs) {
          continue;
        }
        await syncQueuedAttachmentsToGateway(item, scope);
      }
    },
    [syncQueuedAttachmentsToGateway],
  );

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
        // 附件跨端副本在后台补传；入队响应不等它。
        if (queuedItem.files.length > 0 && queuedComposerScope) {
          void syncQueuedAttachmentsToGateway(queuedItem, queuedComposerScope);
        }
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
      syncQueuedAttachmentsToGateway,
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

    const movedEntries = moveInputHistoryEntries(pendingInputHistoryScope, inputHistoryScope);
    // 迁移只改内存 scope 不足以持久化：pending 期间的历史必须随会话创建写入网关。
    persistHistoryEntries(movedEntries);
  }, [
    inputHistoryScope,
    moveInputHistoryEntries,
    pendingInputHistoryEntryCount,
    pendingInputHistoryScope,
    persistHistoryEntries,
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

    /**
     * 逐条补齐附件 Blob，两级来源：
     *
     * 1. 本地 IndexedDB（快，同端刷新 / 重进会话的常见路径）；
     * 2. 网关跨端副本（`attachmentItems[].artifactId`，换设备 / 清缓存后的唯一来源）。
     *
     * 两级都拿不回来才降级为「需重新选择」——这正是换端场景从「只能重选」变成
     * 「自动续上」的关键。下载成功顺手写回 IndexedDB，让本端后续走更快的本地路径。
     */
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

          const downloadedFiles = await downloadQueuedAttachments(item.attachmentItems);
          if (downloadedFiles) {
            // 缓存写回是 best-effort：失败只是下次仍走远端下载，不影响本次恢复。
            void persistQueuedComposerFiles({
              attachmentItems: item.attachmentItems,
              files: downloadedFiles,
              queueId: item.id,
              scope: queuedComposerScope,
            });
            return {
              ...hydratedItem,
              files: downloadedFiles,
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
        const hydratedItems = await attachLocalFiles(sourceQueue);
        finishHydration(hydratedItems);
        // 自愈：入队时的副本上传可能失败或被刷新打断，条目会停在「有本地文件、
        // 无 artifactId」的状态。每次水合顺手补传一次，失败也只是下次再试。
        void backfillQueuedAttachmentRefs(hydratedItems);
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
  }, [
    backfillQueuedAttachmentRefs,
    downloadQueuedAttachments,
    hydrateQueueFromBackend,
    queuedComposerScope,
    token,
  ]);

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
      // 只在 `running` 时停冲：那时网关持有单飞锁，硬发必被拒成
      // SESSION_ALREADY_RUNNING。`paused`（等待审批 / 等待回答）时锁已释放，队列应正常
      // 发出——否则用户在等待交互期间追加的消息会一直积压到交互解除，观感就是「发不出去」。
      sessionBusyState === 'running' ||
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
      // ① 认领发送权——多端互斥 + 会话空闲校验，两者同源于网关的同一次往返。
      // 会话被单飞锁占用（另一端的请求 / 网关自己唤醒的 run / 上一回合收尾）时，
      // 网关返回 `session_running` 而不发放租约：此时硬发必被拒成
      // SESSION_ALREADY_RUNNING，用户看到的就是「当前会话已有请求正在运行。」，
      // 而条目已经出队，等于凭空丢一条消息。
      // 认领（含 try/catch 与值块）下沉到模块级 `claimQueuedMessageOnBackend`（见其注释）。
      const claimOutcome = await claimQueuedMessageOnBackend({
        claimMany: claimQueueItemsOnBackend,
        queue: queuedComposerMessages,
        messageId: nextQueuedMessage.id,
      });
      if (!claimOutcome) {
        // 没问成（网关不可达）：状态未知，**保留**本地条目并退避重试。
        // 若在这里移除，消息会静默消失；硬发则可能出现重复——都不接受。
        scheduleFlushRetry();
        return;
      }

      if (!claimOutcome.claimed) {
        if (claimOutcome.reason === 'session_running') {
          // 会话仍在跑：条目**保留**在本地队列，退避后由定时器驱动重试，
          // 绝不能在这里丢弃或触发重新水合。
          scheduleFlushRetry();
          return;
        }
        // ② 另一端正在发这条条目：本地副本作废即可，**不要**触发重新水合。
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
    claimQueueItemsOnBackend,
    queuedComposerMessages,
    queuedComposerScope,
    queueFlushRetryNonce,
    releaseQueueClaimOnBackend,
    sessionBusyState,
    stoppingStream,
    streaming,
  ]);

  // 队列来源的发送被网关单飞锁拒成 SESSION_ALREADY_RUNNING 时的回流:
  // 先幂等重写服务端记录(与 run-send-message 的兜底重入队共用同一 itemId,重复入队
  // 不产生第二条),确认落库后再回填本地——顺序不能反,否则回填触发的下一轮 flush 会
  // claim 到一条尚不存在的记录,被当作「他端持有」而把条目丢掉。
  useEffect(() => {
    return onQueuedMessageSendRejected((payload) => {
      if (payload.sessionId !== sessionId) {
        return;
      }
      void (async () => {
        const restored = await enqueueOnBackend({
          attachmentItems: payload.attachmentItems,
          enqueuedAt: Date.now(),
          id: payload.itemId,
          requiresAttachmentRebind: false,
          text: payload.text,
        });
        if (!restored) {
          return;
        }
        setQueuedComposerMessages((previous) =>
          previous.some((item) => item.id === payload.itemId)
            ? previous
            : [
                ...previous,
                {
                  attachmentItems: payload.attachmentItems,
                  files: payload.files,
                  id: payload.itemId,
                  requiresAttachmentRebind: false,
                  text: payload.text,
                },
              ],
        );
      })();
    });
  }, [enqueueOnBackend, sessionId, setQueuedComposerMessages]);

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
