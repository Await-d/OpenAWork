/**
 * 260517-team-page-v2 · 消息合并视图
 *
 * 把原本两个独立子 tab（消息总线 + 待回复 / @我）合并到一个子 tab 内，
 * 用 segmented control 切换：
 *   - 消息总线：所有广播 / 跟进消息流（已实现回复 / 类型筛选 / 广播）
 *   - 待回复：阻塞确认 + 通知队列（待办视图）
 *
 * 待回复条数从 useTeamNotificationStore.unreadCount 取，作为 segmented 角标。
 *
 * 合并理由：两个视图都属于「对话域」的消息切片，只是数据源不同。
 * 用户在两者之间频繁切换，分开占用两个子 tab 槽位虚高了对话主 tab 的复杂度。
 */

import type { HandoffEvent } from '../../../../../stores/team/team-events.js';
import { useMemo, useState, type CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import {
  getTeamNotificationEventKey,
  useTeamNotificationStore,
} from '../../../../../stores/team/team-events.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { resolveMatchedSharedSessionDetail } from '../../data/team-runtime-shared-context.js';
import { MessagesTab } from './MessagesTab.js';
import { MentionsView } from './MentionsView.js';
import { SharedSessionMentionsView } from './shared-session-mentions-view.js';

type MessagesSegment = 'bus' | 'mentions';

const SEGMENT_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
  flexShrink: 0,
  background: 'var(--bg-base)',
};

const SEGMENT_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const SEGMENT_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SEGMENT_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
  color: 'var(--fg-strong)',
};

const BADGE_STYLE: CSSProperties = {
  marginLeft: 2,
  padding: '0 5px',
  minWidth: 16,
  height: 16,
  borderRadius: 999,
  background: 'var(--danger)',
  color: 'var(--fg-on-accent)',
  fontSize: 9,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontVariantNumeric: 'tabular-nums',
};

export interface MessagesMergedTabProps {
  onOpenBlockingTarget?: (event: HandoffEvent) => void;
  onOpenClarifications?: () => void;
  selectedTeam: AgentTeamsSidebarTeam | null;
}

export function MessagesMergedTab({
  onOpenBlockingTarget,
  onOpenClarifications,
  selectedTeam,
}: MessagesMergedTabProps) {
  const allEvents = useTeamNotificationStore((s) => s.events);
  const readEventKeys = useTeamNotificationStore((s) => s.readEventKeys);
  const { activeSharedSession, selectedSharedSession } = useTeamRuntimeReferenceViewData();
  const [segment, setSegment] = useState<MessagesSegment>('bus');
  const sharedSession =
    selectedTeam?.isSharedSession === true
      ? resolveMatchedSharedSessionDetail({
          selectedTeamId: selectedTeam.id,
          activeSharedSession,
          selectedSharedSession,
        })
      : null;
  const isSharedSessionSelected = selectedTeam?.isSharedSession === true;

  // 按选中会话 scope 过滤未读事件数，让 badge 数字与内容一致
  const scopedTeamId = selectedTeam && !isSharedSessionSelected ? selectedTeam.id : null;
  const mentionsBadgeCount = useMemo(() => {
    if (isSharedSessionSelected) {
      return (sharedSession?.pendingPermissions.length ?? 0) +
        (sharedSession?.pendingQuestions.length ?? 0);
    }
    if (!scopedTeamId) {
      // 没有选中会话时回退到全局未读数
      return allEvents.filter((e) => !readEventKeys.has(getTeamNotificationEventKey(e))).length;
    }
    // 按选中会话过滤未读事件
    return allEvents.filter((event) => {
      const eventSessionId = event.sessionId;
      if (!eventSessionId) return true;
      const matchesScope =
        eventSessionId === scopedTeamId ||
        (typeof event.payload['fromSessionId'] === 'string' &&
          event.payload['fromSessionId'] === scopedTeamId);
      return matchesScope && !readEventKeys.has(getTeamNotificationEventKey(event));
    }).length;
  }, [allEvents, isSharedSessionSelected, readEventKeys, scopedTeamId, sharedSession]);

  const mentionsLabel = isSharedSessionSelected ? '协作待办' : '待回复';

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={SEGMENT_BAR_STYLE} role="tablist" aria-label="消息视图切换">
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'bus'}
          onClick={() => setSegment('bus')}
          style={segment === 'bus' ? SEGMENT_BTN_ACTIVE_STYLE : SEGMENT_BTN_STYLE}
        >
          <span aria-hidden>✉️</span>
          <span>消息总线</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'mentions'}
          onClick={() => setSegment('mentions')}
          style={segment === 'mentions' ? SEGMENT_BTN_ACTIVE_STYLE : SEGMENT_BTN_STYLE}
        >
          <span aria-hidden>🔔</span>
          <span>{mentionsLabel}</span>
          {mentionsBadgeCount > 0 ? (
            <span aria-label={`${mentionsLabel} ${mentionsBadgeCount} 条`} style={BADGE_STYLE}>
              {mentionsBadgeCount > 99 ? '99+' : mentionsBadgeCount}
            </span>
          ) : null}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 14px 16px',
        }}
      >
        {segment === 'bus' ? (
          <MessagesTab selectedTeam={selectedTeam} />
        ) : isSharedSessionSelected && selectedTeam ? (
          <SharedSessionMentionsView selectedTeam={selectedTeam} />
        ) : (
          <MentionsView
            onOpenBlockingTarget={onOpenBlockingTarget}
            onOpenClarifications={onOpenClarifications}
            selectedTeamId={selectedTeam && !selectedTeam.isSharedSession ? selectedTeam.id : null}
          />
        )}
      </div>
    </div>
  );
}
