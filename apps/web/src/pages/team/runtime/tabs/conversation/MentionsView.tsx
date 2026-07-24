/**
 * 260516-team-page-v2 · T-13 · MentionsView（对话 Tab 重写版）
 *
 * 「待回复 / @ 我的」tab 内容：
 *   - 阻塞确认（waiting_confirmation）置顶
 *   - 其他通知按时间倒序
 *   - 已读 / 未读切换
 *
 * 重写要点：使用 team-conv-* CSS 类名系统替代大量内联样式，统一卡片和过滤栏视觉。
 */

import { useMemo, useState } from 'react';
import {
  getTeamNotificationEventKey,
  useClarificationStore,
  useTeamNotificationStore,
  type HandoffEvent,
} from '../../../../../stores/team/team-events.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';
import {
  resolveTeamRuntimeTabFromBlockingReason,
  type TeamRuntimeHandoffContextTab,
} from '../team-runtime-navigation.js';
import {
  formatTeamEventSummary,
  teamEventLayerLabel,
  teamEventTypeLabel,
} from '../../data/team-event-labels.js';

type MentionFilter = 'all' | 'unread' | 'blocking';

function isBlocking(event: HandoffEvent): boolean {
  return (
    event.type === 'waiting_confirmation' ||
    event.type === 'blocking' ||
    Boolean(event.payload['blocking'])
  );
}

function summarize(event: HandoffEvent): string {
  return formatTeamEventSummary(event);
}

export interface MentionsViewProps {
  onOpenBlockingTarget?: (event: HandoffEvent) => void;
  onOpenClarifications?: () => void;
  selectedTeamId?: string | null;
}

function getBlockingActionLabel(event: HandoffEvent): string | null {
  const reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : null;
  const targetTab = resolveTeamRuntimeTabFromBlockingReason(reason);
  if (isBlocking(event)) {
    return describeBlockingActionLabel(targetTab);
  }
  return null;
}

function describeBlockingActionLabel(targetTab: TeamRuntimeHandoffContextTab): string | null {
  if (targetTab === 'review') return '前往评审';
  if (targetTab === 'artifacts') return '前往任务与产物';
  return '前往健康度';
}

