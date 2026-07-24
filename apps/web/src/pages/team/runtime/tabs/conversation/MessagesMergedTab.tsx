/**
 * 260517-team-page-v2 · 消息合并视图（对话 Tab 重写版）
 *
 * 把原本两个独立子 tab（消息总线 + 待回复 / @我）合并到一个子 tab 内，
 * 用 segmented control 切换：
 *   - 消息总线：所有广播 / 跟进消息流
 *   - 待回复：阻塞确认 + 通知队列（待办视图）
 *
 * 重写要点：使用 team-conv-* CSS 类名系统替代内联样式，统一视觉风格。
 */

import type { HandoffEvent } from '../../../../../stores/team/team-events.js';
import { useMemo, useState } from 'react';
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

  const scopedTeamId = selectedTeam && !isSharedSessionSelected ? selectedTeam.id : null;
  const mentionsBadgeCount = useMemo(() => {
    if (isSharedSessionSelected) {
      return (
        (sharedSession?.pendingPermissions.length ?? 0) +
        (sharedSession?.pendingQuestions.length ?? 0)
      );
    }
    if (!scopedTeamId) {
      return allEvents.filter((e) => !readEventKeys.has(getTeamNotificationEventKey(e))).length;
    }
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
      className="team-conv-root"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* 统一段切换栏 */}
      <div
        className="team-conv-panel-header"
        role="tablist"
        aria-label="消息视图切换"
        style={{ gap: 4, padding: '6px 12px' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'bus'}
          className="team-conv-filter-btn"
          data-active={segment === 'bus'}
          onClick={() => setSegment('bus')}
        >
          <span aria-hidden>✉️</span>
          <span>消息总线</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'mentions'}
          className="team-conv-filter-btn"
          data-active={segment === 'mentions'}
          onClick={() => setSegment('mentions')}
        >
          <span aria-hidden>🔔</span>
          <span>{mentionsLabel}</span>
          {mentionsBadgeCount > 0 ? (
            <span
              aria-label={`${mentionsLabel} ${mentionsBadgeCount} 条`}
              className="team-conv-stat-pill"
              data-tone="danger"
              style={{ padding: '0 5px', minWidth: 16, height: 16, gap: 0 }}
            >
              <strong style={{ fontSize: 9 }}>
                {mentionsBadgeCount > 99 ? '99+' : mentionsBadgeCount}
              </strong>
            </span>
          ) : null}
        </button>
      </div>

      {/* 内容区 */}
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
