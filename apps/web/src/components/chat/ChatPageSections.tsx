import React from 'react';
import {
  describeReasoningEffort,
  GenerativeUIRenderer,
  getSupportedReasoningEffortsForModel,
  ToolCallCard,
} from '@openAwork/shared-ui';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import { AssistantEventRow } from './assistant-event-row.js';
import { TaskToolInline } from './task-tool-inline.js';
import {
  resolveTaskToolRuntimeSnapshot,
  type TaskToolRuntimeLookup,
} from '../../pages/chat-page/task-tool-runtime.js';
import {
  AssistantErrorContent,
  looksLikeAssistantErrorContent,
} from './assistant-error-content.js';
import { buildFilteredModelGroups, type ModelPickerProvider } from './model-picker-search.js';
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
  type ReasoningEffort,
} from '../../pages/chat-page/support.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';

export const sharedUiThemeVars = {
  '--color-surface': 'var(--surface)',
  '--color-border': 'var(--border)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
} as React.CSSProperties;

const PROVIDER_LOGO_URL: Record<string, string> = {
  anthropic: '/logo-anthropic.svg',
  claude: '/logo-claude.svg',
  openai: '/logo-openai.svg',
  gemini: '/logo-gemini.svg',
  googlegemini: '/logo-gemini.svg',
  ollama: '/logo-ollama.svg',
  openrouter: '/logo-openrouter.svg',
  deepseek: '/logo-deepseek.svg',
  moonshot: '/logo-moonshot.svg',
  qwen: '/logo-qwen.svg',
  mistralai: '/logo-mistralai.svg',
  mistral: '/logo-mistralai.svg',
};

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  anthropic: 'Anthropic',
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  googlegemini: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  qwen: 'Qwen',
  mistralai: 'Mistral AI',
  mistral: 'Mistral',
};

const PROVIDER_LOGOS_FALLBACK: Record<string, React.ReactNode> = {};
const MarkdownMessageContent = React.lazy(() => import('./markdown-message-content.js'));

function formatProviderDisplayName(value: string): string {
  const normalized = value.trim().toLowerCase();
  const knownDisplayName = PROVIDER_DISPLAY_NAME[normalized];
  if (knownDisplayName) {
    return knownDisplayName;
  }

  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeProviderLabel(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) return '助手';
  return formatProviderDisplayName(normalized);
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

export function ProviderAvatar({ providerId, size = 32 }: { providerId: string; size?: number }) {
  const pid = providerId.toLowerCase();
  const logoUrl = PROVIDER_LOGO_URL[pid];
  const fallbackSvg = PROVIDER_LOGOS_FALLBACK[pid];

  if (logoUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        }}
      >
        <img
          src={logoUrl}
          alt={pid}
          width={size * 0.62}
          height={size * 0.62}
          style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)',
        color: 'var(--text)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.36,
        fontWeight: 700,
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      }}
    >
      {fallbackSvg ?? pid.slice(0, 2).toUpperCase()}
    </div>
  );
}

function UserAvatar({ email, size = 32 }: { email: string; size?: number }) {
  const initials = email ? (email[0]?.toUpperCase() ?? 'U') : 'U';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-hover) 100%)',
        color: 'var(--accent-text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size * 0.4,
        fontWeight: 700,
        border: '1px solid color-mix(in oklab, var(--accent) 78%, white 22%)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.18)',
      }}
    >
      {initials}
    </div>
  );
}

