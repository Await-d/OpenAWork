import React from 'react';
import './chat-message.css';
import { GenerativeUIRenderer, ToolCallCard } from '@openAwork/shared-ui';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import type { DialogueMode } from '../../pages/dialogue-mode.js';
import { DIALOGUE_MODE_OPTIONS } from '../../pages/dialogue-mode.js';
import { AssistantEventRow } from './assistant-event-row.js';
import {
  normalizeProviderKey,
  ProviderAvatar,
  resolveProviderIdentity,
  UserAvatar,
} from './chat-provider-display.js';
import { TaskToolInline } from './task-tool-inline.js';
import {
  resolveTaskToolRuntimeSnapshot,
  type TaskToolRuntimeLookup,
} from '../../pages/chat-page/task-tool-runtime.js';
import {
  AssistantErrorContent,
  looksLikeAssistantErrorContent,
} from './assistant-error-content.js';
import { AssistantReasoningBlock, buildReasoningBlockKey } from './assistant-reasoning-block.js';
import { ModifiedFilesSummaryCard } from './modified-files-summary-card.js';
import StreamingMarkdownContent from './streaming-markdown-content.js';
import {
  type AssistantTracePayload,
  type ChatUsageDetails,
  estimateTokenCount,
  formatDurationLabel,
  formatShortTime,
  formatStopReasonLabel,
  parseCopiedToolCardContent,
  parseAssistantEventContent,
  parseAssistantTraceContent,
  type ChatMessage,
} from '../../pages/chat-page/support.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';

export const sharedUiThemeVars = {
  '--color-bg': 'var(--bg)',
  '--color-surface': 'var(--surface)',
  '--color-surface-2': 'var(--bg-2)',
  '--color-surface-glass': 'color-mix(in oklch, var(--surface) 90%, transparent)',
  '--color-border': 'var(--border)',
  '--color-border-subtle': 'var(--border-subtle)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
  '--color-accent-hover': 'var(--accent-hover)',
  '--color-success': 'var(--success, #10b981)',
  '--color-warning': 'var(--warning, #f59e0b)',
  '--color-danger': 'var(--danger)',
  '--color-info': 'var(--info, #3b82f6)',
} as React.CSSProperties;

