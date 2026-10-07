import { memo } from 'react';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import { categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type {
  NotificationRecord,
  NotificationView,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { getNotificationTypeMeta, NotificationTypeIcon } from './notification-icons.js';
import { formatRelativeTime, formatAbsoluteTime } from './format-time.js';
import {
  extractPermissionToolName,
  matchPendingPermissionForNotification,
  parsePermissionNotificationBody,
} from '../../../utils/permission/permission-notification.js';

// ── Body parsing ───────────────────────────────────────────────
export { matchPendingPermissionForNotification, parsePermissionNotificationBody };

// ── Permission detail ──────────────────────────────────────────

interface ParsedPermissionDetail {
  toolName: string;
  reason: string;
  previewAction: string;
  riskLevel: string;
}

function buildPermissionDetail(
  notification: NotificationRecord,
  permDetail: PendingPermissionRequest | undefined,
): ParsedPermissionDetail | null {
  if (permDetail) {
    return {
      toolName: permDetail.toolName,
      reason: permDetail.reason,
      previewAction: permDetail.previewAction ?? '',
      riskLevel: permDetail.riskLevel,
    };
  }
  const p = parsePermissionNotificationBody(notification.body);
  if (!p) return null;
  return {
    toolName: extractPermissionToolName(notification.title) ?? '',
    reason: p.reason,
    previewAction: p.previewAction,
    riskLevel: p.riskLevel,
  };
}

// ── Risk level helpers ─────────────────────────────────────────

function riskLevelStyle(riskLevel: string): { bg: string; color: string } {
  switch (riskLevel) {
    case 'high':
      return {
        bg: 'color-mix(in srgb, var(--danger) 14%, transparent)',
        color: 'var(--danger)',
      };
    case 'medium':
      return {
        bg: 'color-mix(in srgb, var(--warning) 14%, transparent)',
        color: 'var(--warning)',
      };
    default:
      return {
        bg: 'color-mix(in srgb, var(--success) 14%, transparent)',
        color: 'var(--success)',
      };
  }
}

function riskLevelLabel(riskLevel: string): string {
  switch (riskLevel) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    default:
      return '低风险';
  }
}

function scopeOrderLabel(category: AlwaysScopeLevel['category']): string {
  switch (category) {
    case 'full':
      return '第一档';
    case 'partial':
      return '第二档';
    case 'base':
      return '第三档';
  }
}

// ── Permission action buttons ──────────────────────────────────

interface PermissionActionsProps {
  notificationId: string;
  replying: boolean;
  permDetail: PendingPermissionRequest | undefined;
  selectedScope: AlwaysScopeLevel['category'] | undefined;
  onScopeChange: (id: string, category: AlwaysScopeLevel['category']) => void;
  onReply: (notification: NotificationRecord, decision: PermissionDecision) => void;
  notification: NotificationRecord;
}

function PermissionActions({
  notificationId,
  replying,
  permDetail,
  selectedScope,
  onScopeChange,
  onReply,
  notification,
}: PermissionActionsProps) {
  const levels = permDetail
    ? categorizeAlwaysPatterns(permDetail.previewAction, permDetail.scope, permDetail.always)
    : [];
  const selectedCategory = selectedScope ?? 'base';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
      {levels.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              flexShrink: 0,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            授权范围
          </span>
          {levels.map((level) => {
            const isSelected = selectedCategory === level.category;
            return (
              <button
                key={level.category}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onScopeChange(notificationId, level.category);
                }}
                title={`${level.description}: ${level.pattern}`}
                style={{
                  appearance: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                    : 'transparent',
                  color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition:
                    'border-color 100ms cubic-bezier(0.4,0,0.2,1), background 100ms cubic-bezier(0.4,0,0.2,1), color 100ms cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  <span
                    style={{
                      padding: '1px 5px',
                      borderRadius: 999,
                      background: isSelected
                        ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                        : 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
                    }}
                  >
                    {scopeOrderLabel(level.category)}
                  </span>
                  <span>{level.label}</span>
                </span>
                <code
                  style={{
                    display: 'block',
                    width: '100%',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 10,
                    lineHeight: 1.45,
                    color: isSelected ? 'var(--fg-strong)' : 'var(--fg-default)',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {level.pattern}
                </code>
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1.4,
                    color: 'var(--fg-muted)',
                  }}
                >
                  {level.description}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={replying}
          onClick={(e) => {
            e.stopPropagation();
            onReply(notification, 'once');
          }}
          title="只批准当前这一次工具调用"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '5px 12px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            cursor: replying ? 'wait' : 'pointer',
            opacity: replying ? 0.6 : 1,
            boxShadow: 'var(--shadow-sm)',
            transition: 'opacity 100ms, transform 100ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          允许一次
        </button>
        <button
          type="button"
          disabled={replying}
          onClick={(e) => {
            e.stopPropagation();
            onReply(notification, 'session');
          }}
          title="仅在当前会话内记住这次授权选择"
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 999,
            border: '1px solid var(--accent-border, var(--accent))',
            background: 'transparent',
            color: 'var(--accent)',
            cursor: replying ? 'wait' : 'pointer',
            opacity: replying ? 0.6 : 1,
            transition: 'background 100ms, opacity 100ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          本会话
        </button>
        <button
          type="button"
          disabled={replying}
          onClick={(e) => {
            e.stopPropagation();
            onReply(notification, 'permanent');
          }}
          title="会记住后续同类请求，请谨慎选择"
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 999,
            border: '1px solid var(--accent-border, var(--accent))',
            background: 'transparent',
            color: 'var(--accent)',
            cursor: replying ? 'wait' : 'pointer',
            opacity: replying ? 0.6 : 1,
            transition: 'background 100ms, opacity 100ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 12%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          永久允许
        </button>
        <button
          type="button"
          disabled={replying}
          onClick={(e) => {
            e.stopPropagation();
            onReply(notification, 'reject');
          }}
          title="阻止本次调用，工具不会继续执行"
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 10px',
            borderRadius: 999,
            border: 'none',
            background: 'transparent',
            color: 'var(--danger)',
            cursor: replying ? 'wait' : 'pointer',
            opacity: replying ? 0.6 : 1,
            transition: 'background 100ms, opacity 100ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 12%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

// ── Secondary action row ───────────────────────────────────────

/**
 * 底部次级动作（标记已读 / 忽略 / 忽略此会话）。
 * 刻意做成文字按钮而非右上角悬浮图标：图标只有 × 时，用户无法把「关掉」和
 * 「处理掉」区分开，于是干脆不点——通知因此永远留在列表里。
 */
const SECONDARY_ACTION_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  borderRadius: 4,
  transition: 'color 100ms',
};

const RESOLVED_STATUS_META: Readonly<Record<string, { label: string; color: string }>> = {
  read: { label: '已读', color: 'var(--fg-muted)' },
  acted: { label: '已处理', color: 'var(--success)' },
  archived: { label: '已归档', color: 'var(--fg-muted)' },
  expired: { label: '已失效', color: 'var(--fg-subtle, var(--fg-muted))' },
};

// ── Main component ─────────────────────────────────────────────

export interface NotificationItemProps {
  notification: NotificationRecord;
  permDetail: PendingPermissionRequest | undefined;
  sessionTitle: string | undefined;
  replying: boolean;
  selectedScope: AlwaysScopeLevel['category'] | undefined;
  index: number;
  view: NotificationView;
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notification: NotificationRecord) => void;
  onArchive: (notification: NotificationRecord) => void;
  onArchiveSession: (sessionId: string) => void;
  onReply: (notification: NotificationRecord, decision: PermissionDecision) => void;
  onScopeChange: (id: string, category: AlwaysScopeLevel['category']) => void;
}

function NotificationItemImpl({
  notification,
  permDetail,
  sessionTitle,
  replying,
  selectedScope,
  index,
  view,
  onOpen,
  onDismiss,
  onArchive,
  onArchiveSession,
  onReply,
  onScopeChange,
}: NotificationItemProps) {
  const typeMeta = getNotificationTypeMeta(notification.eventType);
  const isPermission = notification.eventType === 'permission_asked';
  const parsedDetail = isPermission ? buildPermissionDetail(notification, permDetail) : null;
  const createdDate = new Date(notification.createdAt);
  // 归档视图是只读回溯视图：不再提供「标记已读 / 审批」等会改动待办态的动作。
  const isArchivedView = view === 'archived';
  // 已处理 / 已忽略的待办不再重复给出审批按钮（提交会 409）。
  const isActionablePending =
    notification.kind === 'actionable' && notification.status === 'unread' && !isArchivedView;
  const resolvedMeta =
    notification.status === 'unread' ? undefined : RESOLVED_STATUS_META[notification.status];
  // 结果播报降级展示：类型徽章不再用高饱和底色，避免和真待办抢注意力。
  const typeBadgeStyle = {
    background: notification.kind === 'actionable' ? typeMeta.bg : 'transparent',
    color: notification.kind === 'actionable' ? typeMeta.color : 'var(--fg-muted)',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(notification)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(notification);
        }
      }}
      className="nc-item"
      style={{
        position: 'relative',
        display: 'flex',
        gap: 10,
        padding: '10px 12px 10px 10px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
        opacity: isArchivedView ? 0.72 : 1,
        cursor: 'pointer',
        transition:
          'border-color 150ms cubic-bezier(0.16,1,0.3,1), background 150ms cubic-bezier(0.16,1,0.3,1)',
        animation: `nc-item-enter 280ms cubic-bezier(0.16,1,0.3,1) ${Math.min(index * 40, 200)}ms both`,
      }}
    >
      {/* Left icon column */}
      <div
        style={{
          width: 32,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: typeMeta.bg,
            color: typeMeta.color,
            display: 'grid',
            placeItems: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <NotificationTypeIcon type={typeMeta.icon} size={14} />
        </div>
      </div>

      {/* Content column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        {/* Meta row: type badge + time */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 999,
                letterSpacing: '0.02em',
                flexShrink: 0,
                ...typeBadgeStyle,
              }}
            >
              {typeMeta.label}
            </span>
            {resolvedMeta && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  color: resolvedMeta.color,
                  flexShrink: 0,
                }}
              >
                {resolvedMeta.label}
              </span>
            )}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              flexShrink: 0,
            }}
            title={formatAbsoluteTime(createdDate)}
          >
            {formatRelativeTime(createdDate)}
          </span>
        </div>

        {/* Title */}
        <h4
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={notification.title}
        >
          {notification.title}
        </h4>

        {/* Body text (hidden when permission detail is shown) */}
        {!parsedDetail && (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--fg-default)',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {notification.body}
          </p>
        )}

        {/* Permission detail block */}
        {parsedDetail && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 2,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--warning) 5%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warning) 12%, var(--border-subtle))',
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
                  fontWeight: 700,
                  color: 'var(--accent)',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 160,
                }}
                title={parsedDetail.toolName}
              >
                {parsedDetail.toolName || '未知工具'}
              </span>
              {parsedDetail.riskLevel && (
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontWeight: 700,
                    ...riskLevelStyle(parsedDetail.riskLevel),
                  }}
                >
                  {riskLevelLabel(parsedDetail.riskLevel)}
                </span>
              )}
            </div>
            {parsedDetail.reason && (
              <p
                style={{
                  margin: 0,
                  color: 'var(--fg-default)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
                title={parsedDetail.reason}
              >
                {parsedDetail.reason}
              </p>
            )}
            {parsedDetail.previewAction && (
              <code
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 9,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                  background: 'color-mix(in srgb, var(--fg-muted) 8%, transparent)',
                  padding: '2px 5px',
                  borderRadius: 4,
                }}
                title={parsedDetail.previewAction}
              >
                {parsedDetail.previewAction}
              </code>
            )}
          </div>
        )}

        {/* Session tag for non-permission notifications */}
        {!isPermission && sessionTitle && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: 'var(--fg-muted)',
              marginTop: 2,
            }}
          >
            <span style={{ color: 'var(--border-emphasis)' }}>·</span>
            <span
              style={{
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`来自会话: ${sessionTitle}`}
            >
              {sessionTitle}
            </span>
          </div>
        )}

        {/* Permission quick actions — only when we still have a live pending request.
            Resolved/expired permissions stay in the list until marked read, but
            must not re-offer decide buttons that will 409. */}
        {isPermission &&
          notification.sessionId &&
          permDetail?.status === 'pending' &&
          isActionablePending && (
            <PermissionActions
              notificationId={notification.id}
              replying={replying}
              permDetail={permDetail}
              selectedScope={selectedScope}
              onScopeChange={onScopeChange}
              onReply={onReply}
              notification={notification}
            />
          )}

        {/* 处理出口：只读归档视图不提供任何改动待办态的动作。 */}
        {!isArchivedView && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(notification);
              }}
              className="nc-item-action"
              style={SECONDARY_ACTION_STYLE}
            >
              标记已读
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(notification);
              }}
              className="nc-item-action"
              title="忽略这条通知（可在「已归档」中找回）"
              style={SECONDARY_ACTION_STYLE}
            >
              忽略
            </button>
            {notification.sessionId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchiveSession(notification.sessionId as string);
                }}
                className="nc-item-action"
                title="忽略该会话的全部通知"
                style={SECONDARY_ACTION_STYLE}
              >
                忽略此会话
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const NotificationItem = memo(NotificationItemImpl);