export function MentionsView({
  onOpenBlockingTarget,
  onOpenClarifications,
  selectedTeamId,
}: MentionsViewProps) {
  const events = useTeamNotificationStore((s) => s.events);
  const markAllRead = useTeamNotificationStore((s) => s.markAllRead);
  const markEventRead = useTeamNotificationStore((s) => s.markEventRead);
  const markEventUnread = useTeamNotificationStore((s) => s.markEventUnread);
  const readEventKeys = useTeamNotificationStore((s) => s.readEventKeys);
  const unreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const clarificationPending = useClarificationStore((s) => s.pendingCount);

  const [filter, setFilter] = useState<MentionFilter>('all');

  const scopedEvents = useMemo(() => {
    if (!selectedTeamId) return events;
    return events.filter((event) => {
      const eventSessionId = event.sessionId;
      if (!eventSessionId) return true;
      return (
        eventSessionId === selectedTeamId ||
        (typeof event.payload['fromSessionId'] === 'string' &&
          event.payload['fromSessionId'] === selectedTeamId)
      );
    });
  }, [events, selectedTeamId]);

  const enriched = useMemo(
    () =>
      scopedEvents.map((event) => ({
        event,
        id: getTeamNotificationEventKey(event),
        blocking: isBlocking(event),
      })),
    [scopedEvents],
  );

  const visible = useMemo(() => {
    let list = enriched;
    if (filter === 'unread') {
      list = list.filter((item) => !readEventKeys.has(item.id));
    } else if (filter === 'blocking') {
      list = list.filter((item) => item.blocking);
    }
    return list.slice().sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      return b.event.timestamp - a.event.timestamp;
    });
  }, [enriched, filter, readEventKeys]);

  const blockingCount = useMemo(() => enriched.filter((item) => item.blocking).length, [enriched]);
  const primaryBlockingTarget = useMemo(
    () =>
      visible.find((item) => item.blocking && getBlockingActionLabel(item.event) !== null)?.event ??
      null,
    [visible],
  );

  if (scopedEvents.length === 0) {
    return (
      <div className="team-conv-empty">
        <span className="team-conv-empty__icon" aria-hidden>🔔</span>
        <strong className="team-conv-empty__title">暂无待回复消息</strong>
        <span className="team-conv-empty__description">
          团队产生阻塞确认或推送通知时，会出现在这里。
        </span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 摘要卡片 */}
      {blockingCount > 0 || clarificationPending > 0 ? (
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {blockingCount > 0 ? (
            <div className="team-conv-panel" style={{ padding: '10px 12px', display: 'grid', gap: 4, borderColor: 'color-mix(in srgb, var(--danger, var(--complement)) 40%, transparent)' }}>
              <strong style={{ color: 'var(--danger, var(--complement))', fontSize: 13 }}>
                需要优先处理的阻塞
              </strong>
              <span style={{ color: 'var(--fg-strong)', fontSize: 13, fontWeight: 700 }}>
                当前有 {blockingCount} 条升级/阻塞通知
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                优先查看本页阻塞卡片，确认是否需要你修改需求、补约束，或直接介入当前流程。
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setFilter('blocking')}
                  className="team-conv-filter-btn"
                  data-active={filter === 'blocking'}
                >
                  仅看阻塞
                </button>
                {primaryBlockingTarget && onOpenBlockingTarget ? (
                  <button
                    type="button"
                    onClick={() => onOpenBlockingTarget(primaryBlockingTarget)}
                    className="team-conv-filter-btn"
                  >
                    {getBlockingActionLabel(primaryBlockingTarget) ?? '前往处理'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {clarificationPending > 0 ? (
            <div className="team-conv-panel" style={{ padding: '10px 12px', display: 'grid', gap: 4, borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}>
              <strong style={{ color: 'var(--warning)', fontSize: 13 }}>待回答的澄清问题</strong>
              <span style={{ color: 'var(--fg-strong)', fontSize: 13, fontWeight: 700 }}>
                当前有 {clarificationPending} 条 NEEDS CLARIFICATION
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                去「任务」主 tab 查看澄清面板并回答问题，PM1 才能继续推进 plan / tasks 生成。
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenClarifications?.();
                }}
                className="team-conv-filter-btn"
              >
                前往任务流
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 过滤栏 */}
      <div className="team-conv-filter-bar">
        <button
          type="button"
          className="team-conv-filter-btn"
          data-active={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          全部 · {enriched.length}
        </button>
        <button
          type="button"
          className="team-conv-filter-btn"
          data-active={filter === 'unread'}
          onClick={() => setFilter('unread')}
        >
          未读 · {unreadCount}
        </button>
        <button
          type="button"
          className="team-conv-filter-btn"
          data-active={filter === 'blocking'}
          onClick={() => setFilter('blocking')}
        >
          阻塞 · {blockingCount}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            markAllRead();
          }}
          className="team-conv-filter-btn"
        >
          全部标为已读
        </button>
      </div>

      {/* 消息卡片列表 */}
      <div style={{ display: 'grid', gap: 8 }}>
        {visible.length === 0 ? (
          <div className="team-conv-empty" style={{ padding: '24px 16px' }}>
            <span className="team-conv-empty__description">当前过滤条件下无消息。</span>
          </div>
        ) : (
          visible.map((item) => (
            <div
              key={item.id}
              className="team-conv-message-card"
              data-blocking={item.blocking ? 'true' : undefined}
            >
              <div className="team-conv-message-card__header">
                {item.blocking ? (
                  <span
                    className="team-conv-badge"
                    style={{
                      background: 'color-mix(in srgb, var(--warning) 22%, transparent)',
                      color: 'var(--warning)',
                      borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)',
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                    }}
                  >
                    阻塞
                  </span>
                ) : null}
                <span style={{ fontWeight: 700, color: 'var(--fg-default)', fontSize: 11 }}>
                  {teamEventTypeLabel(item.event.type)}
                </span>
                {item.event.layer ? (
                  <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                    · {teamEventLayerLabel(item.event.layer)}
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                <span
                  style={{
                    color: 'var(--fg-muted)',
                    fontSize: 10,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {new Date(item.event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="team-conv-message-card__body" style={{ fontSize: 13 }}>
                <MarkdownMessageContent content={summarize(item.event)} />
              </div>
              <div className="team-conv-message-card__footer">
                {item.blocking && onOpenBlockingTarget && getBlockingActionLabel(item.event) ? (
                  <button
                    type="button"
                    onClick={() => onOpenBlockingTarget(item.event)}
                    className="team-conv-filter-btn"
                  >
                    {getBlockingActionLabel(item.event)}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (readEventKeys.has(item.id)) {
                      markEventUnread(item.id);
                    } else {
                      markEventRead(item.id);
                    }
                  }}
                  className="team-conv-filter-btn"
                >
                  {readEventKeys.has(item.id) ? '标为未读' : '标为已读'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
