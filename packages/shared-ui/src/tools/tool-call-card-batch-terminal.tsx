import { useEffect, useRef, type CSSProperties } from 'react';
import type { BatchSubToolProgress, BatchSubToolStatus } from '@openAwork/shared';
import { tokens, color as clr, color} from '../tokens.js';

export interface BatchTerminalView {
  subTools: BatchSubToolProgress[];
  completedCount: number;
  totalCount: number;
}

const STATUS_ICON: Record<BatchSubToolStatus, string> = {
  running: '⟳',
  completed: '✓',
  error: '✗',
  skipped: '⊘',
};

const STATUS_COLOR: Record<BatchSubToolStatus, string> = {
  running: clr.accent,
  completed: clr.success,
  error: clr.danger,
  skipped: clr.fgMuted,
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function SubToolRow({ entry }: { entry: BatchSubToolProgress }) {
  const icon = STATUS_ICON[entry.status] ?? '?';
  const color = STATUS_COLOR[entry.status] ?? tokens.color.muted;
  const isRunning = entry.status === 'running';
  const duration = formatDuration(entry.durationMs);

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 0',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 11,
    lineHeight: 1.6,
    minHeight: '1.6em',
  };

  const iconStyle: CSSProperties = {
    color,
    fontWeight: 700,
    width: 14,
    textAlign: 'center',
    flexShrink: 0,
    ...(isRunning
      ? {
          animation: 'batch-terminal-spin 1s linear infinite',
        }
      : {}),
  };

  return (
    <div style={rowStyle}>
      <span style={iconStyle}>{icon}</span>
      <span
        style={{
          color: tokens.color.text,
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {entry.tool}
      </span>
      {entry.isError === true && typeof entry.output === 'string' && entry.output.length > 0 && (
        <span
          style={{
            color: tokens.color.danger,
            fontSize: 10,
            maxWidth: 200,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flexShrink: 0,
          }}
          title={entry.output}
        >
          {entry.output.length > 40 ? `${entry.output.slice(0, 37)}…` : entry.output}
        </span>
      )}
      {duration && (
        <span
          style={{
            color: tokens.color.muted,
            fontSize: 10,
            flexShrink: 0,
          }}
        >
          {duration}
        </span>
      )}
    </div>
  );
}

export function BatchTerminalCard({
  view,
  compact = false,
}: {
  view: BatchTerminalView;
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { subTools, completedCount, totalCount } = view;
  const allDone = completedCount >= totalCount;
  const hasErrors = subTools.some((s) => s.status === 'error');
  const visibleTools = compact ? subTools.slice(0, 8) : subTools;
  const hiddenCount = compact ? Math.max(0, subTools.length - 8) : 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [completedCount]);

  const headerColor = allDone
    ? hasErrors
      ? tokens.color.warning
      : tokens.color.success
    : tokens.color.info;

  return (
    <div
      data-tool-card-batch-terminal="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
      }}
    >
      <style>{`
        @keyframes batch-terminal-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 6,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: `color-mix(in srgb, ${tokens.color.surface} 60%, transparent)`,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 11,
        }}
      >
        <span style={{ color: headerColor, fontWeight: 700, flexShrink: 0 }}>batch</span>
        <span style={{ color: tokens.color.muted, fontSize: 10, flex: 1 }}>
          {allDone
            ? `${completedCount}/${totalCount} 完成`
            : `${completedCount}/${totalCount} 进行中…`}
        </span>
        {allDone && hasErrors && (
          <span
            style={{
              color: tokens.color.danger,
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {subTools.filter((s) => s.status === 'error').length} 失败
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        data-tool-card-terminal-output-panel="true"
        style={{
          maxHeight: compact ? 180 : 320,
          overflow: 'auto',
          borderRadius: 6,
          border: `1px solid ${tokens.color.borderSubtle}`,
          background: `color-mix(in srgb, ${tokens.color.surface} 60%, transparent)`,
          padding: '4px 12px',
          marginTop: 2,
        }}
      >
        {visibleTools.map((entry) => (
          <SubToolRow key={`batch-sub-${entry.index}`} entry={entry} />
        ))}
        {hiddenCount > 0 && (
          <div
            style={{
              color: tokens.color.muted,
              fontSize: 10,
              padding: '2px 0',
              textAlign: 'center',
            }}
          >
            +{hiddenCount} 更多工具…
          </div>
        )}
      </div>

      {!allDone && (
        <div
          style={{
            height: 2,
            marginTop: 2,
            borderRadius: 1,
            background: `linear-gradient(90deg, ${tokens.color.info}, transparent)`,
            animation: 'batch-terminal-progress 1.5s ease-in-out infinite',
          }}
        >
          <style>{`
            @keyframes batch-terminal-progress {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
