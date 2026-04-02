import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import {
  ChatMessageGroupList,
  type ChatRenderEntry,
  type ChatRenderGroup,
} from '../../components/chat/chat-message-group-list.js';
import { useGatewayClient } from '../../hooks/useGatewayClient.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../../components/chat/ChatPageSections.js';
import {
  createAssistantTraceContent,
  estimateTokenCount,
  type AssistantTraceToolCall,
  type ChatMessage,
} from './support.js';
import { useSubSessionDetail } from './use-sub-session-detail.js';
import type { TaskToolRuntimeLookup } from './task-tool-runtime.js';
import { requestCurrentSessionRefresh } from '../../utils/session-list-events.js';

type CancelableSessionsClient = ReturnType<typeof createSessionsClient> & {
  cancelTask: (
    token: string,
    sessionId: string,
    taskId: string,
  ) => Promise<{ cancelled: boolean; stopped: boolean }>;
};

function formatTaskStatus(status: string | undefined): string {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '待执行';
}

function getTaskStatusStyle(status: string | undefined): React.CSSProperties {
  if (status === 'running') {
    return {
      background: 'color-mix(in oklch, var(--accent) 16%, var(--surface))',
      border: '1px solid color-mix(in oklch, var(--accent) 40%, var(--border-subtle))',
      color: 'var(--accent)',
    };
  }

  if (status === 'completed') {
    return {
      background: 'color-mix(in srgb, #34d399 12%, var(--surface))',
      border: '1px solid color-mix(in srgb, #34d399 34%, var(--border-subtle))',
      color: '#86efac',
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      background: 'color-mix(in srgb, #ef4444 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, #ef4444 30%, var(--border-subtle))',
      color: '#fca5a5',
    };
  }

  return {
    background: 'color-mix(in srgb, #f59e0b 10%, var(--surface))',
    border: '1px solid color-mix(in srgb, #f59e0b 28%, var(--border-subtle))',
    color: '#fcd34d',
  };
}

function getHeadlineStatus(tasks: AssistantTraceToolCall[] | { status?: string }[]): string {
  if (tasks.some((task) => task.status === 'running')) return 'running';
  if (tasks.some((task) => task.status === 'failed')) return 'failed';
  if (tasks.some((task) => task.status === 'pending')) return 'pending';
  if (tasks.some((task) => task.status === 'completed')) return 'completed';
  if (tasks.some((task) => task.status === 'cancelled')) return 'cancelled';
  return 'pending';
}

function compactSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

function parseModelSelectionFromMetadataJson(metadataJson: string | undefined): {
  modelId: string;
  providerId: string;
  parentSessionId: string | null;
} {
  if (!metadataJson) {
    return { modelId: '', providerId: '', parentSessionId: null };
  }

  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return {
      modelId: typeof metadata['modelId'] === 'string' ? metadata['modelId'] : '',
      providerId: typeof metadata['providerId'] === 'string' ? metadata['providerId'] : '',
      parentSessionId:
        typeof metadata['parentSessionId'] === 'string' ? metadata['parentSessionId'] : null,
    };
  } catch {
    return { modelId: '', providerId: '', parentSessionId: null };
  }
}

const VISIBLE_TASK_COUNT = 5;
const SUB_SESSION_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(140px, 28vh, 240px)';
const SUB_SESSION_LATEST_FOCUS_THRESHOLD_PX = 32;
const SUB_SESSION_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;
const SUB_SESSION_LATEST_REGION_FALLBACK_PX = 320;
const SUB_SESSION_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 420;

const SUB_SESSION_CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 11px',
  borderRadius: 12,
  border: '1px solid color-mix(in oklch, var(--border) 84%, transparent)',
  background: 'color-mix(in oklch, var(--surface) 86%, transparent)',
};

const SUB_SESSION_SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-3)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const SUB_SESSION_META_PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 22,
  padding: '0 8px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in oklch, var(--surface) 78%, transparent)',
  color: 'var(--text-2)',
  fontSize: 10,
  fontWeight: 600,
};

