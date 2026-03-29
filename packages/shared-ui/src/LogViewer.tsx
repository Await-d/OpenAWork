import type { CSSProperties } from 'react';
import { useState, useEffect, useRef } from 'react';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  source?: string;
}

export interface LogViewerProps {
  logs: LogEntry[];
  onExport: () => void;
  style?: CSSProperties;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#94a3b8',
  info: '#38bdf8',
  warn: '#facc15',
  error: '#f87171',
};

const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function formatTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

export function LogViewer({ logs, onExport, style }: LogViewerProps) {
  const [activeLevel, setActiveLevel] = useState<LogLevel | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = activeLevel ? logs.filter((l) => l.level === activeLevel) : logs;

  const prevCountRef = useRef(0);
  useEffect(() => {
    if (logs.length !== prevCountRef.current) {
      prevCountRef.current = logs.length;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [logs]);

  const btnBase: CSSProperties = {
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 5,
    padding: '0.2rem 0.55rem',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0.6rem 1rem',
          borderBottom: '1px solid var(--color-border, #334155)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text, #e2e8f0)',
            marginRight: 4,
          }}
        >
          日志
        </span>
        <button
          type="button"
          onClick={() => setActiveLevel(null)}
          style={{
            ...btnBase,
            background: activeLevel === null ? '#334155' : 'transparent',
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          全部
        </button>
        {ALL_LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setActiveLevel(activeLevel === lvl ? null : lvl)}
            style={{
              ...btnBase,
              background: activeLevel === lvl ? `${LEVEL_COLORS[lvl]}22` : 'transparent',
              color: LEVEL_COLORS[lvl],
              borderColor:
                activeLevel === lvl ? `${LEVEL_COLORS[lvl]}55` : 'var(--color-border, #334155)',
            }}
          >
            {lvl}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onExport}
          style={{
            ...btnBase,
            background: 'transparent',
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          导出
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          maxHeight: 360,
          padding: '0.4rem 0',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--color-muted, #94a3b8)',
            }}
          >
            暂无日志条目。
          </div>
        ) : (
          filtered.map((entry, idx) => (
            <div
              key={`${entry.timestamp}-${entry.level}-${idx}`}
              style={{
                display: 'flex',
                gap: 10,
                padding: '0.25rem 1rem',
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: 'var(--color-muted, #94a3b8)',
                  flexShrink: 0,
                  minWidth: 88,
                }}
              >
                {formatTime(entry.timestamp)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: LEVEL_COLORS[entry.level],
                  flexShrink: 0,
                  width: 38,
                  textTransform: 'uppercase',
                }}
              >
                {entry.level}
              </span>
              {entry.source && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted, #94a3b8)',
                    fontFamily: 'monospace',
                    flexShrink: 0,
                  }}
                >
                  [{entry.source}]
                </span>
              )}
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--color-text, #e2e8f0)',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
