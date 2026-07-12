import { memo } from 'react';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import { categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type {
  NotificationRecord,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { getNotificationTypeMeta, NotificationTypeIcon, CloseIcon } from './notification-icons.js';
import { formatRelativeTime, formatAbsoluteTime } from './format-time.js';

// ── Body parsing ───────────────────────────────────────────────

interface ParsedPermissionBody {
  reason: string;
  previewAction: string;
  scope: string;
  riskLevel: string;
}

/**
 * Parse the structured notification body for permission_asked events.
 * Format: "reason\npreviewAction\nscope\nriskLevel"
 */
export function parsePermissionNotificationBody(body: string): ParsedPermissionBody | null {
  const lines = body.split('\n');
  if (lines.length < 2) return null;
  return {
    reason: lines[0] ?? '',
    previewAction: lines[1] ?? '',
    scope: lines[2] ?? '',
    riskLevel: lines[3] ?? '',
  };
}

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
  const titleMatch = notification.title.match(/·\s*(.+)$/);
  return {
    toolName: titleMatch?.[1]?.trim() ?? '',
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
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
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
                  fontSize: 9,
                  fontWeight: isSelected ? 700 : 500,
                  padding: '2px 7px',
                  borderRadius: 4,
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                    : 'transparent',
                  color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono, monospace)',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  transition: 'all 100ms cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                {level.label}
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

// ── Main component ─────────────────────────────────────────────

export interface NotificationItemProps {
  notification: NotificationRecord;
  permDetail: PendingPermissionRequest | undefined;
  sessionTitle: string | undefined;
  replying: boolean;
  selectedScope: AlwaysScopeLevel['category'] | undefined;
  index: number;
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notification: NotificationRecord) => void;
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
  onOpen,
  onDismiss,
  onReply,
  onScopeChange,
}: NotificationItemProps) {
  const typeMeta = getNotificationTypeMeta(notification.eventType);
  const isPermission = notification.eventType === 'permission_asked';
  const parsedDetail = isPermission ? buildPermissionDetail(notification, permDetail) : null;
  const createdDate = new Date(notification.createdAt);

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
        padding: '10px 30px 10px 10px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
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
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 999,
              background: typeMeta.bg,
              color: typeMeta.color,
              letterSpacing: '0.02em',
              flexShrink: 0,
            }}
          >
            {typeMeta.label}
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

        {/* Permission quick actions */}
        {isPermission && notification.sessionId && (
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
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        title="标记已读"
        aria-label="标记已读"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification);
        }}
        style={{
          position: 'absolute',
          top: 8,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          opacity: 0.5,
          transition: 'opacity 100ms, background 100ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--danger) 10%, transparent)';
          e.currentTarget.style.color = 'var(--danger)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.5';
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-muted)';
        }}
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

export const NotificationItem = memo(NotificationItemImpl);
