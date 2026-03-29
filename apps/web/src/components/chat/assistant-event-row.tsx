import type { AssistantEventPayload } from '../../pages/chat-page/support.js';

export function AssistantEventRow({ payload }: { payload: AssistantEventPayload }) {
  const kindLabel =
    payload.kind === 'mcp'
      ? 'MCP'
      : payload.kind === 'skill'
        ? 'SKILL'
        : payload.kind === 'agent'
          ? 'AGENT'
          : payload.kind === 'permission'
            ? 'PERMIT'
            : payload.kind === 'task'
              ? 'TASK'
              : payload.kind === 'compaction'
                ? 'COMPACT'
                : payload.kind === 'audit'
                  ? 'AUDIT'
                  : 'TOOL';
  const statusLabel =
    payload.status === 'running'
      ? '运行中'
      : payload.status === 'success'
        ? '成功'
        : payload.status === 'paused'
          ? '暂停'
          : '错误';
  const statusColor =
    payload.status === 'running'
      ? '#93c5fd'
      : payload.status === 'success'
        ? '#86efac'
        : payload.status === 'paused'
          ? '#fcd34d'
          : '#fca5a5';
  const statusBackground =
    payload.status === 'running'
      ? 'rgba(59, 130, 246, 0.16)'
      : payload.status === 'success'
        ? 'rgba(16, 185, 129, 0.16)'
        : payload.status === 'paused'
          ? 'rgba(245, 158, 11, 0.16)'
          : 'rgba(239, 68, 68, 0.16)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: 'color-mix(in oklab, var(--surface) 84%, var(--bg-2) 16%)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text)',
        }}
      >
        <AssistantEventKindIcon kind={payload.kind} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {payload.title}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: 'var(--text-3)',
            }}
          >
            {kindLabel}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 999,
              background: statusBackground,
              color: statusColor,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            {statusLabel}
          </span>
        </div>
        {payload.message.length > 0 && (
          <div
            style={{
              color: 'var(--text-2)',
              fontSize: 12,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {payload.message}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantEventKindIcon({ kind }: { kind: AssistantEventPayload['kind'] }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'mcp') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M8 8h8v8H8z" />
        <path d="M4 12h4" />
        <path d="M16 12h4" />
        <path d="M12 4v4" />
        <path d="M12 16v4" />
      </svg>
    );
  }

  if (kind === 'skill') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />
      </svg>
    );
  }

  if (kind === 'agent') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 11h.01" />
        <path d="M14 11h.01" />
        <path d="M9 15h6" />
        <path d="M12 3v4" />
      </svg>
    );
  }

  if (kind === 'permission') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 3 6 6v5c0 4 2.6 7.4 6 8 3.4-.6 6-4 6-8V6Z" />
        <path d="M10 11.5 11.5 13 14.5 10" />
      </svg>
    );
  }

  if (kind === 'task') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="6" y="5" width="12" height="14" rx="2" />
        <path d="M9 9h6" />
        <path d="M9 13h4" />
      </svg>
    );
  }

  if (kind === 'compaction') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M6 7h12" />
        <path d="M8 11h8" />
        <path d="M10 15h4" />
      </svg>
    );
  }

  if (kind === 'audit') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden="true">
      <path d="m14 7 3 3" />
      <path d="m5 19 4.5-1 8-8a2.12 2.12 0 0 0-3-3l-8 8Z" />
      <path d="m9 9 6 6" />
    </svg>
  );
}
