import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import type { ChatMessage, ChatUsageDetails } from '../../conversation-runtime/messages/support.js';
import {
  estimateTokenCount,
  formatDurationLabel,
  formatShortTime,
  formatStopReasonLabel,
  isCompactionMessage,
} from '../../conversation-runtime/messages/support.js';
import { formatAbsoluteTime } from '../../layout/notification/format-time.js';
import { resolveAgentAccentColor } from '../misc/agent-color-map.js';
import {
  normalizeProviderKey,
  ProviderAvatar,
  resolveProviderIdentity,
  UserAvatar,
} from '../model-picker/chat-provider-display.js';
import { MessageHoverActions } from '../message/message-hover-actions.js';
import { useRelativeTime } from './use-relative-time.js';

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
  readonly showRequestIndex: boolean;
  readonly showToolCount: boolean;
  /**
   * 是否包含「用量类」统计项（请求序号 / 费用 / 耗时 / Token 明细 / 首 token / TPS / 工具数）。
   *
   * 传 `false` 时只保留诊断类信息（停止原因、异常终态、修改文件数）——这是
   * 「仅最新一条消息展示统计信息」的实现基础：历史消息的统计行整行不渲染，
   * 但错误 / 已停止这类状态仍然可见（静默隐藏会让用户看不出对话为何中断）。
   *
   * 缺省视为 `true`，保持纯函数既有行为不变。
   */
  readonly includeStats?: boolean;
}

export function buildAssistantMetaItems(
  input: BuildAssistantMetaItemsInput,
): readonly MessageMetaItem[] {
  const items: MessageMetaItem[] = [];
  const includeStats = input.includeStats !== false;

  if (input.presentationMode !== 'team' && input.usageDetails) {
    if (includeStats) {
      if (input.showRequestIndex) {
        items.push({ label: `请求 ${input.usageDetails.requestIndex}` });
      }
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
            input.usageDetails.tokensPerSecond &&
            Number.isFinite(input.usageDetails.tokensPerSecond)
              ? `TPS ${input.usageDetails.tokensPerSecond.toFixed(1)}`
              : 'TPS --',
        });
      }
    }
  } else if (input.presentationMode !== 'team' && input.tokenCount > 0) {
    if (includeStats) {
      if (input.showEstimatedTokens) {
        items.push({ label: `~${input.tokenCount} tok` });
      }
      if (input.showDuration && input.durationLabel) {
        items.push({ label: input.durationLabel });
      }
    }
  } else if (
    input.presentationMode !== 'team' &&
    includeStats &&
    input.showDuration &&
    input.durationLabel
  ) {
    items.push({ label: input.durationLabel });
  }

  if (includeStats && input.showToolCount && input.toolLabel) {
    items.push({ label: input.toolLabel });
  }

  if (input.modifiedFileCount > 0) {
    items.push({ label: `修改 ${input.modifiedFileCount} 文件` });
  }

  // Always surface abnormal terminal states (error / cancelled), even when
  // the user has toggled off the generic stop-reason preference. Silent
  // stops are the main complaint ("对话莫名停止了，不知道原因").
  const isAbnormalTerminal =
    input.messageStatus === 'error' ||
    input.messageStatus === 'cancelled' ||
    input.stopReasonLabel === '错误' ||
    input.stopReasonLabel === '已停止';

  if ((input.showStopReason || isAbnormalTerminal) && input.stopReasonLabel) {
    items.push({
      label: input.stopReasonLabel,
      tone:
        input.messageStatus === 'error' || input.stopReasonLabel === '错误' ? 'danger' : 'accent',
    });
  }

  if (input.messageStatus === 'streaming') {
    items.push({ label: '生成中', tone: 'accent' });
  } else if (input.messageStatus === 'error') {
    // Avoid duplicating the "错误" chip when stopReason already says so.
    if (input.stopReasonLabel !== '错误') {
      items.push({ label: '错误', tone: 'danger' });
    }
  } else if (input.messageStatus === 'cancelled') {
    if (input.stopReasonLabel !== '已停止') {
      items.push({ label: '已停止', tone: 'accent' });
    }
  }

  if (items.length > 0) {
    return items;
  }

  if (input.presentationMode === 'team') {
    return [];
  }

  // 统计被抑制且没有任何诊断项：整行不渲染。不能落到 fallback（否则每条历史
  // 消息都会顶着一个「已生成回复」的无信息量标签，等于没省）。
  if (!includeStats) {
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

  if (input.messageStatus === 'cancelled') {
    return { label: '已停止', tone: 'accent' };
  }

  if (input.messageStatus === 'streaming') {
    return { label: '正在生成', tone: 'accent' };
  }

  if (input.modifiedFileCount > 0) {
    return { label: '包含内容修改', tone: 'accent' };
  }

  if (input.toolLabel) {
    return { label: '包含工具调用', tone: 'accent' };
  }
  if (input.durationLabel || input.usageDetails || input.tokenCount > 0) {
    return { label: '已生成回复' };
  }

  return { label: '助手回复' };
}

