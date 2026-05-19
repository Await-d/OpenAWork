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
import { useTeamNotificationStore, type HandoffEvent } from '../../../../../stores/team/team-events.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown-message-content.js';

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
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--text-3)',
};

const FILTER_BTN_ACTIVE_STYLE: CSSProperties = {
  ...FILTER_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--text)',
};

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
};

const BLOCKING_CARD_STYLE: CSSProperties = {
  ...CARD_STYLE,
  borderColor: 'color-mix(in srgb, var(--warning, var(--warning, #f0b429)) 50%, transparent)',
  background: 'color-mix(in srgb, var(--warning, var(--warning, #f0b429)) 8%, var(--surface))',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border) 60%, transparent)',
  color: 'var(--text-3)',
  fontSize: 13,
  gap: 6,
};

type MentionFilter = 'all' | 'unread' | 'blocking';

function isBlocking(event: HandoffEvent): boolean {
  return (
    event.type === 'waiting_confirmation' ||
    event.type === 'blocking' ||
    Boolean(event.payload['blocking'])
  );
}

function summarize(event: HandoffEvent): string {
  const summary =
    (event.payload['summary'] as string | undefined) ??
    (event.payload['message'] as string | undefined) ??
    (event.payload['detail'] as string | undefined);
  if (summary) return summary;
  return event.type.replaceAll('_', ' ');
}

export function MentionsView() {
  const events = useTeamNotificationStore((s) => s.events);
  const markAllRead = useTeamNotificationStore((s) => s.markAllRead);
  const unreadCount = useTeamNotificationStore((s) => s.unreadCount);

  const [filter, setFilter] = useState<MentionFilter>('all');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const idForEvent = (event: HandoffEvent, idx: number): string =>
    `${event.timestamp}-${event.taskId ?? event.sessionId ?? idx}`;

  const enriched = useMemo(
    () =>
      events.map((event, idx) => ({
        event,
        id: idForEvent(event, idx),
        blocking: isBlocking(event),
      })),
    [events],
  );

  const visible = useMemo(() => {
    let list = enriched;
    if (filter === 'unread') {
      list = list.filter((item) => !readIds.has(item.id));
    } else if (filter === 'blocking') {
      list = list.filter((item) => item.blocking);
    }
    // 阻塞置顶 + 时间倒序
    return list.slice().sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      return b.event.timestamp - a.event.timestamp;
    });
  }, [enriched, filter, readIds]);

  const toggleRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={EMPTY_STYLE}>
          <span style={{ fontSize: 26 }} aria-hidden>
            🔔
          </span>
          <strong style={{ color: 'var(--text-2)' }}>暂无待回复消息</strong>
          <span>团队产生阻塞确认或推送通知时，会出现在这里。</span>
        </div>
      </div>
    );
  }

  return (
    <div style={CONTAINER_STYLE}>
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
          label={`阻塞 · ${enriched.filter((e) => e.blocking).length}`}
          active={filter === 'blocking'}
          onClick={() => setFilter('blocking')}
        />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            markAllRead();
            setReadIds(new Set(enriched.map((e) => e.id)));
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
                  color: 'var(--text-3)',
                }}
              >
                {item.blocking ? (
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--warning, var(--warning, #f0b429)) 22%, transparent)',
                      color: 'var(--warning, #f0b429)',
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                    }}
                  >
                    阻塞
                  </span>
                ) : null}
                <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{item.event.type}</span>
                {item.event.layer ? <span>· {item.event.layer}</span> : null}
                <span style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(item.event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
                <MarkdownMessageContent content={summarize(item.event)} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => toggleRead(item.id)} style={FILTER_BTN_STYLE}>
                  {readIds.has(item.id) ? '标为未读' : '标为已读'}
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
