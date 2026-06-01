/**
 * 260516-team-page-v2 · T-13 · MentionsView
 *
 * 「待回复 / @ 我的」tab 内容：
 *   - 阻塞确认（waiting_confirmation）置顶
 *   - 其他通知按时间倒序
 *   - 已读 / 未读切换
 *
 * 数据来源：useTeamNotificationStore.events
 */

import { useMemo, useState, type CSSProperties } from 'react';
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

const CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const FILTER_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const FILTER_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--fg-muted)',
};

const FILTER_BTN_ACTIVE_STYLE: CSSProperties = {
  ...FILTER_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
};

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const BLOCKING_CARD_STYLE: CSSProperties = {
  ...CARD_STYLE,
  borderColor: 'color-mix(in srgb, var(--warning) 50%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay))',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 13,
  gap: 6,
};

const SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const SUMMARY_CARD_BLOCKING_STYLE: CSSProperties = {
  ...SUMMARY_CARD_STYLE,
  borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
  background: 'color-mix(in srgb, var(--danger) 7%, var(--bg-overlay))',
};

const SUMMARY_CARD_WARNING_STYLE: CSSProperties = {
  ...SUMMARY_CARD_STYLE,
  borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 7%, var(--bg-overlay))',
};

type MentionFilter = 'all' | 'unread' | 'blocking';

const SUMMARY_ACTION_STYLE: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-base)',
  color: 'var(--fg-strong)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  justifySelf: 'start',
};

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
  if (targetTab === 'review') {
    return '前往评审';
  }
  if (targetTab === 'artifacts') {
    return '前往任务与产物';
  }
  return '前往健康度';
}

export function MentionsView({ onOpenBlockingTarget, onOpenClarifications }: MentionsViewProps) {
  const events = useTeamNotificationStore((s) => s.events);
  const markAllRead = useTeamNotificationStore((s) => s.markAllRead);
  const markEventRead = useTeamNotificationStore((s) => s.markEventRead);
  const markEventUnread = useTeamNotificationStore((s) => s.markEventUnread);
  const readEventKeys = useTeamNotificationStore((s) => s.readEventKeys);
  const unreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const clarificationPending = useClarificationStore((s) => s.pendingCount);

  const [filter, setFilter] = useState<MentionFilter>('all');

  const enriched = useMemo(
    () =>
      events.map((event) => ({
        event,
        id: getTeamNotificationEventKey(event),
        blocking: isBlocking(event),
      })),
    [events],
  );

  const visible = useMemo(() => {
    let list = enriched;
    if (filter === 'unread') {
      list = list.filter((item) => !readEventKeys.has(item.id));
    } else if (filter === 'blocking') {
      list = list.filter((item) => item.blocking);
    }
    // 阻塞置顶 + 时间倒序
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

  if (events.length === 0) {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={EMPTY_STYLE}>
          <span style={{ fontSize: 26 }} aria-hidden>
            🔔
          </span>
          <strong style={{ color: 'var(--fg-default)' }}>暂无待回复消息</strong>
          <span>团队产生阻塞确认或推送通知时，会出现在这里。</span>
        </div>
      </div>
    );
  }

  return (
    <div style={CONTAINER_STYLE}>
      {blockingCount > 0 || clarificationPending > 0 ? (
        <div style={SUMMARY_GRID_STYLE}>
          {blockingCount > 0 ? (
            <div style={SUMMARY_CARD_BLOCKING_STYLE}>
              <strong style={{ color: 'var(--danger)', fontSize: 13 }}>需要优先处理的阻塞</strong>
              <span style={{ color: 'var(--fg-strong)', fontSize: 13, fontWeight: 700 }}>
                当前有 {blockingCount} 条升级/阻塞通知
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                优先查看本页阻塞卡片，确认是否需要你修改需求、补约束，或直接介入当前流程。
              </span>
              <button
                type="button"
                onClick={() => setFilter('blocking')}
                style={SUMMARY_ACTION_STYLE}
              >
                仅看阻塞
              </button>
              {primaryBlockingTarget && onOpenBlockingTarget ? (
                <button
                  type="button"
                  onClick={() => onOpenBlockingTarget(primaryBlockingTarget)}
                  style={SUMMARY_ACTION_STYLE}
                >
                  {getBlockingActionLabel(primaryBlockingTarget) ?? '前往处理'}
                </button>
              ) : null}
            </div>
          ) : null}
          {clarificationPending > 0 ? (
            <div style={SUMMARY_CARD_WARNING_STYLE}>
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
                style={SUMMARY_ACTION_STYLE}
              >
                前往任务流
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={FILTER_BAR_STYLE}>
        <FilterBtn
          label={`全部 · ${enriched.length}`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterBtn
          label={`未读 · ${unreadCount}`}
          active={filter === 'unread'}
          onClick={() => setFilter('unread')}
        />
        <FilterBtn
          label={`阻塞 · ${blockingCount}`}
          active={filter === 'blocking'}
          onClick={() => setFilter('blocking')}
        />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            markAllRead();
          }}
          style={FILTER_BTN_STYLE}
        >
          全部标为已读
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {visible.length === 0 ? (
          <div style={EMPTY_STYLE}>
            <span>当前过滤条件下无消息。</span>
          </div>
        ) : (
          visible.map((item) => (
            <div key={item.id} style={item.blocking ? BLOCKING_CARD_STYLE : CARD_STYLE}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                }}
              >
                {item.blocking ? (
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--warning) 22%, transparent)',
                      color: 'var(--warning)',
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                    }}
                  >
                    阻塞
                  </span>
                ) : null}
                <span style={{ fontWeight: 700, color: 'var(--fg-default)' }}>
                  {teamEventTypeLabel(item.event.type)}
                </span>
                {item.event.layer ? <span>· {teamEventLayerLabel(item.event.layer)}</span> : null}
                <span style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(item.event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-strong)', lineHeight: 1.55 }}>
                <MarkdownMessageContent content={summarize(item.event)} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {item.blocking && onOpenBlockingTarget && getBlockingActionLabel(item.event) ? (
                  <button
                    type="button"
                    onClick={() => onOpenBlockingTarget(item.event)}
                    style={FILTER_BTN_STYLE}
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
                  style={FILTER_BTN_STYLE}
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

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? FILTER_BTN_ACTIVE_STYLE : FILTER_BTN_STYLE}
    >
      {label}
    </button>
  );
}
