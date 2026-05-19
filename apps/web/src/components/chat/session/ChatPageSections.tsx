import React, { useState } from 'react';
import '../message/chat-message.css';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import { GenerativeUIRenderer } from '@openAwork/shared-ui';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
import {
  type AssistantTracePayload,
  type ChatMessage,
  type ChatMessagePart,
  type ChatReasoningPart,
  type ChatToolPart,
  type ChatUsageDetails,
  estimateTokenCount,
  extractInputImages,
  formatDurationLabel,
  formatShortTime,
  formatStopReasonLabel,
  parseAssistantEventContent,
  parseAssistantTraceContent,
  parseCopiedToolCardContent,
  readAssistantTracePayload,
} from '../../conversation-runtime/messages/support.js';
import {
  resolveTaskToolRuntimeSnapshot,
  type TaskToolRuntimeLookup,
} from '../../../pages/chat-page/conversation/render/task-tool-runtime.js';
import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import { DIALOGUE_MODE_OPTIONS } from '../../../pages/chat-page/mode/dialogue-mode.js';
import { resolveAgentAccentColor } from '../misc/agent-color-map.js';
import {
  AssistantErrorContent,
  looksLikeAssistantErrorContent,
} from '../assistant/assistant-error-content.js';
import { AssistantEventRow } from '../assistant/assistant-event-row.js';
import { shouldStreamLocalReasoningBlock } from '../assistant/assistant-reasoning-block.helpers.js';
import {
  AssistantReasoningBlock,
  buildReasoningBlockKey,
} from '../assistant/assistant-reasoning-block.js';
import {
  normalizeProviderKey,
  ProviderAvatar,
  resolveProviderIdentity,
  UserAvatar,
} from '../model-picker/chat-provider-display.js';
import { CollapsibleAssistantContent } from '../message/collapsible-assistant-content.js';
import { ImageLightbox } from '../image/image-lightbox.js';
import { MessageHoverActions } from '../message/message-hover-actions.js';
import { ModifiedFilesSummaryCard } from '../misc/modified-files-summary-card.js';
import StreamingMarkdownContent from '../markdown/streaming-markdown-content.js';
import { TaskToolInline } from '../tool-call/display/task-tool-inline.js';
import {
  GroupedToolCallPill,
  groupConsecutiveTools,
  ToolCallDisplay,
} from '../tool-call/display/tool-call-inline.js';

export const sharedUiThemeVars = {
  '--color-bg': 'var(--bg-base)',
  '--color-surface': 'var(--bg-overlay)',
  '--color-surface-2': 'var(--bg-overlay)',
  '--color-surface-glass': 'var(--bg-overlay)',
  '--color-border': 'var(--border-default)',
  '--color-border-subtle': 'var(--border-subtle)',
  '--color-text': 'var(--fg-strong)',
  '--color-muted': 'var(--fg-muted)',
  '--color-accent': 'var(--accent)',
  '--color-accent-hover': 'var(--accent-hover)',
  '--color-success': 'var(--success))',
  '--color-warning': 'var(--warning))',
  '--color-danger': 'var(--danger)',
  '--color-info': 'var(--info)',
} as React.CSSProperties;

export { ModelPicker, ModelSettingsPopover } from '../model-picker/model-picker-panels.js';

const MarkdownMessageContent = React.lazy(() => import('../markdown/markdown-message-content.js'));

