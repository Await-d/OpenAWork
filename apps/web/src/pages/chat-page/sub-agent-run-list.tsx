import React from 'react';
import type { Session, SessionTask } from '@openAwork/web-client';

type SubAgentStatus = SessionTask['status'];
type SubAgentDisplayStatus = SubAgentStatus | 'paused';

export interface SubAgentRunItem {
  sessionId: string;
  shortSessionId: string;
  status: SubAgentDisplayStatus;
  taskLabel: string;
  title: string;
  assignedAgent?: string;
  result?: string;
  errorMessage?: string;
  terminalReason?: string;
  timeoutSource?: SessionTask['timeoutSource'];
  messageCount: number;
}

function formatTimeoutSourceLabel(timeoutSource: SessionTask['timeoutSource']): string {
  return timeoutSource === 'first_response' ? '首响应未到' : '执行超时';
}

function getStatusStyle(status: SubAgentDisplayStatus): React.CSSProperties {
  if (status === 'running') {
    return {
      background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
      border: '1px solid color-mix(in oklch, var(--accent) 42%, var(--border))',
      color: 'var(--accent)',
    };
  }

  if (status === 'paused') {
    return {
      background: 'color-mix(in srgb, #f59e0b 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, #f59e0b 30%, var(--border))',
      color: '#fcd34d',
    };
  }

  if (status === 'completed') {
    return {
      background: 'color-mix(in srgb, #34d399 12%, var(--surface))',
      border: '1px solid color-mix(in srgb, #34d399 35%, var(--border))',
      color: '#86efac',
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      background: 'color-mix(in srgb, #ef4444 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, #ef4444 30%, var(--border))',
      color: '#fca5a5',
    };
  }

  return {
    background: 'color-mix(in srgb, #f59e0b 10%, var(--surface))',
    border: '1px solid color-mix(in srgb, #f59e0b 30%, var(--border))',
    color: '#fcd34d',
  };
}

function getStatusLabel(status: SubAgentDisplayStatus): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '等待处理';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '待执行';
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function shouldShowTaskLabel(item: SubAgentRunItem): boolean {
  return item.taskLabel.trim().length > 0 && item.taskLabel.trim() !== item.title.trim();
}