export const MessageRow = React.memo(function MessageRow({
  message,
  providerId,
  providerName,
  providerType,
  modelId,
  email,
  currentUserDisplayName,
  actions,
  groupedWithPrevious = false,
  identityOverride,
  presentationMode = 'chat',
  renderContent,
  sharedUiThemeVars,
  usageDetails,
  isLatestMessage,
}: {
  message: ChatMessage;
  providerId: string;
  providerName?: string;
  providerType?: string;
  modelId: string;
  email: string;
  currentUserDisplayName?: string;
  actions?: readonly MessageRowAction[];
  groupedWithPrevious?: boolean;
  identityOverride?: MessageRowIdentityOverride;
  presentationMode?: 'chat' | 'team';
  renderContent: (m: ChatMessage) => React.ReactNode;
  sharedUiThemeVars: React.CSSProperties;
  usageDetails?: ChatUsageDetails;
  /**
   * 该消息是否为当前会话最新一条助手消息。
   *
   * 只在 `metaLineScope === 'latest'` 时参与判定：`false` 表示历史消息，
   * 统计类信息不展示（诊断类仍保留）。缺省视为最新，供不经列表渲染的
   * 单测 / 复用点保持既有行为。
   */
  isLatestMessage?: boolean;
}) {
  const isUser = message.role === 'user';
  /*
   * 压缩标记是**会话级系统事件**，不是「某个模型说的一句话」。
   *
   * 它此前走完整消息行：左侧占 28px 头像 + 12px 间距，卡片在自己的内容区里居中，
   * 于是视觉上比整行中线**右偏约 20px**（实测 390/768/1440 三档均为 19–20px），
   * 同时还顶着模型名 / 时间 / 复制按钮——一条系统提示被渲染成了模型发言。
   *
   * 这里让它走「通栏」形态：不渲染头像列、消息头与元信息行，内容区独占整行，
   * 胶囊因此对齐到行的对称轴，与 `TimeDividerRow` / `SubagentNoticeRow` 一致。
   */
  const isCompaction = isCompactionMessage(message);
  // 单一订阅 + shallow 比较：每行从 10 个 store 订阅降为 1 个。长列表（未虚拟化
  // 的会话可达数百行）下订阅数量随行数线性放大，这是 memo 之外的第二重列表成本。
  const messageRowPrefs = useDisplayPreferencesStore(
    useShallow((s) => ({
      showDuration: s.showDuration,
      showEstimatedTokens: s.showEstimatedTokens,
      showMessageTimestamps: s.showMessageTimestamps,
      showMetaLine: s.showMetaLine,
      metaLineScope: s.metaLineScope,
      showModelName: s.showModelName,
      showProviderLabel: s.showProviderLabel,
      showRequestIndex: s.showRequestIndex,
      showStopReason: s.showStopReason,
      showTokenBreakdown: s.showTokenBreakdown,
      showToolCount: s.showToolCount,
    })),
  );
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
  const resolvedCurrentUserDisplayName = currentUserDisplayName?.trim();
  const displayName = isUser
    ? overrideDisplayName || resolvedCurrentUserDisplayName || email || '你'
    : overrideDisplayName || (messageRowPrefs.showModelName ? assistantModelLabel : '助手');

  // 使用动态相对时间（"2分钟前"），而不是固定时间（"14:30"）
  const relativeTime = useRelativeTime(message.createdAt, messageRowPrefs.showMessageTimestamps);
  // 绝对时间用于 hover title
  const absoluteTime =
    message.createdAt !== undefined
      ? formatAbsoluteTime(
          typeof message.createdAt === 'number'
            ? new Date(message.createdAt)
            : new Date(message.createdAt),
        )
      : null;
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
        showDuration: messageRowPrefs.showDuration,
        showStopReason: messageRowPrefs.showStopReason,
        showTokenBreakdown: messageRowPrefs.showTokenBreakdown,
        showEstimatedTokens: messageRowPrefs.showEstimatedTokens,
        showRequestIndex: messageRowPrefs.showRequestIndex,
        showToolCount: messageRowPrefs.showToolCount,
        includeStats: messageRowPrefs.metaLineScope !== 'latest' || isLatestMessage !== false,
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
      /* 压缩胶囊走通栏：隐藏头像列、消息头与元信息行（见下方 `isCompaction`
         的条件渲染），内容区独占整行，胶囊才能对齐行的对称轴。 */
      data-layout={isCompaction ? 'compact-bar' : undefined}
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
          <UserAvatar
            email={email}
            displayName={resolvedCurrentUserDisplayName || undefined}
            size={28}
          />
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
        {!groupedWithPrevious && !isCompaction && (
          <div className="chat-message-header">
            <div className="chat-message-title-group">
              <div
                className="chat-message-display-name"
                style={agentAccent ? { color: agentAccent } : undefined}
              >
                {displayName}
              </div>
              {presentationMode !== 'team' &&
                messageRowPrefs.showProviderLabel &&
                providerLabel && (
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
              {messageRowPrefs.showMessageTimestamps && relativeTime && (
                <div className="chat-message-timestamp" title={absoluteTime ?? undefined}>
                  {relativeTime}
                </div>
              )}
            </div>
          </div>
        )}
        <div
          className="chat-message-content-shell"
          data-role={message.role}
          data-status={message.status ?? 'completed'}
        >
          {!isCompactionMessage(message) && (
            <MessageHoverActions getCopyText={() => message.content} />
          )}
          <div className="chat-message-content" data-role={message.role} style={sharedUiThemeVars}>
            {renderContent(message)}
          </div>
        </div>
        {messageRowPrefs.showMetaLine && metaItems.length > 0 && !isCompaction && (
          <MetaLine items={metaItems} />
        )}
      </div>
    </article>
  );
});

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

interface MetaLineEntry {
  readonly fragmentKey: string;
  readonly shouldPrefixSeparator: boolean;
  readonly item: MessageMetaItem;
}

/**
 * 元信息项 → (分隔符前缀判定, 稳定 key)。
 *
 * 偏移量原本写成 `MetaLine` 渲染作用域里的 `let offset` + `items.map` 回调里的
 * `offset += …`：React Compiler 把「渲染作用域变量被嵌套回调改写」判为
 * "Cannot reassign variable after render completes"，整个 `MetaLine` 退出优化。
 * 计算挪到模块级纯函数（普通函数不进编译器，局部 `let` 累加合法），
 * 渲染期只消费不变的 entries。
 */
function buildMetaLineEntries(items: readonly MessageMetaItem[]): MetaLineEntry[] {
  const entries: MetaLineEntry[] = [];
  let offset = 0;
  for (const item of items) {
    entries.push({
      fragmentKey: `${item.tone ?? 'default'}-${offset}-${item.label}`,
      shouldPrefixSeparator: offset > 0,
      item,
    });
    offset += item.label.length + 1;
  }
  return entries;
}

/**
 * 元信息行（消息底部）。
 */
function MetaLine({ items }: { items: readonly MessageMetaItem[] }) {
  const entries = buildMetaLineEntries(items);

  return (
    <div className="chat-message-meta-row" data-message-meta-row="true">
      {entries.map(({ fragmentKey, shouldPrefixSeparator, item }) => (
        <React.Fragment key={fragmentKey}>
          {shouldPrefixSeparator && <span className="chat-message-meta-separator">·</span>}
          <span className={`chat-message-meta-item${item.tone ? ` is-${item.tone}` : ''}`}>
            {item.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