export { ModelPicker, ModelSettingsPopover } from './model-picker-panels.js';
const MarkdownMessageContent = React.lazy(() => import('./markdown-message-content.js'));

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
  const durationLabel = !isUser ? formatDurationLabel(message.durationMs) : null;
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
  const metaItems: Array<{ label: string; tone?: 'default' | 'accent' | 'danger' }> = [];

  if (!isUser) {
    if (usageDetails) {
      metaItems.push({ label: `请求 ${usageDetails.requestIndex}` });
      metaItems.push({
        label: `${formatCompactTokenCount(usageDetails.totalTokens)} tokens (${formatCompactTokenCount(usageDetails.inputTokens)}↓ ${formatCompactTokenCount(usageDetails.outputTokens)}↑)`,
      });
      if (usageDetails.estimatedCostUsd !== undefined) {
        metaItems.push({ label: formatUsdCost(usageDetails.estimatedCostUsd) });
      }
      if (durationLabel) metaItems.push({ label: durationLabel });
      if (usageDetails.firstTokenLatencyMs && usageDetails.firstTokenLatencyMs > 0) {
        metaItems.push({
          label: `首 token ${formatDurationLabel(usageDetails.firstTokenLatencyMs)}`,
        });
      }
      if (usageDetails.tokensPerSecond && Number.isFinite(usageDetails.tokensPerSecond)) {
        metaItems.push({ label: `TPS ${usageDetails.tokensPerSecond.toFixed(1)}` });
      }
    } else if (tokenCount > 0) {
      metaItems.push({ label: `~${tokenCount} tok` });
      if (durationLabel) metaItems.push({ label: durationLabel });
    } else if (durationLabel) {
      metaItems.push({ label: durationLabel });
    }

    if (toolLabel) metaItems.push({ label: toolLabel });
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
      className={`chat-message-row${groupedWithPrevious ? ' is-grouped' : ''}`}
      data-role={message.role}
      data-grouped={groupedWithPrevious ? 'true' : 'false'}
      data-status={message.status ?? 'completed'}
    >
      <div
        className="chat-message-avatar-frame"
        data-role={message.role}
        data-grouped={groupedWithPrevious ? 'true' : 'false'}
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
              <div className="chat-message-display-name">{displayName}</div>
              {providerLabel && <span className="chat-message-provider-pill">{providerLabel}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {actions && actions.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
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
                        background: 'var(--surface)',
                        color: 'var(--text-2)',
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
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}

export function renderChatMessageContentWithOptions(
  m: ChatMessage,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  if (m.role !== 'assistant') return m.content;
  return renderAssistantMessageContentValue(m.content, { ...options, messageId: m.id });
}

export function renderStreamingChatMessageContentWithOptions(
  content: string,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  return renderAssistantMessageContentValue(content, { ...options, streaming: true });
}

function renderToolCallContent(input: {
  isError?: boolean;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  onOpenChildSession?: (sessionId: string) => void;
  output?: unknown;
  reactKey?: React.Key;
  resumedAfterApproval?: boolean;
  selectedChildSessionId?: string | null;
  status?: 'running' | 'paused' | 'completed' | 'failed';
  taskRuntimeLookup?: TaskToolRuntimeLookup;
  toolCallId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}) {
  if (input.toolName.trim().toLowerCase() === 'task') {
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

  return <ToolCallCard key={input.reactKey} {...input} input={input.toolInput} />;
}

function renderAssistantMessageContentValue(content: string, options?: ChatToolRenderOptions) {
  const copiedToolCard = parseCopiedToolCardContent(content);
  if (copiedToolCard) {
    return renderToolCallContent({
      kind: copiedToolCard.kind,
      toolName: copiedToolCard.toolName,
      toolInput: copiedToolCard.input,
      output: copiedToolCard.output,
      isError: copiedToolCard.isError,
      onOpenChildSession: options?.onOpenChildSession,
      resumedAfterApproval: copiedToolCard.resumedAfterApproval,
      selectedChildSessionId: options?.selectedChildSessionId,
      status: copiedToolCard.status,
      taskRuntimeLookup: options?.taskRuntimeLookup,
    });
  }

  if (!looksLikeStructuredJsonContent(content)) {
    return <AssistantRichContent content={content} streaming={options?.streaming} />;
  }

  const assistantTrace = parseAssistantTraceContent(content);
  if (assistantTrace) {
    return (
      <AssistantTraceContent
        messageId={options?.messageId}
        payload={assistantTrace}
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
    return <AssistantRichContent content={content} streaming={options?.streaming} />;
  }

  return <AssistantRichContent content={content} streaming={options?.streaming} />;
}

function AssistantTraceContent({
  messageId,
  onOpenChildSession,
  payload,
  selectedChildSessionId,
  streaming = false,
  taskRuntimeLookup,
}: {
  messageId?: string;
  onOpenChildSession?: (sessionId: string) => void;
  payload: AssistantTracePayload;
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}) {
  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
      {(payload.reasoningBlocks ?? []).map((reasoning, index) => (
        <AssistantReasoningBlock
          key={
            streaming ? `streaming-reasoning-${index}` : buildReasoningBlockKey(reasoning, index)
          }
          content={reasoning}
          index={index}
          renderBody={(reasoningContent, isStreaming) => (
            <AssistantRichContentBody content={reasoningContent} streaming={isStreaming} />
          )}
          stateKey={messageId ? `${messageId}:${index}` : undefined}
          streaming={streaming}
          total={payload.reasoningBlocks?.length ?? 0}
        />
      ))}
      {payload.toolCalls.map((toolCall, index) =>
        renderToolCallContent({
          reactKey: `${toolCall.toolName}-${index}`,
          kind: toolCall.kind,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          output: toolCall.output,
          isError: toolCall.isError,
          onOpenChildSession,
          resumedAfterApproval: toolCall.resumedAfterApproval,
          selectedChildSessionId,
          status: toolCall.status,
          taskRuntimeLookup,
        }),
      )}
      {payload.modifiedFilesSummary && (
        <ModifiedFilesSummaryCard summary={payload.modifiedFilesSummary} />
      )}
      {payload.text.length > 0 && (
        <AssistantRichContentBody content={payload.text} streaming={streaming} />
      )}
    </div>
  );
}

function AssistantRichContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="assistant-rich-content">
      <AssistantRichContentBody content={content} streaming={streaming} />
    </div>
  );
}

function AssistantRichContentBody({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
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
        <MarkdownMessageContent content={content} />
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
        color: 'var(--text-2)',
        animation: prefersReducedMotion ? undefined : 'fade-in 180ms ease-out',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: 'var(--text)',
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
  const actions = [
    {
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      label: '新建会话',
      description: hasWorkspace ? '在当前工作区中开始新对话' : '开始一个空白会话',
      action: onNewSession,
      accent: true,
    },
    {
      icon: (
        <svg
          width="18"
          height="18"
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
      ),
      label: hasWorkspace ? '切换工作区' : '打开工作区文件夹',
      description: hasWorkspace ? '选择另一个项目文件夹' : '选择本地项目文件夹作为 Agent 工作区',
      action: onOpenWorkspace,
      accent: false,
    },
  ];

  return (
    <div
      style={{
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 32px 32px',
        gap: 28,
        maxWidth: 560,
        width: '100%',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}
        >
          OpenAWork
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 4 }}>
          AI Agent 工作台
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 2,
          }}
        >
          快速开始
        </div>
        {actions.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              width: '100%',
              padding: '14px 16px',
              borderRadius: 12,
              border: item.accent ? 'none' : '1px solid var(--border)',
              background: item.accent ? 'var(--accent)' : 'var(--surface)',
              color: item.accent ? 'var(--accent-text)' : 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: item.accent
                  ? 'oklch(from var(--accent) calc(l + 0.08) c h / 0.3)'
                  : 'var(--accent-muted)',
                color: item.accent ? 'var(--accent-text)' : 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {item.icon}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
              <span style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 2,
          }}
        >
          对话模式
        </div>
        {DIALOGUE_MODE_OPTIONS.map((mode) => {
          const accent = MODE_ACCENTS[mode.value];
          const isActive = dialogueMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onSelectMode(mode.value)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                width: '100%',
                padding: '12px 14px',
                borderRadius: 10,
                border: isActive ? `1.5px solid ${accent.color}` : '1px solid var(--border)',
                background: isActive ? accent.bg : 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: accent.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {accent.icon}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {mode.label}
                  {isActive && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 500,
                        color: accent.color,
                        background: accent.bg,
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      当前
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
                  {mode.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 2,
          }}
        >
          提示
        </div>
        {[
          '在对话框输入 / 可以查看所有 slash 命令',
          '输入 @ 可以引用工作区文件作为上下文',
          '打开编辑器模式可以同时浏览代码和对话',
        ].map((tip) => (
          <div
            key={tip}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              fontSize: 12,
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>›</span>
            <span>{tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