function buildGroupedMessages(
  messages: ChatMessage[],
  taskRuntimeLookup?: TaskToolRuntimeLookup,
): ChatRenderGroup[] {
  const entries: ChatRenderEntry[] = messages.map((message) => ({
    message,
    renderContent: (currentMessage) =>
      currentMessage.status === 'streaming'
        ? renderStreamingChatMessageContentWithOptions(currentMessage.content, {
            taskRuntimeLookup,
          })
        : renderChatMessageContentWithOptions(currentMessage, { taskRuntimeLookup }),
  }));

  const groups: ChatRenderGroup[] = [];
  for (const entry of entries) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.role === entry.message.role) {
      lastGroup.entries.push(entry);
      continue;
    }

    groups.push({
      entries: [entry],
      key: entry.message.id,
      role: entry.message.role,
    });
  }

  return groups;
}

const SubSessionDetailPanel = React.memo(function SubSessionDetailPanel({
  childSessionId,
  currentUserEmail,
  gatewayUrl,
  onOpenFullSession,
  parentTaskRuntimeLookup,
  token,
}: {
  childSessionId: string | null;
  currentUserEmail: string;
  gatewayUrl: string;
  onOpenFullSession: (sessionId: string) => void;
  parentTaskRuntimeLookup?: TaskToolRuntimeLookup;
  token: string | null;
}) {
  const { error, loading, messages, pendingPermissions, refresh, session, tasks } =
    useSubSessionDetail(childSessionId, gatewayUrl, token);
  const client = useGatewayClient(token);
  const sessionsClient: CancelableSessionsClient = useMemo(
    () => createSessionsClient(gatewayUrl) as CancelableSessionsClient,
    [gatewayUrl],
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [cancellingTask, setCancellingTask] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<ChatMessage | null>(null);
  const [liveToolCalls, setLiveToolCalls] = useState<AssistantTraceToolCall[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const ignoreScrollEventsUntilRef = useRef(0);
  const isNearLatestRef = useRef(true);

  useEffect(() => {
    void childSessionId;
    setInput('');
    setStreaming(false);
    setStreamBuffer('');
    setOptimisticUserMessage(null);
    setLiveToolCalls([]);
    setSendError(null);
    setShowScrollToLatest(false);
    setHasPendingFollowContent(false);
    isNearLatestRef.current = true;
  }, [childSessionId]);

  const renderedMessages = useMemo(() => {
    const baseMessages = [...messages];
    if (optimisticUserMessage) {
      baseMessages.push(optimisticUserMessage);
    }
    if (streaming && (streamBuffer.length > 0 || liveToolCalls.length > 0)) {
      baseMessages.push({
        id: '__child_streaming__',
        role: 'assistant',
        content: createAssistantTraceContent({ text: streamBuffer, toolCalls: liveToolCalls }),
        createdAt: Date.now(),
        status: 'streaming',
        tokenEstimate: estimateTokenCount(streamBuffer),
        toolCallCount: liveToolCalls.length > 0 ? liveToolCalls.length : undefined,
      });
    }
    if (sendError) {
      baseMessages.push({
        id: '__child_error__',
        role: 'assistant',
        content: `[错误] ${sendError}`,
        createdAt: Date.now(),
        status: 'error',
        tokenEstimate: estimateTokenCount(sendError),
      });
    }
    return buildGroupedMessages(baseMessages, parentTaskRuntimeLookup);
  }, [
    liveToolCalls,
    messages,
    optimisticUserMessage,
    parentTaskRuntimeLookup,
    sendError,
    streamBuffer,
    streaming,
  ]);

  const scrollAnchorKey = `${messages.length}:${optimisticUserMessage?.id ?? ''}:${streamBuffer}:${sendError ?? ''}:${liveToolCalls.length}`;
  const headlineStatus = useMemo(() => getHeadlineStatus(tasks), [tasks]);
  const currentTaskSelection = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.sessionId === childSessionId &&
            (task.status === 'pending' || task.status === 'running'),
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null,
    [childSessionId, tasks],
  );
  const childSessionSelection = useMemo(
    () => parseModelSelectionFromMetadataJson(session?.metadata_json),
    [session?.metadata_json],
  );
  const isChildSessionBusy = streaming || session?.state_status === 'running';
  const runningTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'running').length,
    [tasks],
  );
  const completedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'completed').length,
    [tasks],
  );
  const failedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'failed').length,
    [tasks],
  );

  const getLatestAssistantAnchor = React.useCallback((): HTMLElement | null => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      return bottomRef.current;
    }

    const groups = scrollRegion.querySelectorAll<HTMLElement>(
      '[data-chat-group-root="true"][data-role="assistant"]',
    );

    return groups[groups.length - 1] ?? bottomRef.current;
  }, []);

  const isScrollRegionNearLatest = React.useCallback(
    (scrollRegion: HTMLDivElement | null): boolean => {
      if (!scrollRegion) {
        return true;
      }

      const distanceToBottom =
        scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight;
      if (distanceToBottom <= SUB_SESSION_LATEST_EDGE_VISIBILITY_THRESHOLD_PX) {
        return true;
      }

      const latestAnchor = getLatestAssistantAnchor();
      if (
        !latestAnchor ||
        latestAnchor === bottomRef.current ||
        !scrollRegion.contains(latestAnchor)
      ) {
        return (
          scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight <
          SUB_SESSION_LATEST_REGION_FALLBACK_PX
        );
      }

      const scrollRegionRect = scrollRegion.getBoundingClientRect();
      const latestAnchorRect = latestAnchor.getBoundingClientRect();
      const relativeTop = latestAnchorRect.top - scrollRegionRect.top;
      const relativeBottom = latestAnchorRect.bottom - scrollRegionRect.top;
      const focusBandTop = scrollRegion.clientHeight * 0.16;
      const focusBandBottom = scrollRegion.clientHeight * 0.92;

      return relativeBottom >= focusBandTop && relativeTop <= focusBandBottom;
    },
    [getLatestAssistantAnchor],
  );

  const scrollToLatest = React.useCallback(
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'center') => {
      const scrollRegion = scrollRegionRef.current;
      const latestAnchor = getLatestAssistantAnchor();

      isNearLatestRef.current = true;
      setShowScrollToLatest(false);
      setHasPendingFollowContent(false);

      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }

      ignoreScrollEventsUntilRef.current =
        behavior === 'smooth'
          ? performance.now() + SUB_SESSION_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS
          : 0;

      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        if (scrollRegion) {
          const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
          let nextTop = maxScrollTop;
          let shouldForceScroll = scrollRegion.clientHeight === 0;

          if (
            align === 'center' &&
            latestAnchor &&
            latestAnchor !== bottomRef.current &&
            scrollRegion.contains(latestAnchor)
          ) {
            const scrollRegionRect = scrollRegion.getBoundingClientRect();
            const latestAnchorRect = latestAnchor.getBoundingClientRect();
            shouldForceScroll =
              shouldForceScroll || scrollRegionRect.height === 0 || latestAnchorRect.height === 0;
            const latestAnchorCenter =
              scrollRegion.scrollTop +
              (latestAnchorRect.top - scrollRegionRect.top) +
              latestAnchorRect.height / 2;
            nextTop = Math.max(
              0,
              Math.min(maxScrollTop, latestAnchorCenter - scrollRegion.clientHeight / 2),
            );
          }

          if (
            shouldForceScroll ||
            Math.abs(scrollRegion.scrollTop - nextTop) > SUB_SESSION_LATEST_FOCUS_THRESHOLD_PX
          ) {
            scrollRegion.scrollTo({ top: nextTop, behavior });
          }
        } else {
          bottomRef.current?.scrollIntoView({
            behavior,
            block: align === 'center' ? 'center' : 'end',
          });
        }

        pendingScrollFrameRef.current = null;
      });
    },
    [getLatestAssistantAnchor],
  );

  const handleScrollRegion = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const region = event.currentTarget;
      if (performance.now() < ignoreScrollEventsUntilRef.current) {
        return;
      }

      const isNearLatest = isScrollRegionNearLatest(region);
      isNearLatestRef.current = isNearLatest;
      setShowScrollToLatest(!isNearLatest);
      if (isNearLatest) {
        setHasPendingFollowContent(false);
      }
    },
    [isScrollRegionNearLatest],
  );

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (renderedMessages.length === 0 && !streaming && !streamBuffer && !sendError) {
      setShowScrollToLatest(false);
      setHasPendingFollowContent(false);
      isNearLatestRef.current = true;
    }
  }, [renderedMessages.length, sendError, streamBuffer, streaming]);

  useEffect(() => {
    void scrollAnchorKey;
    if (isNearLatestRef.current) {
      const shouldCenterLatest = streaming || streamBuffer.length > 0 || liveToolCalls.length > 0;
      scrollToLatest('auto', shouldCenterLatest ? 'center' : 'latest-edge');
      return;
    }

    if (streaming || streamBuffer.length > 0 || sendError || liveToolCalls.length > 0) {
      setHasPendingFollowContent(true);
      setShowScrollToLatest(true);
    }
  }, [
    liveToolCalls.length,
    scrollAnchorKey,
    scrollToLatest,
    sendError,
    streamBuffer.length,
    streaming,
  ]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToLatest('auto', 'latest-edge');
    }
  }, [messages.length, scrollToLatest]);

  async function handleSend() {
    if (!childSessionId || !input.trim() || isChildSessionBusy || cancellingTask) {
      return;
    }

    const content = input.trim();
    const requestStartedAt = Date.now();
    const liveToolState = new Map<
      string,
      {
        inputText: string;
        output?: unknown;
        isError?: boolean;
        pendingPermissionRequestId?: string;
        toolCallId: string;
        toolName: string;
      }
    >();

    setInput('');
    setSendError(null);
    setStreaming(true);
    setStreamBuffer('');
    setLiveToolCalls([]);
    setOptimisticUserMessage({
      id: `child-user-${requestStartedAt}`,
      role: 'user',
      content,
      createdAt: requestStartedAt,
      status: 'completed',
      tokenEstimate: estimateTokenCount(content),
    });

    client.stream(childSessionId, content, {
      displayMessage: content,
      onDelta: (delta) => {
        setStreamBuffer((previous) => `${previous}${delta}`);
      },
      onDone: () => {
        setStreaming(false);
        void refresh().finally(() => {
          setOptimisticUserMessage(null);
          setStreamBuffer('');
          setLiveToolCalls([]);
        });
      },
      onError: (code, message) => {
        setStreaming(false);
        setOptimisticUserMessage(null);
        setSendError(message ? `${code}: ${message}` : code);
      },
      onEvent: (event) => {
        if (event.type !== 'tool_call_delta' && event.type !== 'tool_result') {
          return;
        }

        if (event.type === 'tool_call_delta') {
          const previous = liveToolState.get(event.toolCallId);
          liveToolState.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            inputText: `${previous?.inputText ?? ''}${event.inputDelta}`,
            output: previous?.output,
            isError: previous?.isError,
            pendingPermissionRequestId: previous?.pendingPermissionRequestId,
          });
        }

        if (event.type === 'tool_result') {
          const previous = liveToolState.get(event.toolCallId);
          liveToolState.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            inputText: previous?.inputText ?? '',
            output: event.output,
            isError: event.pendingPermissionRequestId ? false : event.isError,
            pendingPermissionRequestId: event.pendingPermissionRequestId,
          });
        }

        setLiveToolCalls(
          Array.from(liveToolState.values()).map((toolCall) => ({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: (() => {
              try {
                const parsed = JSON.parse(toolCall.inputText) as unknown;
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                  ? (parsed as Record<string, unknown>)
                  : { raw: toolCall.inputText };
              } catch {
                return toolCall.inputText.trim() ? { raw: toolCall.inputText } : {};
              }
            })(),
            output: toolCall.output,
            isError: toolCall.isError,
            pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
            status: toolCall.pendingPermissionRequestId
              ? 'paused'
              : toolCall.output !== undefined
                ? toolCall.isError
                  ? 'failed'
                  : 'completed'
                : 'running',
          })),
        );
      },
    });
  }

  async function handleCancelTask() {
    if (!token || !childSessionId || !currentTaskSelection || cancellingTask) {
      return;
    }

    setCancellingTask(true);
    setSendError(null);
    try {
      await sessionsClient.cancelTask(token, childSessionId, currentTaskSelection.id);
      await refresh();
      requestCurrentSessionRefresh(childSessionId);
      if (childSessionSelection.parentSessionId) {
        requestCurrentSessionRefresh(childSessionSelection.parentSessionId);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '取消子任务失败');
    } finally {
      setCancellingTask(false);
      setStreaming(false);
    }
  }

  if (!childSessionId) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '36px 18px',
          borderRadius: 14,
          border: '1px dashed color-mix(in oklch, var(--border) 80%, transparent)',
          background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 12,
            background: 'color-mix(in oklch, var(--accent) 14%, var(--surface))',
            border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-subtle))',
            color: 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          ◈
        </span>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>等待查看子代理</div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textAlign: 'center',
            lineHeight: 1.65,
            maxWidth: 220,
          }}
        >
          点击子代理卡片，在此查看对话、任务状态和干预入口。
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="sub-session-detail-panel"
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        gap: 10,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div style={SUB_SESSION_CARD_STYLE}>
        <div style={SUB_SESSION_SECTION_LABEL_STYLE}>代理摘要</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div
            aria-hidden="true"
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              background: 'color-mix(in oklch, var(--accent) 14%, var(--surface))',
              border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-subtle))',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            ◈
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: 'var(--text)',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={session?.title?.trim() || childSessionId}
            >
              {session?.title?.trim() || `子代理 ${childSessionId.slice(0, 8)}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
              追踪子会话对话、任务状态与实时干预。
            </div>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 7px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
              ...getTaskStatusStyle(headlineStatus),
            }}
          >
            {formatTaskStatus(headlineStatus)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={SUB_SESSION_META_PILL_STYLE} title={childSessionId}>
            {compactSessionId(childSessionId)}
          </span>
          {[
            { label: '消息', value: String(messages.length) },
            { label: '任务', value: String(tasks.length) },
            { label: '运行中', value: String(runningTaskCount) },
            { label: '已完成', value: String(completedTaskCount) },
          ].map((item) => (
            <span key={item.label} style={SUB_SESSION_META_PILL_STYLE}>
              <span style={{ color: 'var(--text-3)' }}>{item.label}</span>
              <span style={{ margin: '0 4px', opacity: 0.35 }}>·</span>
              <span style={{ color: 'var(--text)' }}>{item.value}</span>
            </span>
          ))}
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
            {failedTaskCount > 0
              ? `当前有 ${failedTaskCount} 个失败任务需要关注。`
              : '保持子代理上下文一致，必要时直接补充指令。'}
          </div>
          <button
            type="button"
            onClick={() => onOpenFullSession(childSessionId)}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--surface) 74%, transparent)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
              padding: '6px 9px',
              flexShrink: 0,
            }}
          >
            打开完整会话
          </button>
        </div>
      </div>

      {pendingPermissions.some((permission) => permission.status === 'pending') && (
        <div
          role="alert"
          aria-label="子代理正在等待权限审批"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 12,
            border: '1px solid color-mix(in srgb, #f59e0b 40%, var(--border-subtle))',
            background: 'color-mix(in srgb, #f59e0b 8%, var(--surface))',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#f59e0b',
              flexShrink: 0,
              marginTop: 4,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#fcd34d' }}>等待权限审批</div>
            {pendingPermissions
              .filter((permission) => permission.status === 'pending')
              .slice(0, 2)
              .map((permission) => (
                <div
                  key={permission.requestId}
                  style={{
                    fontSize: 10,
                    color: 'var(--text-2)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`${permission.toolName}：${permission.reason}`}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {permission.toolName}
                  </span>
                  {permission.reason ? ` · ${permission.reason}` : ''}
                </div>
              ))}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div style={SUB_SESSION_CARD_STYLE}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 7,
            }}
          >
            <div style={SUB_SESSION_SECTION_LABEL_STYLE}>任务轨迹</div>
            {failedTaskCount > 0 && (
              <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 700 }}>
                {failedTaskCount} 个失败
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tasks.slice(0, VISIBLE_TASK_COUNT).map((task, index) => (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '7px 8px',
                  borderRadius: 10,
                  background: 'color-mix(in oklch, var(--surface) 72%, transparent)',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                      color: 'var(--accent)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </span>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                    title={task.title}
                  >
                    {task.title}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 6px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    ...getTaskStatusStyle(task.status),
                  }}
                >
                  {formatTaskStatus(task.status)}
                </span>
              </div>
            ))}
          </div>
          {tasks.length > VISIBLE_TASK_COUNT && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', paddingTop: 2 }}>
              还有 {tasks.length - VISIBLE_TASK_COUNT} 条，打开完整会话查看。
            </div>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          borderRadius: 14,
          border: '1px solid color-mix(in oklch, var(--border) 84%, transparent)',
          background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 12px 9px',
            borderBottom: '1px solid color-mix(in oklch, var(--border) 84%, transparent)',
            background:
              'linear-gradient(180deg, color-mix(in oklch, var(--surface) 94%, var(--bg) 6%), color-mix(in oklch, var(--surface) 90%, transparent))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>子代理对话</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {streaming ? '正在接收…' : `${renderedMessages.length} 组`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--surface) 74%, transparent)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
              padding: '6px 9px',
              flexShrink: 0,
            }}
          >
            刷新
          </button>
        </div>
        <div
          ref={scrollRegionRef}
          onScroll={handleScrollRegion}
          data-testid="sub-session-scroll-region"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            padding: '10px 12px 12px',
            scrollPaddingBottom: SUB_SESSION_SCROLL_BOTTOM_SPACER_HEIGHT,
            scrollbarGutter: 'stable',
          }}
        >
          {loading && renderedMessages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['sub-session-skeleton-1', 'sub-session-skeleton-2', 'sub-session-skeleton-3'].map(
                (key) => (
                  <div
                    key={key}
                    style={{
                      height: 52,
                      borderRadius: 10,
                      background: 'color-mix(in oklab, var(--surface) 82%, var(--bg-2))',
                      border: '1px solid var(--border)',
                    }}
                  />
                ),
              )}
            </div>
          ) : error ? (
            <div
              style={{
                borderRadius: 12,
                border: '1px solid rgba(239, 68, 68, 0.24)',
                background: 'rgba(239, 68, 68, 0.08)',
                color: 'var(--danger)',
                padding: '11px 12px',
                fontSize: 11,
                lineHeight: 1.6,
              }}
            >
              {error}
            </div>
          ) : renderedMessages.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <ChatMessageGroupList
                activeModelId={childSessionSelection.modelId}
                activeProviderId={childSessionSelection.providerId}
                bottomRef={bottomRef}
                currentUserEmail={currentUserEmail}
                groups={renderedMessages}
                scrollRegionRef={scrollRegionRef}
              />
            </div>
          ) : (
            <div
              style={{
                border: '1px dashed var(--border-subtle)',
                borderRadius: 12,
                background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
                padding: '14px 12px',
                fontSize: 11,
                color: 'var(--text-3)',
                lineHeight: 1.7,
              }}
            >
              这个子代理还没有生成对话内容。你可以在下方直接发送一条消息进行干预。
            </div>
          )}
        </div>
        {showScrollToLatest && (
          <button
            type="button"
            data-testid="sub-session-scroll-bottom"
            onClick={() => scrollToLatest('smooth', 'latest-edge')}
            aria-label={
              streaming
                ? hasPendingFollowContent
                  ? '有新内容，恢复最新对话聚焦'
                  : '恢复最新对话聚焦'
                : '定位最新对话'
            }
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
              transform: 'translateX(-50%)',
              zIndex: 18,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 36,
              padding: '0 14px',
              maxWidth: 'calc(100% - 28px)',
              borderRadius: 999,
              border: hasPendingFollowContent
                ? '1px solid color-mix(in oklch, var(--accent) 55%, var(--border))'
                : '1px solid var(--border)',
              background: hasPendingFollowContent
                ? 'color-mix(in oklch, var(--surface) 82%, var(--accent) 18%)'
                : 'color-mix(in oklch, var(--surface) 90%, transparent)',
              color: hasPendingFollowContent ? 'var(--text)' : 'var(--text-2)',
              boxShadow: 'var(--shadow-md)',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              touchAction: 'manipulation',
            }}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
            {streaming
              ? hasPendingFollowContent
                ? '有新内容 · 恢复聚焦'
                : '恢复最新对话'
              : '定位最新对话'}
          </button>
        )}
      </div>

      <div
        style={{
          ...SUB_SESSION_CARD_STYLE,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>干预子代理</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>直接补充指令或纠偏</div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
            {input.trim().length} 字
          </div>
        </div>
        {currentTaskSelection && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, #ef4444 28%, var(--border-subtle))',
              background: 'color-mix(in srgb, #ef4444 6%, var(--surface))',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>
                停止当前子任务
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentTaskSelection.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCancelTask()}
              disabled={cancellingTask}
              style={{
                border: '1px solid color-mix(in srgb, #ef4444 30%, var(--border-subtle))',
                borderRadius: 8,
                background: 'transparent',
                color: '#fca5a5',
                cursor: cancellingTask ? 'not-allowed' : 'pointer',
                fontSize: 10,
                fontWeight: 700,
                padding: '5px 9px',
                opacity: cancellingTask ? 0.55 : 1,
                flexShrink: 0,
              }}
            >
              {cancellingTask ? '停止中…' : '停止子任务'}
            </button>
          </div>
        )}
        <textarea
          aria-label="向子代理追加消息"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          rows={3}
          placeholder="向这个子代理追加一条消息…"
          style={{
            width: '100%',
            minHeight: 44,
            resize: 'vertical',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            background: 'color-mix(in oklab, var(--surface) 86%, var(--bg-2))',
            color: 'var(--text)',
            padding: '11px 12px',
            fontSize: 11,
            lineHeight: 1.6,
            fontFamily: 'inherit',
          }}
        />
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {cancellingTask
              ? '正在停止当前子任务…'
              : isChildSessionBusy
                ? '当前子会话已有运行中的请求，可先停止子任务'
                : 'Enter 发送 · Shift+Enter 换行'}
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || isChildSessionBusy || cancellingTask}
            style={{
              border: 'none',
              borderRadius: 10,
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              cursor:
                !input.trim() || isChildSessionBusy || cancellingTask ? 'not-allowed' : 'pointer',
              fontSize: 11,
              fontWeight: 700,
              padding: '8px 12px',
              opacity: !input.trim() || isChildSessionBusy || cancellingTask ? 0.5 : 1,
            }}
          >
            {cancellingTask ? '停止中…' : isChildSessionBusy ? '等待子任务停止' : '发送干预'}
          </button>
        </div>
      </div>
    </div>
  );
});

export { SubSessionDetailPanel };
