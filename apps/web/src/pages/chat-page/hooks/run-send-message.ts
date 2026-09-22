/**
 * `sendMessage` 的逻辑体（P4b 原样搬家）。
 *
 * `ChatPage` 保留原位 `async function sendMessage` 声明（维持函数提升，供其前的
 * 依赖数组引用），并在函数体内构造 deps —— 调用时才求值，无 TDZ、无顺序变化。
 */

import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { isImageFile } from '../../../components/conversation-runtime/attachments/attachment-upload.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  dismissPermissionEventMessage,
  hasActivePendingPermissionRequest,
  matchClientSlashCommand,
  matchServerSlashCommand,
  parseToolCallInputText,
  sanitizeComposerPlainText,
  upsertPermissionEventMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import type {
  AssistantTraceToolCall,
  ChatMessage,
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import { shouldShowRunEventInTranscript } from '../../../components/conversation-runtime/messages/transcript-visibility.js';
import { isAutoAcceptEnabled } from '../../../components/conversation-runtime/session/permission-auto-respond.js';
import { createRoundAssistantRequestId } from '../../../components/conversation-runtime/stream/round-request-id.js';
import {
  hasGatewayAdvancedRound,
  resolveNextRoundIndex,
  shouldStartNewRound,
} from '../../../components/conversation-runtime/stream/stream-round-boundary.js';
import { mergeChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  markStreamingReasoningSegmentEnded,
  upsertStreamingToolSegment,
} from '../../../components/conversation-runtime/stream/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  buildStreamingThinkingChunkDeliveryKey,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
} from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { UseSessionTerminalsResult } from '../../../components/conversation-runtime/terminals/use-session-terminals.js';
import {
  formatGatewayStreamErrorMessage,
  useGatewayClient,
} from '../../../hooks/gateway/useGatewayClient.js';