export function MessageRow({
  message,
  providerId,
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
  const resolvedModelLabel = message.model?.trim() || modelId.trim();
  const assistantModelLabel =
    resolvedModelLabel ||
    (resolvedProviderId ? normalizeProviderLabel(resolvedProviderId) : '助手');
  const normalizedAssistantLabel = normalizeProviderKey(assistantModelLabel);
  const normalizedResolvedProvider = normalizeProviderKey(
    normalizeProviderLabel(resolvedProviderId),
  );
  const displayName = isUser ? email || '你' : assistantModelLabel;
  const timestamp = formatShortTime(message.createdAt);
  const tokenCount = message.tokenEstimate ?? estimateTokenCount(message.content);
  const durationLabel = !isUser ? formatDurationLabel(message.durationMs) : null;
  const stopReasonLabel = !isUser ? formatStopReasonLabel(message.stopReason) : null;
  const providerLabel =
    !isUser && resolvedProviderId && normalizedAssistantLabel !== normalizedResolvedProvider
      ? normalizeProviderLabel(resolvedProviderId)
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
          <ProviderAvatar providerId={avatarProviderId} size={28} />
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
  return renderAssistantMessageContentValue(m.content);
}

export function renderStreamingChatMessageContent(content: string) {
  return renderAssistantMessageContentValue(content, { streaming: true });
}

export interface ChatToolRenderOptions {
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
  return renderAssistantMessageContentValue(m.content, options);
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
  onOpenChildSession,
  payload,
  selectedChildSessionId,
  streaming = false,
  taskRuntimeLookup,
}: {
  onOpenChildSession?: (sessionId: string) => void;
  payload: AssistantTracePayload;
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}) {
  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
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
          selectedChildSessionId,
          status: toolCall.status,
          taskRuntimeLookup,
        }),
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