export function MessageRow({
  message,
  providerId,
  providerName,
  providerType,
  modelId,
  email,
  actions,
  groupedWithPrevious = false,
  renderContent,
  sharedUiThemeVars,
  usageDetails,
}: {
  message: ChatMessage;
  providerId: string;
  providerName?: string;
  providerType?: string;
  modelId: string;
  email: string;
  actions?: Array<{
    id: string;
    label: string;
    onClick: () => void;
    title?: string;
  }>;
  groupedWithPrevious?: boolean;
  renderContent: (m: ChatMessage) => React.ReactNode;
  sharedUiThemeVars: React.CSSProperties;
  usageDetails?: ChatUsageDetails;
}) {
  const isUser = message.role === 'user';
  const resolvedProviderId = message.providerId?.trim() || providerId.trim();
  const resolvedProviderIdentity = resolveProviderIdentity({
    providerId: resolvedProviderId,
    providerName,
    providerType,
  });
  const resolvedModelLabel = message.model?.trim() || modelId.trim();
  const assistantModelLabel =
    resolvedModelLabel || (!isUser ? resolvedProviderIdentity.displayName : '助手');
  const normalizedAssistantLabel = normalizeProviderKey(assistantModelLabel);
  const normalizedResolvedProvider = normalizeProviderKey(resolvedProviderIdentity.displayName);
  const displayName = isUser ? email || '你' : assistantModelLabel;
  const timestamp = formatShortTime(message.createdAt);
  const tokenCount = message.tokenEstimate ?? estimateTokenCount(message.content);
  // During streaming, `message.durationMs` on the live virtual assistant
  // message is not yet set (it's only attached when the round finalizes via
  // `closeCurrentStreamingRoundIntoMessage` / on stream done). However the
  // render layer already computes a live `usageDetails.durationMs`
  // (`activeDurationMs = Date.now() - visibleStreamStartedAt`). Prefer that
  // so the assistant footer shows a real "耗时 5.2s" instead of "耗时 --"
  // while the model is still streaming. For finalized assistant messages
  // both values agree because `assistantUsageDetails` mirrors
  // `message.durationMs`, so this also keeps historical rows unchanged.
  const effectiveDurationMs = !isUser
    ? (usageDetails?.durationMs ?? message.durationMs)
    : undefined;
  const durationLabel = !isUser ? formatDurationLabel(effectiveDurationMs) : null;
  const stopReasonLabel = !isUser ? formatStopReasonLabel(message.stopReason) : null;
  const providerLabel =
    !isUser && resolvedProviderId && normalizedAssistantLabel !== normalizedResolvedProvider
      ? resolvedProviderIdentity.displayName
      : null;
  const toolLabel = !isUser && message.toolCallCount ? `${message.toolCallCount} 工具` : null;
  const statusLabel =
    message.status === 'streaming' ? '生成中' : message.status === 'error' ? '错误' : null;
  const showMeta =
    !isUser && (tokenCount > 0 || durationLabel || toolLabel || stopReasonLabel || statusLabel);
  const avatarProviderId = resolvedProviderId || 'assistant';
  const agentAccent = !isUser ? resolveAgentAccentColor(message.agentId) : undefined;
  const agentPillStyle: React.CSSProperties | undefined = agentAccent
    ? {
        borderColor: `color-mix(in oklch, ${agentAccent} 40%, var(--border-default) 60%)`,
        background: `linear-gradient(135deg, color-mix(in oklch, ${agentAccent} 18%, var(--bg-overlay) 82%), var(--bg-overlay))`,
        color: `color-mix(in oklch, ${agentAccent} 82%, var(--fg-on-accent) 18%)`,
      }
    : undefined;
  const metaItems: Array<{
    label: string;
    tone?: 'default' | 'accent' | 'danger';
  }> = [];

  if (!isUser) {
    if (usageDetails) {
      metaItems.push({ label: `请求 ${usageDetails.requestIndex}` });
      metaItems.push({
        label: `${formatCompactTokenCount(usageDetails.totalTokens)} tokens (${formatCompactTokenCount(usageDetails.inputTokens)}↓ ${formatCompactTokenCount(usageDetails.outputTokens)}↑)`,
      });
      if (usageDetails.estimatedCostUsd !== undefined) {
        metaItems.push({ label: formatUsdCost(usageDetails.estimatedCostUsd) });
      }
      metaItems.push({ label: durationLabel ?? '耗时 --' });
      metaItems.push({
        label:
          usageDetails.firstTokenLatencyMs && usageDetails.firstTokenLatencyMs > 0
            ? `首 token ${formatDurationLabel(usageDetails.firstTokenLatencyMs)}`
            : '首 token --',
      });
      metaItems.push({
        label:
          usageDetails.tokensPerSecond && Number.isFinite(usageDetails.tokensPerSecond)
            ? `TPS ${usageDetails.tokensPerSecond.toFixed(1)}`
            : 'TPS --',
      });
    } else if (tokenCount > 0) {
      metaItems.push({ label: `~${tokenCount} tok` });
      if (durationLabel) metaItems.push({ label: durationLabel });
    } else if (durationLabel) {
      metaItems.push({ label: durationLabel });
    }

    if (toolLabel) metaItems.push({ label: toolLabel });
    if (message.modifiedFilesSummary && message.modifiedFilesSummary.files.length > 0) {
      metaItems.push({
        label: `修改 ${message.modifiedFilesSummary.files.length} 文件`,
      });
    }
    if (stopReasonLabel) {
      metaItems.push({
        label: stopReasonLabel,
        tone: message.status === 'error' ? 'danger' : 'accent',
      });
    }
    if (statusLabel) {
      metaItems.push({
        label: statusLabel,
        tone: message.status === 'error' ? 'danger' : 'accent',
      });
    }
  }

  return (
    <article
      className={`chat-message-row${groupedWithPrevious ? ' is-grouped' : ''}${agentAccent ? ' has-agent-accent' : ''}`}
      data-role={message.role}
      data-message-id={message.id}
      data-grouped={groupedWithPrevious ? 'true' : 'false'}
      data-status={message.status ?? 'completed'}
      data-agent-id={message.agentId || undefined}
      style={agentAccent ? ({ '--agent-accent': agentAccent } as React.CSSProperties) : undefined}
    >
      <div
        className="chat-message-avatar-frame"
        data-role={message.role}
        data-grouped={groupedWithPrevious ? 'true' : 'false'}
        style={
          agentAccent
            ? {
                boxShadow: `0 0 0 2px var(--bg-overlay), 0 0 0 3.5px ${agentAccent}`,
              }
            : undefined
        }
      >
        {isUser ? (
          <UserAvatar email={email} size={28} />
        ) : (
          <ProviderAvatar
            providerId={avatarProviderId}
            providerName={providerName}
            providerType={providerType}
            size={28}
          />
        )}
      </div>
      <div className="chat-message-main">
        {!groupedWithPrevious && (
          <div className="chat-message-header">
            <div className="chat-message-title-group">
              <div
                className="chat-message-display-name"
                style={agentAccent ? { color: agentAccent } : undefined}
              >
                {displayName}
              </div>
              {providerLabel && (
                <span className="chat-message-provider-pill" style={agentPillStyle}>
                  {providerLabel}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {actions && actions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="chat-message-action-button"
                      data-testid={`chat-message-action-${action.id}-${message.id}`}
                      onClick={action.onClick}
                      title={action.title}
                      style={{
                        height: 22,
                        padding: '0 7px',
                        borderRadius: 999,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-overlay)',
                        color: 'var(--fg-default)',
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {timestamp && <div className="chat-message-timestamp">{timestamp}</div>}
            </div>
          </div>
        )}
        <div
          className="chat-message-content-shell"
          data-role={message.role}
          data-status={message.status ?? 'completed'}
        >
          <MessageHoverActions getCopyText={() => message.content} />
          <div className="chat-message-content" data-role={message.role} style={sharedUiThemeVars}>
            {renderContent(message)}
          </div>
        </div>
        {showMeta && <MetaLine items={metaItems} />}
      </div>
    </article>
  );
}

function formatCompactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}

function formatUsdCost(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1 ? 2 : 3,
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

function MetaLine({
  items,
}: {
  items: Array<{ label: string; tone?: 'default' | 'accent' | 'danger' }>;
}) {
  let offset = 0;

  return (
    <div className="chat-message-meta-row" data-message-meta-row="true">
      {items.map((item) => {
        const fragmentKey = `${item.tone ?? 'default'}-${offset}-${item.label}`;
        const shouldPrefixSeparator = offset > 0;
        offset += item.label.length + 1;

        return (
          <React.Fragment key={fragmentKey}>
            {shouldPrefixSeparator && <span className="chat-message-meta-separator">·</span>}
            <span className={`chat-message-meta-item${item.tone ? ` is-${item.tone}` : ''}`}>
              {item.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function renderChatMessageContent(m: ChatMessage) {
  if (m.role !== 'assistant') return m.content;
  return renderAssistantMessageContentValue(m.content, { messageId: m.id });
}

export function renderStreamingChatMessageContent(content: string) {
  return renderAssistantMessageContentValue(content, { streaming: true });
}

export interface ChatToolRenderOptions {
  messageId?: string;
  onOpenChildSession?: (sessionId: string) => void;
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
      }
    | undefined;
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}

function UserAttachedImagesGallery({ images }: { images: ReturnType<typeof extractInputImages> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const activeImage = openIndex !== null ? images[openIndex] : undefined;
  const activeSrc = activeImage?.imageUrl;
  const activeLabel =
    activeImage?.fileName ?? (openIndex !== null ? `图片 ${openIndex + 1}` : '图片');

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {images.map((image, index) => {
        const label = image.fileName ?? `图片 ${index + 1}`;
        const src = image.imageUrl;
        const isHovered = hoverIndex === index;
        const clickable = Boolean(src);

        return (
          <div
            key={`${src ?? image.artifactId ?? image.fileId ?? 'image'}-${index}`}
            style={{ display: 'grid', gap: 6, width: 180 }}
          >
            {src ? (
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex((value) => (value === index ? null : value))}
                title="点击放大查看"
                style={{
                  position: 'relative',
                  padding: 0,
                  width: '100%',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  background: 'var(--bg-overlay)',
                  cursor: 'zoom-in',
                  overflow: 'hidden',
                  lineHeight: 0,
                }}
              >
                <img
                  src={src}
                  alt={label}
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: 180,
                    objectFit: 'cover',
                  }}
                />
                {/* Hover overlay */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                      'linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.18) 100%)',
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: 'none',
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      background: 'rgba(0,0,0,0.55)',
                      backdropFilter: 'blur(6px)',
                      color: 'var(--fg-on-accent))',
                      fontSize: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ⤢
                  </span>
                </div>
              </button>
            ) : (
              <div
                style={{
                  minHeight: 120,
                  borderRadius: 12,
                  border: '1px dashed var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                  background: 'var(--bg-overlay)',
                }}
              >
                图片已附加
              </div>
            )}
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                lineHeight: 1.4,
                cursor: clickable ? 'zoom-in' : 'default',
              }}
              onClick={clickable ? () => setOpenIndex(index) : undefined}
              title={label}
            >
              {label}
            </span>
          </div>
        );
      })}

      {activeSrc && (
        <ImageLightbox
          src={activeSrc}
          open={openIndex !== null}
          onClose={() => setOpenIndex(null)}
          alt={activeLabel}
          caption={activeLabel}
          fileName={activeImage?.fileName ?? 'image.png'}
        />
      )}
    </div>
  );
}

export function renderChatMessageContentWithOptions(
  m: ChatMessage,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  if (m.role !== 'assistant') {
    const inputImages = m.rawContent ? extractInputImages(m.rawContent) : [];
    if (inputImages.length === 0) {
      return m.content;
    }

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {m.content ? <span>{m.content}</span> : null}
        <UserAttachedImagesGallery images={inputImages} />
      </div>
    );
  }
  return renderAssistantMessageContentValue(m, { ...options, messageId: m.id });
}

export function renderStreamingChatMessageContentWithOptions(
  contentOrMessage: ChatMessage | string,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  return renderAssistantMessageContentValue(contentOrMessage, {
    ...options,
    streaming: true,
  });
}

function renderToolCallContent(input: {
  approvalActions?: {
    errorMessage?: string;
    helperMessage?: string;
    items: Array<{
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      id: string;
      label: string;
      onClick: () => void;
      primary?: boolean;
    }>;
    pendingLabel?: string;
  };
  durationMs?: number;
  isError?: boolean;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  onOpenChildSession?: (sessionId: string) => void;
  output?: unknown;
  pendingPermissionRequestId?: string;
  reactKey?: React.Key;
  resumedAfterApproval?: boolean;
  selectedChildSessionId?: string | null;
  status?: 'running' | 'paused' | 'completed' | 'failed';
  taskRuntimeLookup?: TaskToolRuntimeLookup;
  toolCallId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}) {
  const normalizedToolName = input.toolName.trim().toLowerCase();
  if (
    normalizedToolName === 'task' ||
    normalizedToolName === 'agent' ||
    normalizedToolName === 'call_omo_agent' ||
    normalizedToolName === 'delegate_task'
  ) {
    return (
      <TaskToolInline
        key={input.reactKey}
        {...input}
        input={input.toolInput}
        onOpenChildSession={input.onOpenChildSession}
        runtimeSnapshot={resolveTaskToolRuntimeSnapshot(
          input.toolInput,
          input.output,
          input.taskRuntimeLookup,
        )}
        selectedChildSessionId={input.selectedChildSessionId}
      />
    );
  }

  return (
    <ToolCallDisplay
      approvalActions={input.approvalActions}
      key={input.reactKey}
      input={input.toolInput}
      isError={input.isError}
      kind={input.kind}
      output={input.output}
      resumedAfterApproval={input.resumedAfterApproval}
      status={input.status}
      durationMs={input.durationMs}
      toolCallId={input.toolCallId}
      toolName={input.toolName}
    />
  );
}

function renderAssistantMessageContentValue(
  contentOrMessage: ChatMessage | string,
  options?: ChatToolRenderOptions,
) {
  // Parts-first path: when the message carries structured parts that
  // include any reasoning / tool / event segment, render them in their
  // original order. This is the only way to faithfully show the wire
  // arrival sequence (e.g. tool → text → tool, reasoning interleaved with
  // tool output). Plain text-only parts fall through to the trace path so
  // copied-tool-card / generative-UI / companion-block detection still work.
  if (
    typeof contentOrMessage !== 'string' &&
    Array.isArray(contentOrMessage.parts) &&
    contentOrMessage.parts.length > 0 &&
    contentOrMessage.parts.some(
      (part) => part.type === 'reasoning' || part.type === 'tool' || part.type === 'event',
    )
  ) {
    return <AssistantPartsContent message={contentOrMessage} options={options} />;
  }
  const content =
    typeof contentOrMessage === 'string' ? contentOrMessage : contentOrMessage.content;
  const copiedToolCard = parseCopiedToolCardContent(content);
  if (copiedToolCard) {
    return renderToolCallContent({
      kind: copiedToolCard.kind,
      toolName: copiedToolCard.toolName,
      toolInput: copiedToolCard.input,
      output: copiedToolCard.output,
      isError: copiedToolCard.isError,
      onOpenChildSession: options?.onOpenChildSession,
      pendingPermissionRequestId: copiedToolCard.pendingPermissionRequestId,
      approvalActions:
        copiedToolCard.pendingPermissionRequestId && options?.resolveInlinePermissionActions
          ? options.resolveInlinePermissionActions(copiedToolCard.pendingPermissionRequestId)
          : undefined,
      durationMs: copiedToolCard.durationMs,
      resumedAfterApproval: copiedToolCard.resumedAfterApproval,
      selectedChildSessionId: options?.selectedChildSessionId,
      status: copiedToolCard.status,
      taskRuntimeLookup: options?.taskRuntimeLookup,
    });
  }

  if (!looksLikeStructuredJsonContent(content)) {
    const companionBlocks = extractCompanionBlocks(content);
    if (companionBlocks) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {companionBlocks.mainContent && (
            <AssistantRichContent
              content={companionBlocks.mainContent}
              streaming={options?.streaming}
              messageId={options?.messageId}
            />
          )}
          {companionBlocks.companionContent && (
            <CompanionInlineBlock content={companionBlocks.companionContent} />
          )}
        </div>
      );
    }
    return (
      <AssistantRichContent
        content={content}
        streaming={options?.streaming}
        messageId={options?.messageId}
      />
    );
  }

  const assistantTrace =
    typeof contentOrMessage === 'string'
      ? parseAssistantTraceContent(content)
      : readAssistantTracePayload(contentOrMessage);
  if (assistantTrace) {
    const reasoningBlocksEndedFlags =
      typeof contentOrMessage === 'string' ? undefined : contentOrMessage.reasoningBlocksEndedFlags;
    const reasoningBlocksDurationsMs =
      typeof contentOrMessage === 'string'
        ? undefined
        : contentOrMessage.reasoningBlocksDurationsMs;
    return (
      <AssistantTraceContent
        messageId={options?.messageId}
        payload={assistantTrace}
        reasoningBlocksEndedFlags={reasoningBlocksEndedFlags}
        reasoningBlocksDurationsMs={reasoningBlocksDurationsMs}
        resolveInlinePermissionActions={options?.resolveInlinePermissionActions}
        streaming={options?.streaming}
        onOpenChildSession={options?.onOpenChildSession}
        selectedChildSessionId={options?.selectedChildSessionId}
        taskRuntimeLookup={options?.taskRuntimeLookup}
      />
    );
  }

  const assistantEvent = parseAssistantEventContent(content);
  if (assistantEvent) {
    return <AssistantEventRow payload={assistantEvent} />;
  }

  try {
    const parsed = JSON.parse(content) as GenerativeUIMessage & {
      payload?: Record<string, unknown>;
      type?: string;
    };
    if (parsed?.type === 'tool_call') {
      const payload = parsed.payload ?? {};
      return renderToolCallContent({
        kind:
          payload['kind'] === 'agent' ||
          payload['kind'] === 'mcp' ||
          payload['kind'] === 'skill' ||
          payload['kind'] === 'tool'
            ? payload['kind']
            : undefined,
        toolCallId: typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined,
        toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool',
        toolInput:
          payload['input'] &&
          typeof payload['input'] === 'object' &&
          !Array.isArray(payload['input'])
            ? (payload['input'] as Record<string, unknown>)
            : {},
        output: payload['output'],
        isError: payload['isError'] === true,
        pendingPermissionRequestId:
          typeof payload['pendingPermissionRequestId'] === 'string'
            ? payload['pendingPermissionRequestId']
            : undefined,
        approvalActions:
          typeof payload['pendingPermissionRequestId'] === 'string' &&
          options?.resolveInlinePermissionActions
            ? options.resolveInlinePermissionActions(payload['pendingPermissionRequestId'])
            : undefined,
        durationMs:
          typeof payload['durationMs'] === 'number' && Number.isFinite(payload['durationMs'])
            ? payload['durationMs']
            : undefined,
        resumedAfterApproval: payload['resumedAfterApproval'] === true,
        taskRuntimeLookup: options?.taskRuntimeLookup,
        status:
          payload['status'] === 'running' ||
          payload['status'] === 'paused' ||
          payload['status'] === 'completed' ||
          payload['status'] === 'failed'
            ? payload['status']
            : undefined,
      });
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.type === 'form' ||
        parsed.type === 'table' ||
        parsed.type === 'chart' ||
        parsed.type === 'approval' ||
        parsed.type === 'code_diff' ||
        parsed.type === 'status' ||
        parsed.type === 'compaction' ||
        parsed.type === 'tool_call')
    ) {
      return <GenerativeUIRenderer message={parsed} />;
    }
  } catch {
    return (
      <AssistantRichContent
        content={content}
        streaming={options?.streaming}
        messageId={options?.messageId}
      />
    );
  }

  return (
    <AssistantRichContent
      content={content}
      streaming={options?.streaming}
      messageId={options?.messageId}
    />
  );
}

function AssistantPartsContent({
  message,
  options,
}: {
  message: ChatMessage;
  options?: ChatToolRenderOptions;
}) {
  const parts = message.parts ?? [];
  const streaming = options?.streaming === true;
  const reasoningParts = parts.filter(
    (part): part is ChatReasoningPart => part.type === 'reasoning',
  );
  const totalReasoning = reasoningParts.length;
  const reasoningEndedFlags = message.reasoningBlocksEndedFlags;
  const reasoningDurations = message.reasoningBlocksDurationsMs;
  const hasActiveToolCall = parts.some(
    (part): part is ChatToolPart =>
      part.type === 'tool' && (part.status === 'running' || part.status === 'paused'),
  );
  const hasAssistantText = parts.some(
    (part) => part.type === 'text' && part.text.trim().length > 0,
  );

  let reasoningCursor = 0;
  let toolCursor = 0;

  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
      {parts.map((part) => {
        if (part.type === 'reasoning') {
          const myIndex = reasoningCursor++;
          // Default to "ended" when no streaming flag list is supplied
          // (i.e. message is finalized / loaded from history). While
          // streaming, prefer the per-block flag, then fall back to
          // segment-level endedAt set by `markStreamingReasoningSegmentEnded`.
          const ended = reasoningEndedFlags
            ? reasoningEndedFlags[myIndex] === true
            : !streaming || part.endedAt !== undefined;
          const rawDuration = reasoningDurations?.[myIndex];
          const persistedDuration =
            typeof part.startedAt === 'number' &&
            typeof part.endedAt === 'number' &&
            part.endedAt >= part.startedAt
              ? part.endedAt - part.startedAt
              : undefined;
          const durationMs =
            typeof rawDuration === 'number' && rawDuration >= 0 ? rawDuration : persistedDuration;
          return (
            <AssistantReasoningBlock
              key={part.id}
              content={part.text}
              durationMs={durationMs}
              ended={ended}
              index={myIndex}
              messageStreaming={streaming}
              renderBody={renderReasoningRichBody}
              streaming={shouldStreamLocalReasoningBlock({
                ended,
                hasActiveToolCall,
                hasAssistantText,
                index: myIndex,
                streaming,
                total: totalReasoning,
              })}
              total={totalReasoning}
            />
          );
        }
        if (part.type === 'text') {
          if (part.text.length === 0) return null;
          return (
            <AssistantRichContentBody
              key={part.id}
              content={part.text}
              streaming={streaming}
              messageId={message.id}
            />
          );
        }
        if (part.type === 'tool') {
          const myIndex = toolCursor++;
          return renderToolCallContent({
            reactKey: part.id,
            kind: part.kind,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            toolInput: part.input,
            output: part.output,
            isError: part.isError,
            onOpenChildSession: options?.onOpenChildSession,
            pendingPermissionRequestId: part.pendingPermissionRequestId,
            approvalActions:
              part.pendingPermissionRequestId && options?.resolveInlinePermissionActions
                ? options.resolveInlinePermissionActions(part.pendingPermissionRequestId)
                : undefined,
            durationMs: part.durationMs,
            resumedAfterApproval: part.resumedAfterApproval,
            selectedChildSessionId: options?.selectedChildSessionId,
            status: part.status,
            taskRuntimeLookup: options?.taskRuntimeLookup,
          });
          // Note: myIndex used only as a stable counter; reactKey prefers part.id
        }
        if (part.type === 'event') {
          return <AssistantEventRow key={part.id} payload={part.payload} />;
        }
        return null;
      })}
      {message.modifiedFilesSummary && (
        <ModifiedFilesSummaryCard summary={message.modifiedFilesSummary} />
      )}
    </div>
  );
}

function AssistantTraceContent({
  messageId,
  onOpenChildSession,
  payload,
  reasoningBlocksEndedFlags,
  reasoningBlocksDurationsMs,
  resolveInlinePermissionActions,
  selectedChildSessionId,
  streaming = false,
  taskRuntimeLookup,
}: {
  messageId?: string;
  onOpenChildSession?: (sessionId: string) => void;
  payload: AssistantTracePayload;
  reasoningBlocksEndedFlags?: boolean[];
  reasoningBlocksDurationsMs?: number[];
  resolveInlinePermissionActions?: ChatToolRenderOptions['resolveInlinePermissionActions'];
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}) {
  const hasActiveToolCall = payload.toolCalls.some(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'paused',
  );
  const hasAssistantText = payload.text.trim().length > 0;

  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
      {(payload.reasoningBlocks ?? []).map((reasoning, index) => {
        // Default: when no explicit ended-flag list is supplied (i.e. the
        // message is finalized / loaded from history), treat every reasoning
        // block as ended. While streaming, use the per-block flag from the
        // upstream `thinking_end` event.
        const ended = reasoningBlocksEndedFlags
          ? reasoningBlocksEndedFlags[index] === true
          : !streaming;
        const rawDuration = reasoningBlocksDurationsMs?.[index];
        const persistedTiming = payload.reasoningBlocksTimings?.[index];
        const persistedDuration =
          persistedTiming &&
          typeof persistedTiming.startedAt === 'number' &&
          typeof persistedTiming.endedAt === 'number' &&
          persistedTiming.endedAt >= persistedTiming.startedAt
            ? persistedTiming.endedAt - persistedTiming.startedAt
            : undefined;
        const durationMs =
          typeof rawDuration === 'number' && rawDuration >= 0
            ? rawDuration
            : typeof persistedDuration === 'number'
              ? persistedDuration
              : undefined;
        return (
          <AssistantReasoningBlock
            key={
              streaming ? `streaming-reasoning-${index}` : buildReasoningBlockKey(reasoning, index)
            }
            content={reasoning}
            durationMs={durationMs}
            ended={ended}
            index={index}
            messageStreaming={streaming}
            renderBody={renderReasoningRichBody}
            streaming={shouldStreamLocalReasoningBlock({
              ended,
              hasActiveToolCall,
              hasAssistantText,
              index,
              streaming,
              total: payload.reasoningBlocks?.length ?? 0,
            })}
            total={payload.reasoningBlocks?.length ?? 0}
          />
        );
      })}
      {payload.text.length > 0 && (
        <AssistantRichContentBody
          content={payload.text}
          streaming={streaming}
          messageId={messageId}
        />
      )}
      {/* Collapse runs of ≥2 consecutive read/grep/glob calls into a
          single grouped pill so a session that reads 8 files in a row
          doesn't blow out the message column. The helper preserves
          the original index so the React key stays stable across
          re-renders even when group boundaries shift. */}
      {groupConsecutiveTools(payload.toolCalls).map((entry) => {
        if (entry.kind === 'group') {
          return (
            <GroupedToolCallPill
              key={`group-${entry.startIndex}-${entry.toolName}`}
              toolName={entry.toolName}
              calls={entry.calls}
            />
          );
        }
        const toolCall = entry.call;
        return renderToolCallContent({
          reactKey: `${toolCall.toolName}-${entry.index}`,
          kind: toolCall.kind,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          output: toolCall.output,
          isError: toolCall.isError,
          onOpenChildSession,
          pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
          approvalActions:
            toolCall.pendingPermissionRequestId && resolveInlinePermissionActions
              ? resolveInlinePermissionActions(toolCall.pendingPermissionRequestId)
              : undefined,
          durationMs: toolCall.durationMs,
          resumedAfterApproval: toolCall.resumedAfterApproval,
          selectedChildSessionId,
          status: toolCall.status,
          taskRuntimeLookup,
        });
      })}
      {payload.modifiedFilesSummary && (
        <ModifiedFilesSummaryCard summary={payload.modifiedFilesSummary} />
      )}
    </div>
  );
}

