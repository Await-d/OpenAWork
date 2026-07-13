import React from 'react';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import type { ChatMessage, ChatUsageDetails } from '../../conversation-runtime/messages/support.js';
import {
  estimateTokenCount,
  formatDurationLabel,
  formatShortTime,
  formatStopReasonLabel,
} from '../../conversation-runtime/messages/support.js';
import { resolveAgentAccentColor } from '../misc/agent-color-map.js';
import {
  normalizeProviderKey,
  ProviderAvatar,
  resolveProviderIdentity,
  UserAvatar,
} from '../model-picker/chat-provider-display.js';
import { MessageHoverActions } from '../message/message-hover-actions.js';

type MessageMetaTone = 'default' | 'accent' | 'danger';

interface MessageMetaItem {
  readonly label: string;
  readonly tone?: MessageMetaTone;
}

export interface MessageRowAction {
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly title?: string;
}

export interface MessageRowIdentityOverride {
  readonly color?: string;
  readonly displayName: string;
  readonly icon?: string;
  readonly initials?: string;
}

export interface BuildAssistantMetaItemsInput {
  readonly messageStatus?: ChatMessage['status'];
  readonly presentationMode: 'chat' | 'team';
  readonly toolLabel: string | null;
  readonly modifiedFileCount: number;
  readonly tokenCount: number;
  readonly usageDetails?: ChatUsageDetails;
  readonly durationLabel: string | null;
  readonly stopReasonLabel: string | null;
  readonly showDuration: boolean;
  readonly showStopReason: boolean;
  readonly showTokenBreakdown: boolean;
  readonly showEstimatedTokens: boolean;
}

export function buildAssistantMetaItems(
  input: BuildAssistantMetaItemsInput,
): readonly MessageMetaItem[] {
  const items: MessageMetaItem[] = [];

  if (input.presentationMode !== 'team' && input.usageDetails) {
    items.push({ label: `请求 ${input.usageDetails.requestIndex}` });
    if (input.usageDetails.estimatedCostUsd !== undefined) {
      items.push({ label: formatUsdCost(input.usageDetails.estimatedCostUsd) });
    }
    if (input.showDuration && input.durationLabel) {
      items.push({ label: input.durationLabel });
    }

    if (input.showTokenBreakdown) {
      items.push({
        label: `${formatCompactTokenCount(input.usageDetails.totalTokens)} tokens (${formatCompactTokenCount(input.usageDetails.inputTokens)}↓ ${formatCompactTokenCount(input.usageDetails.outputTokens)}↑)`,
      });
      items.push({
        label:
          input.usageDetails.firstTokenLatencyMs && input.usageDetails.firstTokenLatencyMs > 0
            ? `首 token ${formatDurationLabel(input.usageDetails.firstTokenLatencyMs)}`
            : '首 token --',
      });
      items.push({
        label:
          input.usageDetails.tokensPerSecond && Number.isFinite(input.usageDetails.tokensPerSecond)
            ? `TPS ${input.usageDetails.tokensPerSecond.toFixed(1)}`
            : 'TPS --',
      });
    }
  } else if (input.presentationMode !== 'team' && input.tokenCount > 0) {
    if (input.showEstimatedTokens) {
      items.push({ label: `~${input.tokenCount} tok` });
    }
    if (input.showDuration && input.durationLabel) {
      items.push({ label: input.durationLabel });
    }
  } else if (input.presentationMode !== 'team' && input.showDuration && input.durationLabel) {
    items.push({ label: input.durationLabel });
  }

  if (input.toolLabel) {
    items.push({ label: input.toolLabel });
  }

  if (input.modifiedFileCount > 0) {
    items.push({ label: `修改 ${input.modifiedFileCount} 文件` });
  }

  if (input.showStopReason && input.stopReasonLabel) {
    items.push({
      label: input.stopReasonLabel,
      tone: input.messageStatus === 'error' ? 'danger' : 'accent',
    });
  }

  if (input.messageStatus === 'streaming') {
    items.push({ label: '生成中', tone: 'accent' });
  } else if (input.messageStatus === 'error') {
    items.push({ label: '错误', tone: 'danger' });
  }

  if (items.length > 0) {
    return items;
  }

  if (input.presentationMode === 'team') {
    return [];
  }

  return [buildAssistantFallbackMetaItem(input)];
}

function buildAssistantFallbackMetaItem(
  input: BuildAssistantMetaItemsInput,
): Readonly<MessageMetaItem> {
  if (input.messageStatus === 'error') {
    return { label: '回复异常', tone: 'danger' };
  }

  if (input.messageStatus === 'streaming') {
    return { label: '正在生成', tone: 'accent' };
  }

  if (input.modifiedFileCount > 0) {
    return { label: '包含内容修改', tone: 'accent' };
  }

  if (input.toolLabel) {
    return { label: '已执行工具', tone: 'accent' };
  }
  if (input.durationLabel || input.usageDetails || input.tokenCount > 0) {
    return { label: '已生成回复' };
  }

  return { label: '助手回复' };
}