import type {
  ChatSettingsModel,
  ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import { logger } from '../../../utils/log/logger.js';
import { replyPermissionRequest } from '../../../utils/permission/permission-reply.js';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
} from '../../../utils/session/session-list-events.js';
import { prepareImageGenerationInput } from '.././conversation/composer/prepare-image-generation-input.js';
import { prepareStandardChatSendInput } from '.././conversation/composer/prepare-standard-chat-send-input.js';
import { deleteQueuedComposerFiles } from '.././conversation/composer/queued-composer-file-store.js';
import { executeServerCommand } from '.././conversation/composer/server-command-item.js';
import { startStandardChatStream } from '.././conversation/composer/start-standard-chat-stream.js';
import { submitImageGeneration } from '.././conversation/composer/submit-image-generation.js';
import {
  applySessionChildRuntimeEvent,
  applyTaskUpdateRuntimeEvent,
} from '.././conversation/render/apply-session-runtime-event.js';
import {
  applyStreamToolProgress,
  applyStreamToolResult,
} from '.././conversation/render/apply-stream-tool-event.js';
import { buildStreamAssistantTrace } from '.././conversation/render/build-stream-assistant-trace.js';
import { isImmediatelyRenderableStructuredContent } from '.././conversation/render/chat-page-utils.js';
import type { LiveToolCallState } from '.././conversation/render/chat-page-utils.js';
import { commitStreamingRound } from '.././conversation/render/commit-streaming-round.js';
import { detectTerminalDevServer } from '.././conversation/render/detect-terminal-dev-server.js';
import { finalizeStreamMessage } from '.././conversation/render/finalize-stream-message.js';
import { handlePendingInteractionEvent } from '.././conversation/render/handle-pending-interaction-event.js';
import type { ImageEditReferenceArtifact } from '.././conversation/render/image-edit-reference-artifacts.js';
import { shouldSendExplicitStreamModelSelection } from '.././conversation/settings/model-selection-source.js';
import type { ModelSelectionSource } from '.././conversation/settings/model-selection-source.js';
import { resolveChatThinkingRequest } from '.././conversation/settings/resolve-chat-thinking-request.js';
import type { SessionImageGenerationResponse } from '.././hooks/use-chat-image-generation.js';
import type { DialogueMode } from '.././mode/dialogue-mode.js';
import {
  applyChatRightPanelChunk,
  applyChatRightPanelEvent,
  clearResolvedPendingPermissionToolCalls,
  startChatRightPanelRun,
} from '.././state/chat-stream-state.js';
import type { ChatRightPanelState } from '.././state/chat-stream-state.js';
import type {
  CommandDescriptor,
  CommandResultCard,
  InputImageContent,
  PendingPermissionRequest,
  RunEvent,
  StreamThinkingChunk,
  UpstreamRouteDescriptor,
  UpstreamStreamSummary,
} from '@openAwork/shared';
import type { AttachmentItem } from '@openAwork/shared-ui';
import {
  createPendingPermissionRequestSnapshot,
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
import type { PendingQuestionRequest, Session, SessionTask } from '@openAwork/web-client';

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

export interface SendMessageDeps {
  readonly activeModelOption: ChatSettingsModel | undefined;
  readonly activeProvider: ChatSettingsProvider | undefined;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean | undefined } | undefined,
  ) => void;
  readonly appendCommandCard: (card: CommandResultCard) => void;
  readonly appendImageGenerationSummaryMessage: (input: {
    artifactTitle: string;
    messageSummary: string;
    modelId: string;
    providerId: string;
    revisedPrompt: string | null;
    sourcePrompt: string;
  }) => void;
  readonly bumpCompanionPanelSignal: () => void;
  readonly client: ReturnType<typeof useGatewayClient>;
  readonly composerCommandDescriptors: CommandDescriptor[];
  readonly currentAssistantStreamMessageIdRef: MutableRefObject<string | null>;
  readonly currentSessionId: string | null;
  readonly devServerDetectedTerminalIdsRef: RefObject<Set<string>>;
  readonly dialogueMode: DialogueMode;
  readonly effectiveAgentId: string | undefined;
  readonly effectiveModelId: string;
  readonly effectiveProviderId: string;
  readonly ensureSession: () => Promise<string>;
  readonly gatewayUrl: string;
  readonly generateImageForSession: (params: {
    inputArtifacts?:
      | { artifactId: string; fileName?: string | undefined; mimeType?: string | undefined }[]
      | undefined;
    prompt: string;
    sessionId: string;
  }) => Promise<SessionImageGenerationResponse>;
  readonly hasConfiguredImageModel: boolean;
  readonly imageGenerationBusy: boolean;
  readonly imageGenerationMode: boolean;
  readonly imageModelLabel: string;
  readonly isFollowingRef: MutableRefObject<boolean>;
  readonly loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?:
      | {
          expectedSessionViewEpoch?: number | undefined;
          messageLimit?: number | undefined;
          replaceMessages?: boolean | undefined;
          signal?: AbortSignal | undefined;
          since?: number | undefined;
        }
      | undefined,
  ) => Promise<void>;
  readonly loadPendingQuestionForSession: (
    targetSessionId: string,
    requestId: string,
  ) => Promise<void>;
  readonly prefersReducedMotion: boolean;
  readonly queuedComposerScope: string | null;
  readonly reasoningEffort: ReasoningEffort;
  readonly remoteSessionBusyState: 'running' | 'paused' | null;
  readonly resetStreamState: () => void;
  readonly resolveAssistantCapabilityKind: (toolName: string) => AssistantTraceToolCall['kind'];
  readonly rightOpenRef: MutableRefObject<boolean>;
  readonly scheduleStreamReveal: (opts: { prefersReducedMotion: boolean }) => void;
  readonly scrollToBottom: (
    behavior?: ScrollBehavior | undefined,
    align?: 'center' | 'latest-edge' | undefined,
  ) => void;
  readonly selectedImageEditReferenceArtifact: ImageEditReferenceArtifact | null;
  readonly sessionModelSelectionSourceRef: RefObject<ModelSelectionSource | null>;
  readonly sessionModesHydrated: boolean;
  readonly sessionTerminals: UseSessionTerminalsResult;
  readonly setActiveStreamFirstTokenLatencyMs: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamRoundStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly setBrowserPreviewUrl: (url: string | null) => void;
  readonly setChildSessions: Dispatch<SetStateAction<Session[]>>;
  readonly setEditorMode: (v: boolean) => void;
  readonly setHasPendingFollowContent: Dispatch<SetStateAction<boolean>>;
  readonly setInput: Dispatch<SetStateAction<string>>;
  readonly setLatestGeneratedImageResult: Dispatch<
    SetStateAction<{ artifactId: string; artifactTitle: string; modelLabel: string } | null>
  >;
  readonly setLatestUpstreamSummary: Dispatch<SetStateAction<UpstreamStreamSummary | null>>;
  readonly setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  readonly setPendingPermissions: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  readonly setPendingQuestions: Dispatch<SetStateAction<PendingQuestionRequest[]>>;
  readonly setReportedStreamUsage: Dispatch<SetStateAction<ChatBackendUsageSnapshot | null>>;
  readonly setRightOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  readonly setRightPanelState: Dispatch<SetStateAction<ChatRightPanelState>>;
  readonly setRightTab: (
    value:
      | 'mcp'
      | 'overview'
      | 'plan'
      | 'tools'
      | 'bookmarks'
      | 'terminals'
      | 'skills'
      | 'snapshots'
      | 'history'
      | 'viz'
      | 'agent'
      | ((
          prev:
            | 'mcp'
            | 'overview'
            | 'plan'
            | 'tools'
            | 'bookmarks'
            | 'terminals'
            | 'skills'
            | 'snapshots'
            | 'history'
            | 'viz'
            | 'agent',
        ) =>
          | 'mcp'
          | 'overview'
          | 'plan'
          | 'tools'
          | 'bookmarks'
          | 'terminals'
          | 'skills'
          | 'snapshots'
          | 'history'
          | 'viz'
          | 'agent'),
  ) => void;
  readonly setSessionReloadNonce: Dispatch<SetStateAction<number>>;
  readonly setSessionStateStatus: Dispatch<
    SetStateAction<'idle' | 'running' | 'paused' | null | undefined>
  >;
  readonly setSessionTasks: Dispatch<SetStateAction<SessionTask[]>>;
  readonly setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
  readonly setStoppingStream: Dispatch<SetStateAction<boolean>>;
  readonly setStreamBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreamError: (action: SetStateAction<string | null>) => void;
  readonly setStreamThinkingBlocks: Dispatch<SetStateAction<StreamingThinkingBlock[]>>;
  readonly setStreamThinkingBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreaming: Dispatch<SetStateAction<boolean>>;
  readonly setStreamingSegments: Dispatch<SetStateAction<ChatMessagePart[]>>;
  readonly stoppingStreamRef: MutableRefObject<boolean>;
  readonly streamRevealNextAllowedAtRef: MutableRefObject<number>;
  readonly streamRevealTargetCodePointsRef: MutableRefObject<string[]>;
  readonly streamRevealTargetRef: MutableRefObject<string>;
  readonly streamRevealVisibleCodePointCountRef: MutableRefObject<number>;
  readonly streamRevealVisibleRef: MutableRefObject<string>;
  readonly streaming: boolean;
  readonly streamingRef: MutableRefObject<boolean>;
  readonly thinkingEnabled: boolean;
  readonly token: string | null;
  readonly webSearchEnabled: boolean;
  readonly yoloMode: boolean;
  readonly INITIAL_TURN_LIMIT: 10;
}