function AssistantRichContent({
  content,
  streaming = false,
  messageId,
}: {
  content: string;
  streaming?: boolean;
  messageId?: string;
}) {
  return (
    <div className="assistant-rich-content">
      <AssistantRichContentBody content={content} streaming={streaming} messageId={messageId} />
    </div>
  );
}

// Stable module-level reference for AssistantReasoningBlock.renderBody.
// Must be defined AFTER AssistantRichContentBody to avoid TDZ when read.
// React components reference it at render time (post module-eval), so safe.
// eslint-disable-next-line @typescript-eslint/no-use-before-define
const renderReasoningRichBody = (reasoningContent: string, isStreaming: boolean) => (
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  <AssistantRichContentBody content={reasoningContent} streaming={isStreaming} />
);

function AssistantRichContentBody({
  content,
  streaming = false,
  messageId,
}: {
  content: string;
  streaming?: boolean;
  messageId?: string;
}) {
  if (streaming && content.trim().length === 0) {
    return <AssistantPendingBubble />;
  }

  if (!streaming && looksLikeAssistantErrorContent(content)) {
    return <AssistantErrorContent content={content} />;
  }

  if (streaming) {
    return (
      <>
        <React.Suspense fallback={<div className="chat-markdown-streaming">{content}</div>}>
          <StreamingMarkdownContent content={content} />
        </React.Suspense>
      </>
    );
  }

  return (
    <div className="assistant-rich-content-body">
      <React.Suspense fallback={<div className="chat-markdown-streaming">{content}</div>}>
        <CollapsibleAssistantContent content={content} messageId={messageId}>
          <MarkdownMessageContent content={content} />
        </CollapsibleAssistantContent>
      </React.Suspense>
    </div>
  );
}