function truncateSummary(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function isActiveStatus(status: SubAgentDisplayStatus): boolean {
  return status === 'running' || status === 'paused';
}

function statusSortBucket(status: SubAgentDisplayStatus): number {
  // Active (running/paused) = 0, failed/cancelled = 1, completed = 2, pending = 3
  if (status === 'running') return 0;
  if (status === 'paused') return 0;
  if (status === 'failed' || status === 'cancelled') return 1;
  if (status === 'completed') return 2;
  return 3;
}

function mapSessionStateToSubAgentStatus(
  stateStatus: Session['state_status'],
): SubAgentDisplayStatus {
  if (stateStatus === 'running') {
    return 'running';
  }

  if (stateStatus === 'paused') {
    return 'paused';
  }

  return 'pending';
}

function resolveExistingItemStatus(
  existingStatus: SubAgentDisplayStatus | undefined,
  sessionStateStatus: Session['state_status'],
): SubAgentDisplayStatus | undefined {
  if (sessionStateStatus !== 'paused') {
    return existingStatus;
  }

  if (
    existingStatus === 'completed' ||
    existingStatus === 'failed' ||
    existingStatus === 'cancelled'
  ) {
    return existingStatus;
  }

  return 'paused';
}

export function buildSubAgentRunItems(
  childSessions: Session[],
  sessionTasks: SessionTask[],
): SubAgentRunItem[] {
  const itemsBySessionId = new Map<string, SubAgentRunItem>();
  const childSessionsById = new Map(childSessions.map((session) => [session.id, session]));

  for (const task of sessionTasks) {
    if (!task.sessionId) {
      continue;
    }

    const childSession = childSessionsById.get(task.sessionId);
    const shortSessionId = task.sessionId.slice(0, 8);
    itemsBySessionId.set(task.sessionId, {
      sessionId: task.sessionId,
      shortSessionId,
      status: resolveExistingItemStatus(task.status, childSession?.state_status) ?? task.status,
      taskLabel: normalizeTitle(task.title, `子代理 ${shortSessionId}`),
      title: normalizeTitle(
        childSession?.title,
        normalizeTitle(task.title, `子代理 ${shortSessionId}`),
      ),
      assignedAgent: task.assignedAgent,
      result: task.result,
      errorMessage: task.errorMessage,
      terminalReason: task.terminalReason,
      timeoutSource: task.timeoutSource,
      messageCount: childSession?.messages?.length ?? 0,
    });
  }

  for (const session of childSessions) {
    const existing = itemsBySessionId.get(session.id);
    const shortSessionId = session.id.slice(0, 8);
    const existingStatus = resolveExistingItemStatus(existing?.status, session.state_status);
    itemsBySessionId.set(session.id, {
      sessionId: session.id,
      shortSessionId,
      status: existingStatus ?? mapSessionStateToSubAgentStatus(session.state_status),
      taskLabel: existing?.taskLabel ?? normalizeTitle(session.title, `子代理 ${shortSessionId}`),
      title: normalizeTitle(session.title, existing?.title ?? `子代理 ${shortSessionId}`),
      assignedAgent: existing?.assignedAgent,
      result: existing?.result,
      errorMessage: existing?.errorMessage,
      terminalReason: existing?.terminalReason,
      timeoutSource: existing?.timeoutSource,
      messageCount: session.messages?.length ?? existing?.messageCount ?? 0,
    });
  }

  return Array.from(itemsBySessionId.values()).sort((left, right) => {
    const byBucket = statusSortBucket(left.status) - statusSortBucket(right.status);
    if (byBucket !== 0) {
      return byBucket;
    }

    // Within same bucket: most recent (higher sessionId lexicographically) first
    return right.sessionId.localeCompare(left.sessionId);
  });
}

const activeCount = (items: SubAgentRunItem[]): number =>
  items.filter((i) => isActiveStatus(i.status)).length;

function SubAgentItemCard({
  item,
  selected,
  onSelect,
}: {
  item: SubAgentRunItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusStyle = getStatusStyle(item.status);
  const summary = item.errorMessage
    ? truncateSummary(item.errorMessage, 28)
    : item.result
      ? truncateSummary(item.result, 28)
      : undefined;
  const timeoutHint =
    item.terminalReason === 'timeout' && item.timeoutSource
      ? `超时原因：${formatTimeoutSourceLabel(item.timeoutSource)}`
      : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '6px 7px',
        borderRadius: 8,
        border: selected
          ? '1px solid color-mix(in oklch, var(--accent) 50%, var(--border-subtle))'
          : '1px solid transparent',
        background: selected
          ? 'color-mix(in oklch, var(--surface) 84%, var(--accent) 16%)'
          : 'transparent',
        color: 'var(--text)',
        boxShadow: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 140ms ease, border-color 140ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            background:
              item.status === 'running'
                ? 'var(--accent)'
                : item.status === 'completed'
                  ? '#34d399'
                  : item.status === 'failed'
                    ? '#ef4444'
                    : '#f59e0b',
            boxShadow:
              item.status === 'running'
                ? '0 0 0 2px color-mix(in oklch, var(--accent) 16%, transparent)'
                : 'none',
            animation:
              item.status === 'running' ? 'sub-agent-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: selected ? 'var(--text)' : 'var(--text-2)',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
          title={item.title}
        >
          {item.title}
        </span>
        <span
          style={{
            ...statusStyle,
            fontSize: 7.5,
            fontWeight: 700,
            padding: '0 4px',
            borderRadius: 999,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {getStatusLabel(item.status)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 12,
          fontSize: 8.5,
          color: 'var(--text-3)',
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.assignedAgent && <span>{item.assignedAgent}</span>}
        {item.messageCount > 0 && <span>{item.messageCount} 条</span>}
      </div>
      {summary && (
        <div
          style={{
            paddingLeft: 12,
            fontSize: 8,
            color: item.errorMessage ? '#fca5a5' : 'var(--text-3)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.errorMessage ?? item.result}
        >
          {summary}
        </div>
      )}
      {timeoutHint && (
        <div
          style={{
            paddingLeft: 12,
            fontSize: 8,
            color: '#fbbf24',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={timeoutHint}
        >
          {timeoutHint}
        </div>
      )}
    </button>
  );
}

export function SubAgentRunList({
  items,
  selectedSessionId,
  onSelectSession,
}: {
  items: SubAgentRunItem[];
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
}) {
  if (items.length === 0) {
    return null;
  }

  const running = activeCount(items);

  return (
    <section
      aria-label="子代理运行列表"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 200,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0 12px 8px',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        pointerEvents: 'auto',
        background: 'transparent',
      }}
    >
      <style>{`@keyframes sub-agent-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '0 7px 6px',
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: 'var(--text-2)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            子代理
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 5px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
              fontSize: 8,
              fontWeight: 700,
              color: 'var(--text-3)',
            }}
          >
            {items.length}
          </span>
          {running > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '0 5px',
                borderRadius: 999,
                border: '1px solid color-mix(in oklch, var(--accent) 36%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--accent) 14%, var(--surface))',
                fontSize: 8,
                fontWeight: 700,
                color: 'var(--accent)',
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'sub-agent-pulse 1.5s ease-in-out infinite',
                }}
              />
              {running} 活跃
            </span>
          )}
        </div>

        {items.map((item) => (
          <SubAgentItemCard
            key={item.sessionId}
            item={item}
            selected={item.sessionId === selectedSessionId}
            onSelect={() => onSelectSession(item.sessionId)}
          />
        ))}
      </div>
    </section>
  );
}
