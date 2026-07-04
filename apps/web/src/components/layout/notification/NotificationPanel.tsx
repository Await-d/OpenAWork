import { memo } from 'react';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import type {
  NotificationRecord,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { NotificationItem } from './NotificationItem.js';
import { RefreshIcon, CheckAllIcon, EmptyInboxIcon } from './notification-icons.js';

export interface NotificationPanelProps {
  notifications: NotificationRecord[];
  permissionDetails: Record<string, PendingPermissionRequest>;
  sessionTitles: Record<string, string>;
  replyingIds: Set<string>;
  selectedScopes: Record<string, AlwaysScopeLevel['category']>;
  loading: boolean;
  position: { bottom: number; left: number };
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notification: NotificationRecord) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onReply: (notification: NotificationRecord, decision: PermissionDecision) => void;
  onScopeChange: (id: string, category: AlwaysScopeLevel['category']) => void;
}

interface DateGroup {
  key: string;
  label: string;
  items: NotificationRecord[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function groupNotificationsByDate(notifications: NotificationRecord[]): DateGroup[] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const todayItems: NotificationRecord[] = [];
  const yesterdayItems: NotificationRecord[] = [];
  const earlierItems: NotificationRecord[] = [];

  notifications.forEach((notification) => {
    const d = startOfDay(new Date(notification.createdAt));
    if (d.getTime() === today.getTime()) {
      todayItems.push(notification);
    } else if (d.getTime() === yesterday.getTime()) {
      yesterdayItems.push(notification);
    } else {
      earlierItems.push(notification);
    }
  });

  const groups: DateGroup[] = [];
  if (todayItems.length > 0) groups.push({ key: 'today', label: '今天', items: todayItems });
  if (yesterdayItems.length > 0)
    groups.push({ key: 'yesterday', label: '昨天', items: yesterdayItems });
  if (earlierItems.length > 0) groups.push({ key: 'earlier', label: '更早', items: earlierItems });
  return groups;
}

function NotificationPanelImpl({
  notifications,
  permissionDetails,
  sessionTitles,
  replyingIds,
  selectedScopes,
  loading,
  position,
  onOpen,
  onDismiss,
  onMarkAllRead,
  onRefresh,
  onReply,
  onScopeChange,
}: NotificationPanelProps) {
  const hasNotifications = notifications.length > 0;
  const permCount = notifications.filter((n) => n.eventType === 'permission_asked').length;
  const groups = groupNotificationsByDate(notifications);

  return (
    <div
      id="nc-panel-portal"
      style={{
        position: 'fixed',
        bottom: position.bottom,
        left: position.left,
        width: 380,
        maxHeight: 520,
        borderRadius: 14,
        border: '1px solid var(--border-default)',
        background: 'var(--bg-overlay)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'nc-panel-in 220ms cubic-bezier(0.16,1,0.3,1)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--bg-surface) 50%, transparent)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}
          >
            通知中心
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {hasNotifications ? (
              <>
                {notifications.length} 条未读
                {permCount > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: '1px 5px',
                      borderRadius: 999,
                      fontSize: 9,
                      fontWeight: 700,
                      background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
                      color: 'var(--warning)',
                    }}
                  >
                    {permCount} 待审批
                  </span>
                )}
              </>
            ) : (
              '已全部清空'
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            title="刷新"
            onClick={onRefresh}
            className="nc-header-btn"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              transition: 'all 100ms cubic-bezier(0.4,0,0.2,1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)';
              e.currentTarget.style.borderColor = 'var(--border-emphasis)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--fg-muted)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                animation: loading ? 'nc-spin 0.8s linear infinite' : undefined,
              }}
            >
              <RefreshIcon size={13} />
            </span>
          </button>
          <button
            type="button"
            disabled={!hasNotifications}
            onClick={onMarkAllRead}
            className="nc-header-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              padding: '0 10px',
              height: 28,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              color: hasNotifications ? 'var(--fg-default)' : 'var(--fg-muted)',
              cursor: hasNotifications ? 'pointer' : 'not-allowed',
              transition: 'all 100ms cubic-bezier(0.4,0,0.2,1)',
            }}
            onMouseEnter={
              hasNotifications
                ? (e) => {
                    e.currentTarget.style.color = 'var(--accent)';
                    e.currentTarget.style.borderColor = 'var(--border-emphasis)';
                  }
                : undefined
            }
            onMouseLeave={
              hasNotifications
                ? (e) => {
                    e.currentTarget.style.color = 'var(--fg-default)';
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }
                : undefined
            }
          >
            <CheckAllIcon size={13} />
            全部已读
          </button>
        </div>
      </div>

      {/* ── Notification list ────────────────────────── */}
      <div
        style={{
          overflowY: 'auto',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: 1,
          minHeight: 0,
        }}
        className="nc-scroll-area"
      >
        {!hasNotifications ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '48px 16px',
              textAlign: 'center',
              flex: 1,
            }}
          >
            <span
              style={{
                color: 'var(--fg-muted)',
                opacity: 0.35,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <EmptyInboxIcon size={48} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--fg-muted)',
                }}
              >
                暂无未读通知
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg-subtle, var(--fg-muted))',
                  opacity: 0.7,
                  maxWidth: 240,
                }}
              >
                Agent 的权限请求和任务更新会出现在这里
              </span>
            </div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  background: 'color-mix(in srgb, var(--bg-overlay) 92%, transparent)',
                  backdropFilter: 'blur(4px)',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{group.label}</span>
                <span>{group.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.items.map((notification, index) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    permDetail={permissionDetails[notification.id]}
                    sessionTitle={
                      notification.sessionId ? sessionTitles[notification.sessionId] : undefined
                    }
                    replying={replyingIds.has(notification.id)}
                    selectedScope={selectedScopes[notification.id]}
                    index={index}
                    onOpen={onOpen}
                    onDismiss={onDismiss}
                    onReply={onReply}
                    onScopeChange={onScopeChange}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Embedded styles ──────────────────────────── */}
      <style>{`
        @keyframes nc-panel-in {
          from { opacity: 0; transform: translateX(8px) scale(0.98); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes nc-item-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes nc-spin {
          to { transform: rotate(360deg); }
        }
        .nc-item:hover {
          border-color: var(--border-emphasis) !important;
          background: var(--bg-surface) !important;
        }
        .nc-item:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .nc-header-btn:hover {
          background: var(--bg-surface) !important;
        }
        .nc-scroll-area::-webkit-scrollbar {
          width: 5px;
        }
        .nc-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .nc-scroll-area::-webkit-scrollbar-thumb {
          background: var(--border-emphasis);
          border-radius: 999;
        }
        .nc-scroll-area::-webkit-scrollbar-thumb:hover {
          background: var(--border-strong);
        }
      `}</style>
    </div>
  );
}

export const NotificationPanel = memo(NotificationPanelImpl);