function AssistantPendingBubble() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div
      data-testid="chat-streaming-placeholder"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 26,
        color: 'var(--fg-default)',
        animation: prefersReducedMotion ? undefined : 'fade-in 180ms ease-out',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: 'var(--fg-strong)',
        }}
      >
        正在对话
      </span>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent)',
              opacity: 0.45,
              animation: prefersReducedMotion ? undefined : 'pulse 1.1s ease-in-out infinite',
              animationDelay: `${index * 140}ms`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function looksLikeStructuredJsonContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.startsWith('{')) {
    return false;
  }

  return normalized.includes('"type"') || normalized.endsWith('}');
}

const MODE_ACCENTS: Record<DialogueMode, { bg: string; color: string; icon: string }> = {
  clarify: {
    bg: 'rgba(245, 158, 11, 0.10)',
    color: 'rgb(245, 158, 11)',
    icon: '🔍',
  },
  coding: {
    bg: 'rgba(139, 92, 246, 0.12)',
    color: 'rgb(167, 139, 250)',
    icon: '⚡',
  },
  programmer: {
    bg: 'rgba(16, 185, 129, 0.12)',
    color: 'rgb(52, 211, 153)',
    icon: '🛠',
  },
};

const WELCOME_KEYFRAMES = `
@keyframes ws-fade-up{0%{opacity:0;transform:translateY(18px)}100%{opacity:1;transform:translateY(0)}}
@keyframes ws-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes ws-glow-pulse{0%,100%{box-shadow:0 0 0 1px var(--glow),0 2px 16px color-mix(in srgb,var(--glow) 18%,transparent)}50%{box-shadow:0 0 0 1.5px var(--glow),0 4px 24px color-mix(in srgb,var(--glow) 30%,transparent)}}
@keyframes ws-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ws-card{transition:border-color .22s,background .22s,box-shadow .22s,transform .22s}
.ws-card:hover{transform:translateY(-3px);box-shadow:0 6px 24px rgba(0,0,0,.08)!important}
.ws-pill{transition:transform .18s,box-shadow .18s}
.ws-pill:hover{transform:translateY(-1px);box-shadow:0 3px 12px rgba(0,0,0,.1)}
.ws-pill:active{transform:scale(.97)}
`;