export async function runSendMessage(
  deps: SendMessageDeps,
  overrideText?: string,
  options?: {
    existingInputParts?: InputImageContent[];
    forcedSessionId?: string;
    queuedAttachmentItems?: AttachmentItem[];
    queuedFiles?: File[];
    queuedMessageId?: string;
  },
): Promise<boolean> {
  const {
    activeModelOption,
    activeProvider,
    activeSessionRef,
    appendAssistantEventMessages,
    appendCommandCard,
    appendImageGenerationSummaryMessage,
    bumpCompanionPanelSignal,
    client,
    composerCommandDescriptors,
    currentAssistantStreamMessageIdRef,
    currentSessionId,
    devServerDetectedTerminalIdsRef,
    dialogueMode,
    effectiveAgentId,
    effectiveModelId,
    effectiveProviderId,
    ensureSession,
    gatewayUrl,
    generateImageForSession,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationMode,
    imageModelLabel,
    isFollowingRef,
    loadCurrentSessionSnapshot,
    loadPendingQuestionForSession,
    prefersReducedMotion,
    queuedComposerScope,
    reasoningEffort,
    remoteSessionBusyState,
    resetStreamState,
    resolveAssistantCapabilityKind,
    rightOpenRef,
    scheduleStreamReveal,
    scrollToBottom,
    selectedImageEditReferenceArtifact,
    sessionModelSelectionSourceRef,
    sessionModesHydrated,
    sessionTerminals,
    setActiveStreamFirstTokenLatencyMs,
    setActiveStreamRoundStartedAt,
    setActiveStreamStartedAt,
    setBrowserPreviewUrl,
    setChildSessions,
    setEditorMode,
    setHasPendingFollowContent,
    setInput,
    setLatestGeneratedImageResult,
    setLatestUpstreamSummary,
    setMessages,
    setPendingPermissions,
    setPendingQuestions,
    setReportedStreamUsage,
    setRightOpen,
    setRightPanelState,
    setRightTab,
    setSessionReloadNonce,
    setSessionStateStatus,
    setSessionTasks,
    setShowScrollToBottom,
    setStoppingStream,
    setStreamBuffer,
    setStreamError,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setStreaming,
    setStreamingSegments,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streaming,
    streamingRef,
    thinkingEnabled,
    token,
    webSearchEnabled,
    yoloMode,
    INITIAL_TURN_LIMIT,
  } = deps;

  const sourceInput = sanitizeComposerPlainText(overrideText ?? '');
  const effectiveFiles = options?.queuedFiles ?? [];
  const trimmedSourceInput = sourceInput.trim();
  const matchedClientCommand =
    effectiveFiles.length === 0
      ? matchClientSlashCommand(trimmedSourceInput, composerCommandDescriptors)
      : null;
  const matchedServerCommand =
    effectiveFiles.length === 0
      ? matchServerSlashCommand(trimmedSourceInput, composerCommandDescriptors)
      : null;
  if (
    (!trimmedSourceInput && (imageGenerationMode || effectiveFiles.length === 0)) ||
    ((streaming || remoteSessionBusyState) && !matchedServerCommand && !matchedClientCommand) ||
    imageGenerationBusy
  ) {
    return false;
  }
  const requestOriginSessionId = activeSessionRef.current;
  setStreamError(null);
  let text = trimmedSourceInput;

  // ── 内置 client 命令:/open <url> ─────────────────────────────────
  // 直接打开内置浏览器到指定 URL,不发送给 LLM。
  // 支持:/open https://example.com、/open localhost:3000、/open example.com
  {
    const openMatch = text.match(/^\/open\s+(.+)$/i);
    if (openMatch) {
      const arg = openMatch[1]?.trim() ?? '';
      if (arg.length === 0) {
        toast('用法:/open <url>', 'warning');
        return false;
      }
      const normalizedUrl = (() => {
        if (/^https?:\/\//i.test(arg)) return arg;
        if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(arg)) return `https://${arg}`;
        // localhost:3000 / 127.0.0.1:5173 之类不带 schema 的本地地址
        if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(arg)) {
          return `http://${arg}`;
        }
        return arg;
      })();
      // 派发 BuiltInBrowser 监听的事件,新建 tab 并跳转。
      window.dispatchEvent(
        new CustomEvent('openawork:browser:open-url', {
          detail: { url: normalizedUrl, mode: 'newTab' },
        }),
      );
      // 同时激活浏览器面板:存到 store + 切到 browser tab
      setBrowserPreviewUrl(normalizedUrl);
      setEditorMode(true);
      toast(`已在浏览器中打开 ${normalizedUrl}`, 'success');
      return true;
    }
  }

  if (imageGenerationMode) {
    if (!hasConfiguredImageModel) {
      const message = '请先在设置中配置可用的图片模型，然后再使用图片生成模式。';
      setStreamError(message);
      toast(message, 'warning');
      return false;
    }

    let sid: string;
    try {
      sid = options?.forcedSessionId ?? (await ensureSession());
    } catch (err) {
      logger.error('session create failed', err);
      if (activeSessionRef.current === requestOriginSessionId) {
        setStreamError(err instanceof Error ? err.message : '会话创建失败');
      }
      return false;
    }

    if (activeSessionRef.current !== sid) {
      return false;
    }

    if (selectedImageEditReferenceArtifact && effectiveFiles.length > 0) {
      const message = '当前图片编辑一次只支持一张参考图，请在会话图片和新上传图片之间二选一。';
      setStreamError(message);
      toast(message, 'warning');
      return false;
    }

    if (effectiveFiles.length > 0) {
      const invalidAttachment = effectiveFiles.find((file) => !isImageFile(file));
      if (invalidAttachment) {
        const message = '图片生成模式只支持图片作为参考图，请移除非图片附件后重试。';
        setStreamError(message);
        toast(message, 'warning');
        return false;
      }
    }

    const { imageEditArtifacts, localImageInputs } = await prepareImageGenerationInput({
      files: effectiveFiles,
      gatewayUrl,
      selectedImageEditReferenceArtifact,
      sessionId: sid,
      token,
    });

    return submitImageGeneration({
      activeSessionRef,
      appendImageGenerationSummaryMessage,
      generateImageForSession,
      ...(imageEditArtifacts ? { imageEditArtifacts } : {}),
      imageModelLabel,
      ...(localImageInputs ? { localImageInputs } : {}),
      onError: (message) => {
        setStreamError(message);
        toast(message, 'error');
      },
      onQueuedMessageConsumed: () => {
        if (options?.queuedMessageId && queuedComposerScope) {
          void deleteQueuedComposerFiles({
            queueId: options.queuedMessageId,
            scope: queuedComposerScope,
          });
        }
      },
      requestSessionListRefresh,
      sessionId: sid,
      setLatestGeneratedImageResult,
      setMessages,
      setSessionReloadNonce,
      sourcePrompt: text,
      toast,
    });
  }

  if (matchedClientCommand?.action.kind === 'open_companion_panel') {
    bumpCompanionPanelSignal();
    return true;
  }

  if (matchedServerCommand) {
    // Server commands are actions, not chat messages. Clear the composer
    // immediately so the command is not left in the input while it runs.
    if (overrideText === undefined) {
      setInput('');
    }
    void executeServerCommand({
      command: matchedServerCommand,
      currentSessionId,
      gatewayUrl,
      rawInput: text,
      token,
      unavailableTitle:
        matchedServerCommand.action.kind === 'generate_handoff'
          ? '交接暂不可用'
          : matchedServerCommand.action.kind === 'compact_session'
            ? '压缩暂不可用'
            : `${matchedServerCommand.label} 暂不可用`,
      unavailableMessage: `需要先进入一个已有会话后再执行 ${matchedServerCommand.label}。`,
      onCard: (card) => appendCommandCard(card),
      onEvents: (events) => {
        setRightPanelState((prev) =>
          events.reduce((next, event) => applyChatRightPanelEvent(next, event), prev),
        );
        appendAssistantEventMessages(events);
      },
      onOpenRightPanel: () => {
        setRightOpen(true);
        setRightTab(
          matchedServerCommand.action.kind === 'compact_session' ? 'history' : 'overview',
        );
      },
    });
    requestSessionListRefresh();
    return true;
  }

  let sid: string;
  try {
    sid = options?.forcedSessionId ?? (await ensureSession());
  } catch (err) {
    logger.error('session create failed', err);
    if (activeSessionRef.current === requestOriginSessionId) {
      resetStreamState();
      setStreamError(err instanceof Error ? err.message : '会话创建失败');
    }
    return false;
  }

  if (activeSessionRef.current !== sid) {
    return false;
  }

  const preparedStandardInput = await prepareStandardChatSendInput({
    ...(options?.existingInputParts ? { existingInputParts: options.existingInputParts } : {}),
    files: effectiveFiles,
    gatewayUrl,
    sessionId: sid,
    text,
    token,
  });
  text = preparedStandardInput.text;
  const { requestInputParts, localRequestInputParts } = preparedStandardInput;

  const { displayMessageForStream, requestStartedAt, requestText } = startStandardChatStream({
    currentAssistantStreamMessageIdRef,
    // 发送消息 = 用户明确回到最新：清除中断并把视口落到底部（与回底按钮同一原语）。
    requestReturnToLatest: () => scrollToBottom('auto', 'latest-edge'),
    ...(localRequestInputParts ? { localRequestInputParts } : {}),
    onQueuedMessageConsumed: () => {
      if (options?.queuedMessageId && queuedComposerScope) {
        void deleteQueuedComposerFiles({
          queueId: options.queuedMessageId,
          scope: queuedComposerScope,
        });
      }
    },
    ...(requestInputParts ? { requestInputParts } : {}),
    setActiveStreamFirstTokenLatencyMs,
    setActiveStreamStartedAt,
    setHasPendingFollowContent,
    setMessages,
    setReportedStreamUsage,
    setSessionStateStatus,
    setShowScrollToBottom,
    setStoppingStream,
    setStreamBuffer,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setStreaming,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streamingRef,
    text,
  });
  // 第 1 轮的起点 = 请求起点；后续轮次由 `closeRoundIfGatewayAdvanced` 推进。
  setActiveStreamRoundStartedAt(requestStartedAt);
  const toolCallIds = new Set<string>();
  const liveToolCalls = new Map<string, LiveToolCallState>();
  let streamTerminalized = false;
  const requestProviderId = effectiveProviderId || undefined;
  const requestModelLabel = (activeModelOption?.label ?? effectiveModelId) || undefined;
  const shouldSendExplicitSelection = shouldSendExplicitStreamModelSelection(
    sessionModelSelectionSourceRef.current,
    { sessionModesHydrated, effectiveModelId },
  );
  const requestAgentId = effectiveAgentId || undefined;

  const buildAssistantTraceMessage = (
    messageId: string,
    textContent: string,
    finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
  ) =>
    buildStreamAssistantTrace({
      accumulatedThinkingBlocks,
      finalStatus,
      messageId,
      resolveAssistantCapabilityKind,
      textContent,
      toolCalls: liveToolCalls,
    });

  let accumulated = '';
  let accumulatedThinking = '';
  let accumulatedThinkingBlocks: StreamingThinkingBlock[] = [];
  // Ordered, wire-faithful segment list — kept alongside the legacy
  // accumulated* buffers so existing flows (thinking duration extraction,
  // stream-reveal, etc.) keep working while the UI now reads `parts`
  // straight from this list. Reset on round boundaries / cancel / done.
  let accumulatedSegments: ChatMessagePart[] = [];
  const reasoningSegmentMeta = new Map<string, { blockKey: string }>();
  let pendingThinkingFlushFrame: number | null = null;
  let pendingSegmentsFlushFrame: number | null = null;
  const flushThinkingState = () => {
    pendingThinkingFlushFrame = null;
    // Guard against late RAF callbacks landing after the stream was reset
    // (session switch / cancel / round-close) to prevent UI from flashing
    // stale reasoning content over the cleared buffer.
    if (!streamingRef.current || activeSessionRef.current !== sid) {
      return;
    }
    setStreamThinkingBlocks(accumulatedThinkingBlocks);
    setStreamThinkingBuffer(accumulatedThinking);
  };
  const scheduleThinkingFlush = () => {
    if (pendingThinkingFlushFrame !== null) return;
    pendingThinkingFlushFrame = window.requestAnimationFrame(flushThinkingState);
  };
  const cancelThinkingFlush = () => {
    if (pendingThinkingFlushFrame !== null) {
      window.cancelAnimationFrame(pendingThinkingFlushFrame);
      pendingThinkingFlushFrame = null;
    }
  };
  const flushSegmentsState = () => {
    pendingSegmentsFlushFrame = null;
    if (!streamingRef.current || activeSessionRef.current !== sid) return;
    setStreamingSegments(accumulatedSegments);
  };
  const scheduleSegmentsFlush = () => {
    if (pendingSegmentsFlushFrame !== null) return;
    pendingSegmentsFlushFrame = window.requestAnimationFrame(flushSegmentsState);
  };
  const cancelSegmentsFlush = () => {
    if (pendingSegmentsFlushFrame !== null) {
      window.cancelAnimationFrame(pendingSegmentsFlushFrame);
      pendingSegmentsFlushFrame = null;
    }
  };
  let firstTokenObservedAt: number | null = null;
  const deliveredThinkingChunkKeys = new Set<string>();
  let toolPanelRevealed = false;
  let pausedForPermission = false;
  let pausedForQuestion = false;
  let latestUpstreamRoute: UpstreamRouteDescriptor | null = null;
  let latestRoundUpstreamSummary: UpstreamStreamSummary | null = null;
  let currentRoundStartedAt = requestStartedAt;
  let firstTokenLatencyAttached = false;
  // 轮次边界状态（见 `stream-round-boundary`）：网关在每轮结束时回报
  // `usage.round`，客户端在下一轮内容到达时据此提交上一轮。
  let currentRoundIndex = 1;
  let lastCompletedRoundIndex: number | null = null;
  // rid 由 `client.stream()` 内部生成，调用返回后同步可读；提交闭包在事件
  // 到达时才执行，因此这里先声明、stream() 之后立即赋值。
  let streamClientRequestId: string | null = null;
  const resolveRoundModelLabel = (summary?: UpstreamStreamSummary | null): string | undefined =>
    summary?.modelId ?? latestUpstreamRoute?.modelId ?? requestModelLabel;
  const resolveRoundProviderId = (summary?: UpstreamStreamSummary | null): string | undefined =>
    summary?.providerId ?? latestUpstreamRoute?.providerId ?? requestProviderId;

  // Round boundary commit:
  // The gateway persists one assistant message per agent round (see
  // `routes/stream-model-round.ts`); the live UI must mirror that structure
  // so reasoning/tool/text parts render in the true wire order both during
  // streaming and after refresh.
  const closeCurrentStreamingRoundIntoMessage = (timestamp: number) => {
    // Cancel any pending RAF so the upcoming setStreamThinkingBlocks([])
    // / setStreamThinkingBuffer('') reset is not overwritten by a late flush.
    cancelThinkingFlush();
    cancelSegmentsFlush();
    const committed = commitStreamingRound({
      accumulated,
      accumulatedSegments,
      accumulatedThinking,
      accumulatedThinkingBlocks,
      buildTraceMessage: (messageId, textContent) =>
        buildAssistantTraceMessage(messageId, textContent, 'completed'),
      clientRequestId: streamClientRequestId
        ? createRoundAssistantRequestId(streamClientRequestId, currentRoundIndex)
        : undefined,
      currentAssistantStreamMessageIdRef,
      currentRoundStartedAt,
      firstTokenLatencyAttached,
      firstTokenObservedAt,
      liveToolCalls,
      requestAgentId,
      requestModelLabel: resolveRoundModelLabel(),
      requestProviderId: resolveRoundProviderId(),
      requestStartedAt,
      setMessages,
      setStreamBuffer,
      setStreamThinkingBlocks,
      setStreamThinkingBuffer,
      setStreamingSegments,
      streamRevealNextAllowedAtRef,
      streamRevealTargetCodePointsRef,
      streamRevealTargetRef,
      streamRevealVisibleCodePointCountRef,
      streamRevealVisibleRef,
      timestamp,
    });
    if (!committed) return;
    accumulated = committed.accumulated;
    accumulatedThinking = committed.accumulatedThinking;
    accumulatedThinkingBlocks = committed.accumulatedThinkingBlocks;
    accumulatedSegments = committed.accumulatedSegments;
    reasoningSegmentMeta.clear();
    liveToolCalls.clear();
    firstTokenLatencyAttached = committed.firstTokenLatencyAttached;
    currentRoundStartedAt = committed.currentRoundStartedAt;
  };

  /**
   * 网关切到下一轮时提交当前轮。必须在追加新内容之前调用（轮次边界只有在新一轮
   * 内容到达时才能观察到），且不能在 `usage` 事件上调用——本轮的工具结果在这之后
   * 才会到达，必须仍落在本轮消息里。
   */
  const closeRoundIfGatewayAdvanced = (options?: { gatewayOnly?: boolean }) => {
    const boundary = options?.gatewayOnly
      ? hasGatewayAdvancedRound({
          currentRoundIndex,
          lastCompletedRound: lastCompletedRoundIndex,
        })
      : shouldStartNewRound({
          currentRoundIndex,
          lastCompletedRound: lastCompletedRoundIndex,
          toolCalls: liveToolCalls.values(),
        });
    if (!boundary) {
      return;
    }
    const boundaryAt = Date.now();
    closeCurrentStreamingRoundIntoMessage(boundaryAt);
    // 新一轮从这一刻开始，实时气泡的 createdAt 必须跟着轮次走。
    setActiveStreamRoundStartedAt(boundaryAt);
    currentRoundIndex = resolveNextRoundIndex({
      currentRoundIndex,
      lastCompletedRound: lastCompletedRoundIndex,
    });
  };

  setRightPanelState((prev) => startChatRightPanelRun(prev, text));

  const resolvedThinkingRequest = resolveChatThinkingRequest({
    providerType: activeProvider?.type,
    modelId: activeModelOption?.id ?? effectiveModelId,
    declaredSupportsThinking: activeModelOption?.supportsThinking === true,
    thinkingEnabled,
    reasoningEffort,
  });

  client.stream(sid, requestText, {
    agentId: effectiveAgentId,
    dialogueMode,
    displayMessage: displayMessageForStream,
    model: shouldSendExplicitSelection ? effectiveModelId || 'default' : 'default',
    ...(shouldSendExplicitSelection && effectiveProviderId
      ? { providerId: effectiveProviderId }
      : {}),
    thinkingEnabled: resolvedThinkingRequest.thinkingEnabled,
    reasoningEffort: resolvedThinkingRequest.reasoningEffort,
    webSearchEnabled,
    yoloMode,
    ...(requestInputParts ? { inputParts: requestInputParts } : {}),
    onEvent: (event) => {
      if (activeSessionRef.current !== sid) {
        return;
      }

      if (event.type === 'upstream_route') {
        latestUpstreamRoute = {
          modelId: event.modelId,
          ...(event.providerId ? { providerId: event.providerId } : {}),
        };
      }

      if ((event.type === 'done' || event.type === 'error') && event.upstreamSummary) {
        latestRoundUpstreamSummary = event.upstreamSummary;
        const nextRouteModelId = event.upstreamSummary.modelId ?? latestUpstreamRoute?.modelId;
        const nextRouteProviderId =
          event.upstreamSummary.providerId ?? latestUpstreamRoute?.providerId;
        if (nextRouteModelId) {
          latestUpstreamRoute = {
            modelId: nextRouteModelId,
            ...(nextRouteProviderId ? { providerId: nextRouteProviderId } : {}),
          };
        }
        setLatestUpstreamSummary(event.upstreamSummary);
      }

      if (event.type === 'tool_call_delta') {
        // First-token latency is "time-to-first-content of any kind".
        // Without this, reasoning-heavy rounds that emit tool calls before
        // any text delta would render "首 token --" forever even though the
        // model has clearly started producing output. The same observation
        // is later attached to the first finalized round (gated by
        // `firstTokenLatencyAttached`) so this does not double-count.
        if (firstTokenObservedAt === null) {
          firstTokenObservedAt = event.occurredAt ?? Date.now();
          setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
        }
        // 新一轮可能以裸工具调用开头（链式工具调用，没有文本/思考），此处只用
        // 网关轮次信号判断，见 `closeRoundIfGatewayAdvanced`。
        closeRoundIfGatewayAdvanced({ gatewayOnly: true });
        toolCallIds.add(event.toolCallId);
        const previous = liveToolCalls.get(event.toolCallId);
        const nextInputText = `${previous?.inputText ?? ''}${event.inputDelta}`;
        liveToolCalls.set(event.toolCallId, {
          createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
          inputText: nextInputText,
          output: previous?.output,
          isError: previous?.isError,
          resumedAfterApproval: previous?.resumedAfterApproval,
          toolCallId: event.toolCallId,
          status: 'streaming',
          toolName: event.toolName,
        });
        // Mirror into the ordered segment list — first delta opens a new
        // tool segment positioned at the current end of the list, later
        // deltas update the segment in place with the parsed input.
        accumulatedSegments = upsertStreamingToolSegment(accumulatedSegments, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: parseToolCallInputText(nextInputText),
          status: 'running',
          kind: resolveAssistantCapabilityKind(event.toolName) as
            'agent' | 'mcp' | 'skill' | 'tool' | undefined,
        });
        scheduleSegmentsFlush();
      }

      if (event.type === 'usage') {
        // 网关在该轮结束时回报轮次序号；仅记录，边界在下一轮内容到达时应用。
        lastCompletedRoundIndex = Math.max(lastCompletedRoundIndex ?? 0, event.round);
        setReportedStreamUsage((previous) => mergeChatBackendUsageSnapshot(previous, event));
      }

      if (
        event.type === 'terminal_started' ||
        event.type === 'terminal_output' ||
        event.type === 'terminal_exited'
      ) {
        sessionTerminals.applyRunEvent(event);

        // Auto-detect dev-server URLs from terminal output
        if (
          (event.type === 'terminal_output' || event.type === 'terminal_started') &&
          !devServerDetectedTerminalIdsRef.current.has((event as { terminalId: string }).terminalId)
        ) {
          const terminalEvent =
            event.type === 'terminal_output'
              ? {
                  type: 'terminal_output' as const,
                  outputTail: (event as { outputTail: string }).outputTail,
                  terminalId: (event as { terminalId: string }).terminalId,
                }
              : {
                  type: 'terminal_started' as const,
                  command: (event as { command: string }).command,
                  terminalId: (event as { terminalId: string }).terminalId,
                };
          const detected = detectTerminalDevServer({
            detectedTerminalIds: devServerDetectedTerminalIdsRef.current,
            event: terminalEvent,
          });
          if (detected.shouldMarkTerminalHandled) {
            devServerDetectedTerminalIdsRef.current.add(terminalEvent.terminalId);
          }
          if (detected.detectedUrl) {
            setBrowserPreviewUrl(detected.detectedUrl);
            // Open the editor pane with browser preview instead of right panel
            setEditorMode(true);
          }
        }
      }

      if (event.type === 'tool_progress') {
        applyStreamToolProgress({ event, liveToolCalls });
      }

      if (event.type === 'tool_result') {
        toolCallIds.add(event.toolCallId);
        const hasPendingPermission = hasActivePendingPermissionRequest(event);
        const { accumulatedSegments: nextSegments, rawPendingPermissionRequestId } =
          applyStreamToolResult({
            accumulatedSegments,
            event,
            hasPendingPermission,
            liveToolCalls,
          });
        accumulatedSegments = nextSegments;
        scheduleSegmentsFlush();
        setMessages((previousMessages) => {
          const nextMessages = applyToolResultToLocalAssistantMessages(previousMessages, event);
          return typeof rawPendingPermissionRequestId === 'string' &&
            rawPendingPermissionRequestId.length > 0 &&
            !hasPendingPermission
            ? dismissPermissionEventMessage(nextMessages, rawPendingPermissionRequestId)
            : nextMessages;
        });
        if (
          typeof rawPendingPermissionRequestId === 'string' &&
          rawPendingPermissionRequestId.length > 0 &&
          !hasPendingPermission
        ) {
          setPendingPermissions((previousPermissions) =>
            previousPermissions.filter(
              (permission) => permission.requestId !== rawPendingPermissionRequestId,
            ),
          );
        }
      }

      if (event.type === 'session_child') {
        setChildSessions((previous) => applySessionChildRuntimeEvent(previous, event));
      }

      if (event.type === 'task_update') {
        setSessionTasks((previous) => applyTaskUpdateRuntimeEvent(previous, event));
      }

      if (
        event.type === 'permission_asked' ||
        event.type === 'permission_replied' ||
        event.type === 'question_asked' ||
        event.type === 'question_replied'
      ) {
        const handledPendingInteraction = handlePendingInteractionEvent({
          event,
          gatewayUrl,
          isAutoAcceptEnabled,
          onPermissionAsked: (permissionEvent) => {
            setSessionStateStatus('paused');
            setMessages((previous) => upsertPermissionEventMessage(previous, permissionEvent));
            setPendingPermissions((previous) => {
              return dedupePendingPermissionRequests([
                createPendingPermissionRequestSnapshot(permissionEvent, sid),
                ...previous,
              ]);
            });
          },
          onPermissionAskedAutoReplyFallback: (permissionEvent) => {
            setSessionStateStatus('paused');
            setMessages((previous) => upsertPermissionEventMessage(previous, permissionEvent));
          },
          onPermissionReplied: (permissionEvent) => {
            if (permissionEvent.decision !== 'reject') {
              setSessionStateStatus('running');
            }
            setMessages((previous) =>
              dismissPermissionEventMessage(
                applyPermissionDecisionToLocalAssistantMessages(
                  previous,
                  permissionEvent.requestId,
                  permissionEvent.decision,
                  permissionEvent.feedback,
                ),
                permissionEvent.requestId,
              ),
            );
            setPendingPermissions((previous) =>
              previous.filter((permission) => permission.requestId !== permissionEvent.requestId),
            );
            setRightPanelState((previous) =>
              clearResolvedPendingPermissionToolCalls(
                previous,
                permissionEvent.requestId,
                permissionEvent.decision,
              ),
            );
          },
          onQuestionAsked: (questionEvent) => {
            setSessionStateStatus('paused');
            resetStreamState();
            void loadPendingQuestionForSession(sid, questionEvent.requestId);
          },
          onQuestionReplied: (questionEvent) => {
            setSessionStateStatus(questionEvent.status === 'answered' ? 'running' : 'idle');
            setPendingQuestions((previous) =>
              previous.filter((q) => q.requestId !== questionEvent.requestId),
            );
          },
          pausedForPermission,
          pausedForQuestion,
          refreshCurrentSession: () => requestCurrentSessionRefresh(sid),
          requestSessionListRefresh,
          replyPermissionRequest,
          sessionId: sid,
          token,
        });
        pausedForPermission = handledPendingInteraction.pausedForPermission;
        pausedForQuestion = handledPendingInteraction.pausedForQuestion;
      }

      setRightPanelState((prev) => {
        if (
          event.type === 'tool_call_delta' ||
          event.type === 'tool_search' ||
          event.type === 'done' ||
          event.type === 'error'
        ) {
          return applyChatRightPanelChunk(prev, event);
        }
        return applyChatRightPanelEvent(prev, event);
      });

      if (!isFollowingRef.current) {
        setHasPendingFollowContent((previous) => previous || true);
      }

      if (shouldShowRunEventInTranscript(event)) {
        appendAssistantEventMessages([event]);
      }
    },
    onDelta: (delta: string) => {
      if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
        return;
      }
      if (firstTokenObservedAt === null) {
        firstTokenObservedAt = Date.now();
        setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
      }
      // 网关已结束上一轮时，到来的正文属于下一轮，先提交当前轮，否则实时视图会
      // 渲染出 `tool → text` 单条气泡，刷新后被拆成两条。
      closeRoundIfGatewayAdvanced();
      accumulated += delta;
      // Mirror the delta into the ordered segment list so the live render
      // reflects the true wire-arrival order. Coalesces consecutive text
      // deltas into a single trailing text segment if no other segment
      // (reasoning / tool) was recorded between them.
      const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
      accumulatedSegments = appendStreamingTextDelta(accumulatedSegments, delta, messageId);
      scheduleSegmentsFlush();
      streamRevealTargetRef.current = accumulated;
      streamRevealTargetCodePointsRef.current.push(...Array.from(delta));
      const shouldRevealStructuredContentImmediately =
        isImmediatelyRenderableStructuredContent(accumulated);
      if (prefersReducedMotion || shouldRevealStructuredContentImmediately) {
        streamRevealVisibleRef.current = accumulated;
        streamRevealVisibleCodePointCountRef.current =
          streamRevealTargetCodePointsRef.current.length;
        streamRevealNextAllowedAtRef.current = 0;
        setStreamBuffer(accumulated);
      } else {
        scheduleStreamReveal({ prefersReducedMotion });
      }
      if (!isFollowingRef.current) {
        setHasPendingFollowContent((previous) => previous || true);
      }
    },
    onThinkingDelta: (chunk: StreamThinkingChunk) => {
      if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
        return;
      }

      // First-token latency tracks "time-to-first-content of any kind".
      // For reasoning models, the very first response chunk is typically
      // a thinking delta (sometimes minutes before any text token), so we
      // must capture it here too — otherwise rounds that emit reasoning
      // and then a tool call without text would render "首 token --" even
      // when the gateway has clearly delivered tokens.
      if (firstTokenObservedAt === null) {
        firstTokenObservedAt = Date.now();
        setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
      }

      const thinkingChunkKey = buildStreamingThinkingChunkDeliveryKey(chunk);
      if (deliveredThinkingChunkKeys.has(thinkingChunkKey)) return;
      deliveredThinkingChunkKeys.add(thinkingChunkKey);

      // 轮次边界判定见 `closeRoundIfGatewayAdvanced`（此前用 `liveToolCalls.size > 0`
      // 会把同一轮内 `tool_call → reasoning` 的交错错误拆成两条消息）。
      closeRoundIfGatewayAdvanced();

      accumulatedThinkingBlocks = appendStreamingThinkingChunk(accumulatedThinkingBlocks, chunk, {
        forceNewBlock: accumulatedSegments[accumulatedSegments.length - 1]?.type !== 'reasoning',
      });
      accumulatedThinking = joinStreamingThinkingTexts(accumulatedThinkingBlocks);
      // Mirror reasoning chunks into the ordered segment list. Each
      // reasoning block has a stable identity (itemId/outputIndex/...) so
      // late deltas of the same block extend the existing segment in place
      // even if text/tool segments arrived between two reasoning chunks.
      const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
      accumulatedSegments = appendStreamingThinkingDelta(
        accumulatedSegments,
        reasoningSegmentMeta,
        chunk,
        messageId,
      );
      scheduleSegmentsFlush();
      // Coalesce per-chunk setState into one React commit per animation frame
      // — SSE `EventSource.onmessage` runs outside React's batching scope, so
      // an unthrottled setState here would force a synchronous render (incl.
      // markdown / rehype-highlight) for every reasoning delta, blocking the
      // main thread for 100–400ms on dense streams.
      scheduleThinkingFlush();
    },
    onThinkingEnd: (chunk) => {
      if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
        return;
      }
      accumulatedThinkingBlocks = markStreamingThinkingChunkEnded(accumulatedThinkingBlocks, chunk);
      accumulatedSegments = markStreamingReasoningSegmentEnded(
        accumulatedSegments,
        reasoningSegmentMeta,
        chunk,
      );
      scheduleSegmentsFlush();
      scheduleThinkingFlush();
    },
    onToolCall: (chunk) => {
      if (activeSessionRef.current !== sid) {
        return;
      }
      toolCallIds.add(chunk.toolCallId);
      if (!toolPanelRevealed) {
        toolPanelRevealed = true;
        if (!rightOpenRef.current) {
          setRightTab('tools');
        }
      }
    },
    onDone: (stopReason, streamAgentId, cancellation, upstreamSummary) => {
      if (streamTerminalized) {
        return;
      }
      streamTerminalized = true;
      if (activeSessionRef.current !== sid) {
        requestSessionListRefresh();
        return;
      }
      // question_asked already called resetStreamState(), so an unexpected onDone
      // would create a duplicate assistant message with a fresh ID. Bail out.
      if (pausedForQuestion) {
        requestSessionListRefresh();
        return;
      }
      const resolvedUpstreamSummary = upstreamSummary ?? latestRoundUpstreamSummary;
      if (resolvedUpstreamSummary) {
        latestRoundUpstreamSummary = resolvedUpstreamSummary;
        setLatestUpstreamSummary(resolvedUpstreamSummary);
      }
      const finishedAt = Date.now();
      const resolvedStopReason = stopReason ?? 'end_turn';
      const wasCancelled = String(resolvedStopReason) === 'cancelled';
      // P1-CANCEL / T-CANCEL-08: always surface a stop reason toast.
      //   - `parent_aborted` / `ancestor_aborted` → descendant was
      //     stopped because a parent session aborted.
      //   - `user_aborted` with cascade → stopped self + N children.
      //   - bare stop / missing cancellation → short "已停止生成".
      if (wasCancelled) {
        if (cancellation) {
          const suffix = cancellation.timedOut ? '（超时）' : '';
          if (
            cancellation.reason === 'parent_aborted' ||
            cancellation.reason === 'ancestor_aborted'
          ) {
            toast(
              `本会话由${cancellation.reason === 'parent_aborted' ? '父' : '上游'}会话中断${suffix}`,
              'info',
              3200,
            );
          } else if (cancellation.descendantSessions > 0) {
            const desc = cancellation.descendantSessions;
            const streams = cancellation.cancelledStreams;
            toast(
              `已停止当前会话 + ${desc} 个子会话${
                streams > 0 ? `（共 ${streams} 个运行中请求）` : ''
              }${suffix}`,
              'success',
              3200,
            );
          } else {
            // Bare user stop — still surface a short toast so the
            // stop reason is never silent.
            toast(`已停止生成${suffix}`, 'info', 2200);
          }
        } else {
          toast('已停止生成', 'info', 2200);
        }
      }
      const isPausedForPermission = resolvedStopReason === 'tool_permission';
      const finalAccumulatedText = wasCancelled ? streamRevealVisibleRef.current : accumulated;
      const traceFinalStatus = wasCancelled
        ? 'cancelled'
        : resolvedStopReason === 'error'
          ? 'error'
          : isPausedForPermission
            ? 'paused'
            : 'completed';
      const resolvedMessageModel = resolveRoundModelLabel(resolvedUpstreamSummary);
      const resolvedMessageProviderId = resolveRoundProviderId(resolvedUpstreamSummary);
      const hasRenderableAssistantReply =
        finalAccumulatedText.trim().length > 0 ||
        accumulatedThinking.trim().length > 0 ||
        toolCallIds.size > 0;
      // Preserve cancelled / error as first-class message statuses so the
      // message meta row can show "已停止" / "错误" without depending on a
      // display preference the user may have turned off.
      const messageStatus: 'completed' | 'error' | 'cancelled' = wasCancelled
        ? 'cancelled'
        : resolvedStopReason === 'error'
          ? 'error'
          : 'completed';
      if (hasRenderableAssistantReply || !wasCancelled) {
        const msgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        const finalized = finalizeStreamMessage({
          accumulatedSegments,
          accumulatedThinking,
          agentId: streamAgentId || requestAgentId,
          buildTraceMessage: (messageId, textContent) =>
            buildAssistantTraceMessage(messageId, textContent, traceFinalStatus),
          clientRequestId: streamClientRequestId ?? undefined,
          contentText: finalAccumulatedText,
          createdAt: finishedAt,
          currentRoundStartedAt,
          firstTokenLatencyAttached,
          firstTokenObservedAt,
          messageId: msgId,
          model: resolvedMessageModel,
          providerId: resolvedMessageProviderId,
          requestStartedAt,
          setMessages,
          status: messageStatus,
          stopReason: resolvedStopReason,
          toolCallIds: new Set(liveToolCalls.keys()),
          traceFinalStatus,
        });
        firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
      } else if (wasCancelled) {
        const msgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        const finalized = finalizeStreamMessage({
          accumulatedSegments,
          accumulatedThinking,
          agentId: streamAgentId || requestAgentId,
          buildTraceMessage: (messageId, textContent) =>
            buildAssistantTraceMessage(messageId, textContent, traceFinalStatus),
          clientRequestId: streamClientRequestId ?? undefined,
          contentText: '已停止',
          createdAt: finishedAt,
          currentRoundStartedAt,
          firstTokenLatencyAttached,
          firstTokenObservedAt,
          messageId: msgId,
          model: resolvedMessageModel,
          providerId: resolvedMessageProviderId,
          requestStartedAt,
          setMessages,
          status: 'cancelled',
          stopReason: resolvedStopReason,
          toolCallIds: new Set(liveToolCalls.keys()),
          traceFinalStatus,
        });
        firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
      }
      setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
      resetStreamState();
      // 流式完成后延迟快照恢复，给服务器足够时间持久化消息。
      // 使用较短的延迟（800ms）避免用户感知到不一致，同时确保服务器已完成持久化。
      window.setTimeout(() => {
        void loadCurrentSessionSnapshot(sid, {
          messageLimit: INITIAL_TURN_LIMIT,
        }).catch(() => undefined);
      }, 800);
      requestSessionListRefresh();
    },
    onError: (code: string, message?: string, technicalDetail?: string) => {
      if (activeSessionRef.current !== sid) {
        requestSessionListRefresh();
        return;
      }
      if (pausedForPermission || pausedForQuestion) {
        requestSessionListRefresh();
        return;
      }
      const finishedAt = Date.now();
      const resolvedMessage = formatGatewayStreamErrorMessage(code, message, technicalDetail);
      const errorContent = `[错误: ${code}] ${resolvedMessage}`;
      logger.error('stream error', `${code}: ${resolvedMessage}`);
      const errorMsgId = makeOrderedMessageId();
      const resolvedMessageModel = resolveRoundModelLabel(latestRoundUpstreamSummary);
      const resolvedMessageProviderId = resolveRoundProviderId(latestRoundUpstreamSummary);
      const finalized = finalizeStreamMessage({
        accumulatedSegments: [],
        accumulatedThinking,
        agentId: requestAgentId,
        buildTraceMessage: (messageId, textContent) =>
          buildAssistantTraceMessage(messageId, textContent, 'error'),
        clientRequestId: streamClientRequestId ?? undefined,
        contentText: errorContent,
        createdAt: finishedAt,
        currentRoundStartedAt,
        firstTokenLatencyAttached,
        firstTokenObservedAt,
        messageId: errorMsgId,
        model: resolvedMessageModel,
        providerId: resolvedMessageProviderId,
        requestStartedAt,
        setMessages,
        status: 'error',
        stopReason: 'error',
        toolCallIds: new Set(liveToolCalls.keys()),
      });
      firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
      setSessionStateStatus('idle');
      resetStreamState();
      setStreamError(resolvedMessage);
      requestSessionListRefresh();
    },
  });
  streamClientRequestId = client.getActiveStreamClientRequestId();
  return true;
}