function formatContextWindow(value: number | undefined): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function CapabilityTag({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'violet' | 'emerald';
}) {
  const palette =
    tone === 'accent'
      ? { bg: 'rgba(59, 130, 246, 0.10)', color: 'rgb(96, 165, 250)' }
      : tone === 'violet'
        ? { bg: 'rgba(139, 92, 246, 0.12)', color: 'rgb(167, 139, 250)' }
        : tone === 'emerald'
          ? { bg: 'rgba(16, 185, 129, 0.12)', color: 'rgb(52, 211, 153)' }
          : { bg: 'var(--surface)', color: 'var(--text-3)' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 15,
        padding: '0 4px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.color,
        border: '1px solid var(--border-subtle)',
        fontSize: 8.5,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function resolveFloatingPanelPosition(
  rect: DOMRect,
  panelWidth: number,
  preferredHeight: number,
  align: 'start' | 'end' = 'start',
): {
  top: number;
  left: number;
  maxHeight: number;
  openUp: boolean;
  transformOrigin: 'top left' | 'top right' | 'bottom left' | 'bottom right';
} {
  const viewportPadding = 8;
  const gutter = 6;
  const belowSpace = window.innerHeight - rect.bottom - viewportPadding - gutter;
  const aboveSpace = rect.top - viewportPadding - gutter;
  const openUp = belowSpace < 260 && aboveSpace > belowSpace;
  const maxHeight = Math.max(180, Math.min(openUp ? aboveSpace : belowSpace, preferredHeight));
  const top = openUp
    ? Math.max(viewportPadding, rect.top - maxHeight - gutter)
    : Math.max(viewportPadding, rect.bottom + gutter);
  const preferredLeft = align === 'end' ? rect.right - panelWidth : rect.left;
  const left = Math.max(
    viewportPadding,
    Math.min(preferredLeft, window.innerWidth - panelWidth - viewportPadding),
  );
  const vertical = openUp ? 'bottom' : 'top';
  const horizontal = align === 'end' ? 'right' : 'left';
  return {
    top,
    left,
    maxHeight,
    openUp,
    transformOrigin: `${vertical} ${horizontal}` as
      | 'top left'
      | 'top right'
      | 'bottom left'
      | 'bottom right',
  };
}

export function ModelPicker({
  providers,
  activeProviderId,
  activeModelId,
  anchorRef,
  onSelect,
  onClose,
}: {
  providers: ModelPickerProvider[];
  activeProviderId: string;
  activeModelId: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (providerId: string, modelId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [top, setTop] = React.useState(0);
  const [left, setLeft] = React.useState(0);
  const [maxHeight, setMaxHeight] = React.useState(420);
  const [search, setSearch] = React.useState('');
  const [transformOrigin, setTransformOrigin] = React.useState<
    'top left' | 'top right' | 'bottom left' | 'bottom right'
  >('top left');
  const groups = React.useMemo(
    () => buildFilteredModelGroups(providers, search),
    [providers, search],
  );

  React.useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = resolveFloatingPanelPosition(rect, 340, 430, 'start');
      setTop(next.top);
      setLeft(next.left);
      setMaxHeight(next.maxHeight);
      setTransformOrigin(next.transformOrigin);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
      }}
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
          width: '100%',
          height: '100%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top,
          left,
          zIndex: 1,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '6px 0 0',
          boxShadow: 'var(--shadow-lg)',
          minWidth: 320,
          width: 340,
          maxWidth: 'min(340px, calc(100vw - 16px))',
          maxHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transformOrigin,
        }}
      >
        <div
          style={{
            padding: '2px 12px 6px',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          选择模型
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-2)',
              padding: '0 9px',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ color: 'var(--text-3)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模型…"
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 11,
              }}
            />
          </div>
        </div>
        <div
          style={{ overflowY: 'auto', padding: '0 0 8px', flex: 1, overscrollBehavior: 'contain' }}
        >
          {groups.map(({ provider, models }) => {
            return (
              <div key={provider.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 12px 3px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 4,
                      background: 'var(--surface)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img
                      src={`/logo-${provider.type}.svg`}
                      alt={provider.name}
                      width={11}
                      height={11}
                      style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--text-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {provider.name}
                  </span>
                </div>
                {models.map((model) => {
                  const isActive = provider.id === activeProviderId && model.id === activeModelId;
                  const contextLabel = formatContextWindow(model.contextWindow);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        void onSelect(provider.id, model.id);
                        onClose();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 7,
                        width: '100%',
                        padding: '8px 10px',
                        border: 'none',
                        background: isActive ? 'var(--accent-muted)' : 'transparent',
                        color: isActive ? 'var(--accent)' : 'var(--text)',
                        fontSize: 11,
                        cursor: 'pointer',
                        textAlign: 'left',
                        borderRadius: 8,
                        margin: '0 6px 1px',
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          display: 'flex',
                          justifyContent: 'center',
                          paddingTop: 2,
                          color: isActive ? 'var(--accent)' : 'var(--text-3)',
                          flexShrink: 0,
                        }}
                      >
                        {isActive ? (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="8" />
                          </svg>
                        )}
                      </span>
                      <span
                        style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {model.name}
                        </span>
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            flexWrap: 'wrap',
                          }}
                        >
                          {model.supportsVision && <CapabilityTag label="视觉" tone="emerald" />}
                          {model.supportsTools && <CapabilityTag label="工具" tone="accent" />}
                          {model.supportsThinking && <CapabilityTag label="思考" tone="violet" />}
                          {contextLabel && <CapabilityTag label={contextLabel} />}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ModelSettingsPopover({
  anchorRef,
  open,
  onClose,
  modelLabel,
  providerType,
  modelId,
  supportsThinking,
  canConfigureThinking,
  contextWindow,
  supportsTools,
  supportsVision,
  thinkingEnabled,
  reasoningEffort,
  onChangeThinkingEnabled,
  onChangeReasoningEffort,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  modelLabel: string;
  providerType?: string;
  modelId?: string;
  supportsThinking: boolean;
  canConfigureThinking: boolean;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  onChangeThinkingEnabled: (value: boolean) => void;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
}) {
  const [top, setTop] = React.useState(0);
  const [left, setLeft] = React.useState(0);
  const [maxHeight, setMaxHeight] = React.useState(250);
  const [transformOrigin, setTransformOrigin] = React.useState<
    'top left' | 'top right' | 'bottom left' | 'bottom right'
  >('top right');

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = resolveFloatingPanelPosition(rect, 236, 260, 'end');
      setLeft(next.left);
      setTop(next.top);
      setMaxHeight(next.maxHeight);
      setTransformOrigin(next.transformOrigin);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, open]);

  if (!open) return null;

  const supportedEfforts = getSupportedReasoningEffortsForModel(providerType, modelId);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 'none' }}
      />
      <div
        style={{
          position: 'absolute',
          top,
          left,
          zIndex: 1,
          width: 236,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          padding: 9,
          maxHeight,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          transformOrigin,
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          模型设置
        </div>
        <div style={{ marginBottom: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
            {modelLabel}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {supportsVision && <CapabilityTag label="视觉" tone="emerald" />}
            {supportsTools && <CapabilityTag label="工具" tone="accent" />}
            {supportsThinking && <CapabilityTag label="思考" tone="violet" />}
            {contextWindow ? (
              <CapabilityTag label={formatContextWindow(contextWindow) ?? ''} />
            ) : null}
          </div>
        </div>
        {supportsThinking ? (
          <>
            {!canConfigureThinking ? (
              <div
                style={{
                  marginBottom: 8,
                  padding: '7px 9px',
                  borderRadius: 8,
                  background: 'rgba(139, 92, 246, 0.08)',
                  color: 'var(--text-2)',
                  fontSize: 9.5,
                  lineHeight: 1.45,
                }}
              >
                当前模型具备思考能力，但它的思考模式由模型本身决定，不能在这里单独开关。
              </div>
            ) : null}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 6,
              }}
            >
              思考等级
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                type="button"
                disabled={!canConfigureThinking}
                onClick={() => onChangeThinkingEnabled(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: 'none',
                  borderRadius: 8,
                  background: !thinkingEnabled ? 'var(--accent-muted)' : 'transparent',
                  color: !thinkingEnabled ? 'var(--accent)' : 'var(--text-2)',
                  padding: '7px 9px',
                  cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                  opacity: canConfigureThinking ? 1 : 0.45,
                  fontSize: 11,
                }}
              >
                <span>关闭思考</span>
              </button>
              {supportedEfforts.map((level) => {
                const active = thinkingEnabled && reasoningEffort === level;
                const desc = describeReasoningEffort(level);
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={!canConfigureThinking}
                    onClick={() => {
                      onChangeThinkingEnabled(true);
                      onChangeReasoningEffort(level);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      border: 'none',
                      borderRadius: 8,
                      background: active ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                      color: active ? 'rgb(167, 139, 250)' : 'var(--text-2)',
                      padding: '7px 9px',
                      cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                      opacity: canConfigureThinking ? 1 : 0.45,
                      textAlign: 'left',
                    }}
                    title={desc}
                  >
                    <span
                      style={{
                        minWidth: 44,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {level}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        color: active ? 'inherit' : 'var(--text-3)',
                        lineHeight: 1.4,
                      }}
                    >
                      {desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
            当前模型没有单独的思考等级设置。
          </div>
        )}
      </div>
    </div>
  );
}

export function WelcomeScreen({
  hasWorkspace,
  onNewSession,
  onOpenWorkspace,
}: {
  hasWorkspace: boolean;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
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
        padding: '60px 32px 40px',
        gap: 40,
        maxWidth: 560,
        width: '100%',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 0 12px var(--accent-muted)',
          }}
        >
          <svg aria-hidden="true" width="40" height="40" viewBox="0 0 32 32" fill="none">
            <path
              d="M 16,3 C 26,3 29,12 16,16"
              stroke="var(--accent-text)"
              strokeWidth="2.8"
              strokeLinecap="round"
              fill="none"
              opacity="0.92"
              transform="rotate(0, 16, 16)"
            />
            <path
              d="M 16,3 C 26,3 29,12 16,16"
              stroke="var(--accent-text)"
              strokeWidth="2.8"
              strokeLinecap="round"
              fill="none"
              opacity="0.92"
              transform="rotate(120, 16, 16)"
            />
            <path
              d="M 16,3 C 26,3 29,12 16,16"
              stroke="var(--accent-text)"
              strokeWidth="2.8"
              strokeLinecap="round"
              fill="none"
              opacity="0.92"
              transform="rotate(240, 16, 16)"
            />
            <circle cx="16" cy="16" r="2.5" fill="var(--accent-text)" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: 8,
            letterSpacing: '-0.02em',
          }}
        >
          OpenAWork
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>AI Agent 工作台</div>
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
