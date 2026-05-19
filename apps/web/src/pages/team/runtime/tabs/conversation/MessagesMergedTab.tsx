/**
 * 260517-team-page-v2 · 消息合并视图
 *
 * 把原本两个独立子 tab（消息总线 + 待回复 / @我）合并到一个子 tab 内，
 * 用 segmented control 切换：
 *   - 消息总线：所有 P2P / 广播消息流（已实现回复 / 类型筛选 / 广播）
 *   - 待回复：阻塞确认 + 通知队列（待办视图）
 *
 * 待回复条数从 useTeamNotificationStore.unreadCount 取，作为 segmented 角标。
 *
 * 合并理由：两个视图都属于「对话域」的消息切片，只是数据源不同。
 * 用户在两者之间频繁切换，分开占用两个子 tab 槽位虚高了对话主 tab 的复杂度。
 */

import { useState, type CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamNotificationStore } from '../../../../../stores/team/team-events.js';
import { MessagesTab } from './MessagesTab.js';
import { MentionsView } from './MentionsView.js';

type MessagesSegment = 'bus' | 'mentions';

const SEGMENT_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 32%, transparent)',
  flexShrink: 0,
  background: 'var(--bg)',
};

const SEGMENT_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  border: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
  background: 'transparent',
  color: 'var(--text-3)',
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
  color: 'var(--text)',
};

const BADGE_STYLE: CSSProperties = {
  marginLeft: 2,
  padding: '0 5px',
  minWidth: 16,
  height: 16,
  borderRadius: 999,
  background: 'var(--danger, #d4574e)',
  color: 'var(--fg-on-accent, #ffffff)',
  fontSize: 9,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontVariantNumeric: 'tabular-nums',
};

export interface MessagesMergedTabProps {
  selectedTeam: AgentTeamsSidebarTeam | null;
}

export function MessagesMergedTab({ selectedTeam }: MessagesMergedTabProps) {
  const unreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const [segment, setSegment] = useState<MessagesSegment>('bus');

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
          <span>待回复</span>
          {unreadCount > 0 ? (
            <span aria-label={`待回复 ${unreadCount} 条`} style={BADGE_STYLE}>
              {unreadCount > 99 ? '99+' : unreadCount}
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
        {segment === 'bus' ? <MessagesTab selectedTeam={selectedTeam} /> : <MentionsView />}
      </div>
    </div>
  );
}