export function MessageRow({
  message,
  providerId,
  providerName,
  providerType,
  modelId,
  email,
  actions,
  groupedWithPrevious = false,
  identityOverride,
  presentationMode = 'chat',
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
  actions?: readonly MessageRowAction[];
  groupedWithPrevious?: boolean;
  identityOverride?: MessageRowIdentityOverride;
  presentationMode?: 'chat' | 'team';
  renderContent: (m: ChatMessage) => React.ReactNode;
  sharedUiThemeVars: React.CSSProperties;
  usageDetails?: ChatUsageDetails;
}) {
  const isUser = message.role === 'user';
  const showMessageTimestamps = useDisplayPreferencesStore((s) => s.showMessageTimestamps);
  const showModelNamePref = useDisplayPreferencesStore((s) => s.showModelName);
  const showProviderLabelPref = useDisplayPreferencesStore((s) => s.showProviderLabel);
  const showDurationPref = useDisplayPreferencesStore((s) => s.showDuration);
  const showStopReasonPref = useDisplayPreferencesStore((s) => s.showStopReason);
  const showTokenBreakdownPref = useDisplayPreferencesStore((s) => s.showTokenBreakdown);
  const showEstimatedTokensPref = useDisplayPreferencesStore((s) => s.showEstimatedTokens);
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
  const overrideDisplayName = identityOverride?.displayName?.trim();
  const displayName = isUser
    ? overrideDisplayName || email || '你'
    : overrideDisplayName || (showModelNamePref ? assistantModelLabel : '助手');
  const timestamp = formatShortTime(message.createdAt);
  const tokenCount = message.tokenEstimate ?? estimateTokenCount(message.content);
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
  const avatarProviderId = resolvedProviderId || 'assistant';
  const agentAccent = !isUser
    ? identityOverride?.color || resolveAgentAccentColor(message.agentId)
    : undefined;
  const agentPillStyle: React.CSSProperties | undefined = agentAccent
    ? {
        borderColor: `color-mix(in oklch, ${agentAccent} 30%, var(--border-subtle) 70%)`,
        background: `linear-gradient(135deg, color-mix(in oklch, ${agentAccent} 12%, var(--bg-overlay) 88%), var(--bg-overlay))`,
        color: `color-mix(in oklch, ${agentAccent} 75%, var(--fg-default) 25%)`,
      }
    : undefined;
  const metaItems = !isUser
    ? buildAssistantMetaItems({
        messageStatus: message.status,
        presentationMode,
        toolLabel,
        modifiedFileCount: message.modifiedFilesSummary?.files.length ?? 0,
        tokenCount,
        usageDetails,
        durationLabel,
        stopReasonLabel,
        showDuration: showDurationPref,
        showStopReason: showStopReasonPref,
        showTokenBreakdown: showTokenBreakdownPref,
        showEstimatedTokens: showEstimatedTokensPref,
      })
    : [];

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
      >
        {isUser && identityOverride ? (
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: identityOverride.color ?? 'var(--fg-strong)',
              background: `color-mix(in srgb, ${identityOverride.color ?? 'var(--accent)'} 12%, var(--bg-overlay))`,
              border: `1px solid color-mix(in srgb, ${identityOverride.color ?? 'var(--accent)'} 28%, transparent)`,
            }}
            title={identityOverride.displayName}
          >
            {identityOverride.icon ??
              identityOverride.initials ??
              identityOverride.displayName.slice(0, 1)}
          </div>
        ) : isUser ? (
          <UserAvatar email={email} size={28} />
        ) : identityOverride ? (
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: identityOverride.color ?? 'var(--fg-strong)',
              background: `color-mix(in srgb, ${identityOverride.color ?? 'var(--accent)'} 12%, var(--bg-overlay))`,
              border: `1px solid color-mix(in srgb, ${identityOverride.color ?? 'var(--accent)'} 28%, transparent)`,
            }}
            title={identityOverride.displayName}
          >
            {identityOverride.icon ??
              identityOverride.initials ??
              identityOverride.displayName.slice(0, 1)}
          </div>
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
              {presentationMode !== 'team' && showProviderLabelPref && providerLabel && (
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
                        padding: '0 8px',
                        borderRadius: 999,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-overlay)',
                        color: 'var(--fg-default)',
                        fontSize: 10,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'background 120ms ease, border-color 120ms ease',
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {showMessageTimestamps && timestamp && (
                <div className="chat-message-timestamp">{timestamp}</div>
              )}
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
        {metaItems.length > 0 && <MetaLine items={metaItems} />}
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

function MetaLine({ items }: { items: readonly MessageMetaItem[] }) {
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