export function WelcomeScreen({
  hasWorkspace,
  dialogueMode,
  onNewSession,
  onOpenWorkspace,
  onSelectMode,
}: {
  hasWorkspace: boolean;
  dialogueMode: DialogueMode;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
  onSelectMode: (mode: DialogueMode) => void;
}) {
  const tips = [
    { key: '/', text: '输入 / 查看命令' },
    { key: '@', text: '输入 @ 引用文件' },
  ];

  return (
    <div
      style={{
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 24px 12px',
        gap: 18,
        maxWidth: 700,
        width: '100%',
      }}
    >
      <style>{WELCOME_KEYFRAMES}</style>

      {/* Hero */}
      <div
        style={{
          textAlign: 'center',
          animation: 'ws-fade-up .5s ease both',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 42,
            height: 42,
            borderRadius: 13,
            background:
              'linear-gradient(135deg, var(--accent), color-mix(in oklch, var(--accent) 65%, var(--chart-5))))',
            marginBottom: 10,
            boxShadow: '0 4px 24px color-mix(in srgb, var(--accent) 28%, transparent)',
            animation: 'ws-float 3s ease-in-out infinite',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            letterSpacing: '-0.03em',
          }}
        >
          OpenAWork
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-muted)',
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          选择一个对话模式，然后在下方输入框开始对话
        </div>
      </div>

      {/* Mode cards – horizontal grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          width: '100%',
        }}
      >
        {DIALOGUE_MODE_OPTIONS.map((mode, idx) => {
          const accent = MODE_ACCENTS[mode.value];
          const isActive = dialogueMode === mode.value;
          return (
            <button
              key={mode.value}
              className="ws-card"
              type="button"
              onClick={() => onSelectMode(mode.value)}
              style={
                {
                  '--glow': accent.color,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '14px 13px 12px',
                  borderRadius: 12,
                  border: isActive
                    ? `1.5px solid ${accent.color}`
                    : '1px solid var(--border-default)',
                  background: isActive ? accent.bg : 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  animation: `ws-fade-up .5s ease both ${0.1 + idx * 0.08}s${isActive ? ', ws-glow-pulse 2.5s ease-in-out infinite .6s' : ''}`,
                  overflow: 'hidden',
                } as React.CSSProperties
              }
            >
              {/* Shimmer overlay on active card */}
              {isActive && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 'inherit',
                    background: `linear-gradient(110deg, transparent 30%, color-mix(in srgb, ${accent.color} 8%, transparent) 50%, transparent 70%)`,
                    backgroundSize: '200% 100%',
                    animation: 'ws-shimmer 3s linear infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Icon badge */}
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: isActive
                    ? `linear-gradient(135deg, ${accent.bg}, color-mix(in srgb, ${accent.color} 18%, transparent))`
                    : accent.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  flexShrink: 0,
                  transition: 'transform .2s',
                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                }}
              >
                {accent.icon}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {mode.label}
                  {isActive && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: accent.color,
                        color: 'var(--fg-on-accent))',
                        fontSize: 9,
                        fontWeight: 700,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.4,
                  }}
                >
                  {mode.description}
                </span>
              </span>
              {/* Details – always visible */}
              <ul
                style={{
                  margin: '1px 0 0',
                  padding: '0 0 0 12px',
                  fontSize: 10,
                  color: isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
                  lineHeight: 1.5,
                  listStyle: 'none',
                  transition: 'color .2s',
                }}
              >
                {mode.details.slice(0, 2).map((detail) => (
                  <li
                    key={detail}
                    style={{
                      position: 'relative',
                      paddingLeft: 2,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: -10,
                        color: isActive ? accent.color : 'var(--fg-muted)',
                        transition: 'color .2s',
                      }}
                    >
                      ·
                    </span>
                    {detail}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* Quick-actions row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          justifyContent: 'center',
          animation: 'ws-fade-up .5s ease both .38s',
        }}
      >
        <button
          className="ws-pill"
          type="button"
          onClick={onNewSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建会话
        </button>
        <button
          className="ws-pill"
          type="button"
          onClick={onOpenWorkspace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 999,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-default)',
            fontSize: 11.5,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {hasWorkspace ? '切换工作区' : '打开工作区'}
        </button>
      </div>

      {/* Tips row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          justifyContent: 'center',
          flexWrap: 'wrap',
          animation: 'ws-fade-up .5s ease both .46s',
        }}
      >
        {tips.map((tip) => (
          <span
            key={tip.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: 'var(--fg-muted)',
            }}
          >
            <kbd
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 20,
                height: 20,
                padding: '0 5px',
                borderRadius: 5,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--fg-default)',
                lineHeight: 1,
              }}
            >
              {tip.key}
            </kbd>
            {tip.text}
          </span>
        ))}
      </div>
    </div>
  );
}

export type ResolveInlinePermissionActionsFn = (requestId: string) =>
  | {
      errorMessage?: string;
      helperMessage?: string;
      items: Array<{
        danger?: boolean;
        disabled?: boolean;
        hint?: string;
        id: string;
        label: string;
        onClick: () => void;
        primary?: boolean;
      }>;
      pendingLabel?: string;
    }
  | undefined;

export interface InlinePermissionQuickBarProps {
  permissions: Array<{
    requestId: string;
    toolName: string;
    reason: string;
    scope: string;
    riskLevel: string;
    previewAction?: string;
  }>;
  resolveActions: ResolveInlinePermissionActionsFn;
}

export function InlinePermissionQuickBar({
  permissions,
  resolveActions,
}: InlinePermissionQuickBarProps) {
  if (permissions.length === 0) return null;

  return (
    <div
      data-testid="inline-permission-quick-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        paddingLeft: 40,
      }}
    >
      {permissions.map((permission) => {
        const actions = resolveActions(permission.requestId);
        return (
          <div
            key={permission.requestId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              fontSize: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'var(--warning))',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{permission.toolName}</span>
              <span
                style={{
                  color: 'var(--fg-default)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {permission.reason}
              </span>
              {actions &&
                actions.items.length > 0 &&
                actions.items.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={action.disabled}
                    onClick={action.onClick}
                    title={action.hint}
                    style={{
                      appearance: 'none',
                      height: 20,
                      padding: '0 7px',
                      borderRadius: 999,
                      border: 'none',
                      background: action.primary
                        ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                        : action.danger
                          ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
                          : 'color-mix(in srgb, var(--accent) 10%, transparent)',
                      color: action.danger ? 'var(--danger)' : 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: action.disabled ? 'not-allowed' : 'pointer',
                      opacity: action.disabled ? 0.55 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              {actions?.errorMessage && (
                <span style={{ color: 'var(--danger)' }}>{actions.errorMessage}</span>
              )}
            </div>
            {permission.previewAction && (
              <div
                style={{
                  marginLeft: 11,
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={permission.previewAction}
              >
                {permission.previewAction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const COMPANION_FENCE_PATTERN = /```companion\n([\s\S]*?)```/;

function extractCompanionBlocks(
  content: string,
): { mainContent: string; companionContent: string } | null {
  const match = COMPANION_FENCE_PATTERN.exec(content);
  if (!match) {
    return null;
  }

  const companionContent = match[1]?.trim() ?? '';
  const mainContent = content.replace(match[0], '').trim();

  if (!companionContent) {
    return null;
  }

  return { mainContent, companionContent };
}

function CompanionInlineBlock({ content }: { content: string }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--accent) 20%, transparent)',
        background: 'color-mix(in oklch, var(--accent) 6%, var(--bg-overlay))',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'color-mix(in oklch, var(--accent) 82%, var(--fg-on-accent) 18%)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: -1 }}>◈</span>
      <span>{content}</span>
    </div>
  );
}
