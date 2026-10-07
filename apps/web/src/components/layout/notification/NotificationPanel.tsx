import { memo } from 'react';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import type {
  NotificationRecord,
  NotificationView,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { NotificationItem } from './NotificationItem.js';
import { RefreshIcon, CheckAllIcon, EmptyInboxIcon } from './notification-icons.js';

export interface NotificationPanelProps {
  notifications: NotificationRecord[];
  /**
   * 待处理视图下被折叠掉的结果播报数。用于空态解释「刚收到的任务完成去哪了」——
   * 否则空态看起来像消息丢了，用户会反复刷新。
   */
  hiddenInformationalCount?: number;
  permissionDetails: Record<string, PendingPermissionRequest>;
  sessionTitles: Record<string, string>;
  replyingIds: Set<string>;
  selectedScopes: Record<string, AlwaysScopeLevel['category']>;
  loading: boolean;
  position: { bottom: number; left: number };
  view: NotificationView;
  pendingActionableCount: number;
  onViewChange: (view: NotificationView) => void;
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notification: NotificationRecord) => void;
  onArchive: (notification: NotificationRecord) => void;
  onArchiveSession: (sessionId: string) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onReply: (notification: NotificationRecord, decision: PermissionDecision) => void;
  onScopeChange: (id: string, category: AlwaysScopeLevel['category']) => void;
}

const VIEW_TABS: ReadonlyArray<{ key: NotificationView; label: string }> = [
  { key: 'pending', label: '待处理' },
  { key: 'all', label: '全部' },
  { key: 'archived', label: '已归档' },
];

const VIEW_EMPTY_COPY: Readonly<Record<NotificationView, { title: string; hint: string }>> = {
  pending: {
    title: '全部处理完了',
    hint: '没有待响应的权限请求或提问',
  },
  all: {
    title: '暂无通知',
    hint: 'Agent 的权限请求和任务更新会出现在这里',
  },
  archived: {
    title: '归档为空',
    hint: '忽略过的通知会留在这里，随时可以回溯',
  },
  expired: {
    title: '没有已失效的通知',
    hint: '会话停止或超过存活期的待办会归入这里',
  },
};

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
  hiddenInformationalCount = 0,
  permissionDetails,
  sessionTitles,
  replyingIds,
  selectedScopes,
  loading,
  position,
  view,
  pendingActionableCount,
  onViewChange,
  onOpen,
  onDismiss,
  onArchive,
  onArchiveSession,
  onMarkAllRead,
  onRefresh,
  onReply,
  onScopeChange,
}: NotificationPanelProps) {
  const hasNotifications = notifications.length > 0;
  const permCount = notifications.filter((n) => n.kind === 'actionable').length;
  const groups = groupNotificationsByDate(notifications);
  // 有结果播报被折叠时，空态必须解释它们去了哪 —— 否则看起来像消息丢了，用户会反复刷新。
  const emptyCopy: { title: string; hint: string } =
    view === 'pending' && hiddenInformationalCount > 0
      ? {
          title: '没有待处理的请求',
          hint: `${hiddenInformationalCount} 条任务结果已折叠，可在「全部」中查看`,
        }
      : VIEW_EMPTY_COPY[view];
  // 只有「待处理」视图下「全部已读」才有意义——归档里的条目已读与否不影响任何待办。
  const canMarkAllRead = view === 'pending' && hasNotifications;

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
            {view === 'pending' && pendingActionableCount > 0
              ? `${pendingActionableCount} 条待处理`
              : view === 'archived'
                ? '已忽略的通知'
                : hasNotifications
                  ? `${notifications.length} 条`
                  : '暂无记录'}
            {permCount > 0 && view === 'pending' && (
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
                {permCount} 待响应
              </span>
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
            disabled={!canMarkAllRead}
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
              color: canMarkAllRead ? 'var(--fg-default)' : 'var(--fg-muted)',
              cursor: canMarkAllRead ? 'pointer' : 'not-allowed',
              transition: 'all 100ms cubic-bezier(0.4,0,0.2,1)',
            }}
            onMouseEnter={
              canMarkAllRead
                ? (e) => {
                    e.currentTarget.style.color = 'var(--accent)';
                    e.currentTarget.style.borderColor = 'var(--border-emphasis)';
                  }
                : undefined
            }
            onMouseLeave={
              canMarkAllRead
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

      {/* ── View tabs ─────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="通知视图"
        style={{
          display: 'flex',
          gap: 2,
          padding: '8px 8px 0',
          flexShrink: 0,
        }}
      >
        {VIEW_TABS.map((tab) => {
          const active = tab.key === view;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(tab.key)}
              className="nc-tab"
              style={{
                flex: 1,
                height: 26,
                borderRadius: 7,
                border: '1px solid transparent',
                background: active ? 'var(--bg-surface)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--fg-muted)',
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 120ms cubic-bezier(0.4,0,0.2,1)',
              }}
            >
              {tab.label}
              {tab.key === 'pending' && pendingActionableCount > 0 && (
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    color: active ? 'var(--accent)' : 'var(--warning)',
                  }}
                >
                  {pendingActionableCount}
                </span>
              )}
            </button>
          );
        })}
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
                {emptyCopy.title}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg-subtle, var(--fg-muted))',
                  opacity: 0.7,
                  maxWidth: 240,
                }}
              >
                {emptyCopy.hint}
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
                    view={view}
                    onOpen={onOpen}
                    onDismiss={onDismiss}
                    onArchive={onArchive}
                    onArchiveSession={onArchiveSession}
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
        .nc-tab:hover {
          color: var(--accent);
        }
        .nc-tab:focus-visible,
        .nc-item-action:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .nc-scroll-area::-webkit-scrollbar {
          width: 5px;
        }
        .nc-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .nc-scroll-area::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb);
          border-radius: 999;
        }
        .nc-scroll-area::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover);
        }
      `}</style>
    </div>
  );
}

export const NotificationPanel = memo(NotificationPanelImpl);
