import { color } from '../tokens.js';
import { useState, useEffect, useRef } from 'react';

export interface DevEvent {
  id: string;
  ts: number;
  type: 'tool_call' | 'tool_result' | 'text' | 'error' | 'raw';
  sessionId?: string;
  label: string;
  payload: unknown;
}

export interface DeveloperModePanelProps {
  events?: DevEvent[];
  maxEvents?: number;
  onClear?: () => void;
}

function payloadString(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return String(p);
  }
}

const TYPE_COLOR: Record<string, string> = {
  tool_call: 'var(--aux)',
  tool_result: color.success,
  text: 'var(--fg-default)',
  error: color.danger,
  raw: 'var(--aux)',
};

export function DeveloperModePanel({
  events = [],
  maxEvents = 200,
  onClear,
}: DeveloperModePanelProps) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<DevEvent | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevEventCountRef = useRef(0);

  useEffect(() => {
    if (events.length > prevEventCountRef.current) {
      prevEventCountRef.current = events.length;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [events]);

  const visible = events
    .slice(-maxEvents)
    .filter(
      (e) =>
        !filter ||
        e.label.toLowerCase().includes(filter.toLowerCase()) ||
        e.type.includes(filter.toLowerCase()),
    );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'monospace',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>开发者检查器</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤…"
          style={{
            flex: 1,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 4,
            padding: '2px 6px',
            color: 'inherit',
            fontSize: 11,
          }}
        />
        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{visible.length} 个事件</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            清空
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {visible.map((ev) => (
            <button
              type="button"
              key={ev.id}
              onClick={() => setSelected(selected?.id === ev.id ? null : ev)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '3px 10px',
                cursor: 'pointer',
                background: selected?.id === ev.id ? 'white' : 'transparent',
                border:
                  selected?.id === ev.id
                    ? '1px solid var(--border-default)'
                    : '1px solid transparent',
                boxShadow: selected?.id === ev.id ? 'var(--shadow-sm)' : 'none',
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                color: 'inherit',
                font: 'inherit',
              }}
            >
              <span style={{ color: 'var(--fg-muted)', fontSize: 10, minWidth: 60 }}>
                {new Date(ev.ts).toISOString().slice(11, 23)}
              </span>
              <span style={{ color: TYPE_COLOR[ev.type] ?? 'var(--fg-muted)', minWidth: 70 }}>
                {ev.type}
              </span>
              <span
                style={{
                  color: 'var(--fg-strong)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ev.label}
              </span>
            </button>
          ))}
          <div ref={bottomRef} />
        </div>
        {selected && (
          <div
            style={{
              width: 320,
              borderLeft: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              overflowY: 'auto',
              padding: 10,
            }}
          >
            <div
              style={{
                color: TYPE_COLOR[selected.type] ?? 'var(--fg-muted)',
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              {selected.label}
            </div>
            {selected.sessionId && (
              <div style={{ color: 'var(--fg-muted)', fontSize: 10, marginBottom: 4 }}>
                会话：{selected.sessionId}
              </div>
            )}
            <pre
              style={{
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
                color: 'var(--fg-strong)',
              }}
            >
              {payloadString(selected.payload)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
