import { useEffect, useRef } from 'react';

export type AgentVizEventType =
  | 'agent_started'
  | 'agent_thinking'
  | 'tool_call'
  | 'tool_done'
  | 'agent_done'
  | 'agent_error';

export interface AgentVizEvent {
  id: string;
  ts: number;
  type: AgentVizEventType;
  agentId: string;
  agentName?: string;
  label: string;
  durationMs?: number;
  error?: string;
}

export interface AgentVizPanelProps {
  events?: AgentVizEvent[];
  title?: string;
}

const EVENT_COLOR: Record<AgentVizEventType, string> = {
  agent_started: '#60a5fa',
  agent_thinking: '#a78bfa',
  tool_call: '#fbbf24',
  tool_done: '#34d399',
  agent_done: '#34d399',
  agent_error: '#f87171',
};

const EVENT_ICON: Record<AgentVizEventType, string> = {
  agent_started: '▶',
  agent_thinking: '…',
  tool_call: '⚙',
  tool_done: '✓',
  agent_done: '✓',
  agent_error: '✕',
};

export function AgentVizPanel({ events = [], title = 'Agent 活动' }: AgentVizPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border, #334155)',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        {title}
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: 'var(--color-muted, #64748b)',
            fontWeight: 400,
          }}
        >
          {events.length} 个事件
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {events.length === 0 && (
          <div
            style={{
              color: 'var(--color-muted, #64748b)',
              fontSize: 12,
              textAlign: 'center',
              padding: '20px 0',
            }}
          >
            暂无活动
          </div>
        )}
        {events.map((ev, idx) => {
          const color = EVENT_COLOR[ev.type];
          const icon = EVENT_ICON[ev.type];
          const isLast = idx === events.length - 1;
          return (
            <div
              key={ev.id}
              style={{ display: 'flex', gap: 0, paddingLeft: 20, position: 'relative' }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  marginRight: 10,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: color + '22',
                    border: `2px solid ${color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    color,
                    flexShrink: 0,
                    zIndex: 1,
                  }}
                >
                  {icon}
                </div>
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      background: 'var(--color-border, #334155)',
                      minHeight: 12,
                    }}
                  />
                )}
              </div>
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 10, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color }}>
                    {ev.agentName ?? ev.agentId}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted, #64748b)' }}>
                    {new Date(ev.ts).toISOString().slice(11, 19)}
                  </span>
                  {ev.durationMs !== undefined && (
                    <span style={{ fontSize: 10, color: 'var(--color-muted, #64748b)' }}>
                      {ev.durationMs}ms
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-fg, #e2e8f0)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ev.label}
                </div>
                {ev.error && (
                  <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>{ev.error}</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
