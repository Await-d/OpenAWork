import { color } from '../tokens.js';
import React, { useState } from 'react';
import { ToolCallCard } from '../tools/ToolCallCard.js';
import { UnifiedCodeDiff } from '../tools/UnifiedCodeDiff.js';

export interface GenerativeUIMessage {
  type:
    'form' | 'table' | 'chart' | 'approval' | 'code_diff' | 'status' | 'compaction' | 'tool_call';
  payload: Record<string, unknown>;
}

export interface GenerativeUIRendererProps {
  message: GenerativeUIMessage;
}

function UIForm({ payload }: { payload: Record<string, unknown> }) {
  const fields = (payload.fields as Array<{ name: string; label: string; type?: string }>) ?? [];
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(payload.title as string) && (
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {payload.title as string}
        </div>
      )}
      {fields.map((f) => (
        <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            htmlFor={`gen-${f.name}`}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)' }}
          >
            {f.label}
          </label>
          <input
            id={`gen-${f.name}`}
            type={f.type ?? 'text'}
            value={vals[f.name] ?? ''}
            onChange={(e) => setVals((p) => ({ ...p, [f.name]: e.target.value }))}
            style={{
              padding: '0.35rem 0.6rem',
              background: 'var(--bg-base)',
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              borderRadius: 5,
              color: 'var(--fg-strong)',
              fontSize: 12,
            }}
          />
        </div>
      ))}
      <button
        type="button"
        style={{
          alignSelf: 'flex-start',
          padding: '5px 16px',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 5,
          color: color.fgOnAccent,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        提交
      </button>
    </div>
  );
}

function UITable({ payload }: { payload: Record<string, unknown> }) {
  const cols = (payload.columns as string[]) ?? [];
  const rows = (payload.rows as Array<Record<string, string | number | boolean | null>>) ?? [];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr
            style={{ borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' }}
          >
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  padding: '0.4rem 0.75rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const rowKey = Object.values(row).slice(0, 2).join('-') || String(ri);
            return (
              <tr
                key={rowKey}
                style={{
                  borderBottom:
                    ri < rows.length - 1
                      ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                      : 'none',
                }}
              >
                {cols.map((c) => (
                  <td key={c} style={{ padding: '0.4rem 0.75rem', color: 'var(--fg-strong)' }}>
                    {row[c] !== null && row[c] !== undefined
                      ? typeof row[c] === 'object'
                        ? JSON.stringify(row[c])
                        : String(row[c])
                      : ''}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UIChart({ payload }: { payload: Record<string, unknown> }) {
  const items = (payload.data as Array<{ label: string; value: number }>) ?? [];
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {(payload.title as string) && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--fg-strong)',
            marginBottom: 4,
          }}
        >
          {payload.title as string}
        </div>
      )}
      {items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 80,
              fontSize: 11,
              color: 'var(--fg-muted)',
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {item.label}
          </span>
          <div
            style={{
              flex: 1,
              height: 18,
              background: 'var(--bg-base)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(item.value / max) * 100}%`,
                background: 'var(--accent)',
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span
            style={{
              width: 40,
              fontSize: 11,
              color: 'var(--fg-strong)',
              textAlign: 'right',
            }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function UIApproval({ payload }: { payload: Record<string, unknown> }) {
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
        {(payload.message as string) ?? '批准此操作？'}
      </div>
      {!decided ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setDecided('approved')}
            style={{
              padding: '5px 16px',
              background: color.success,
              border: 'none',
              borderRadius: 5,
              color: 'var(--bg-base)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            批准
          </button>
          <button
            type="button"
            onClick={() => setDecided('rejected')}
            style={{
              padding: '5px 16px',
              background: color.danger,
              border: 'none',
              borderRadius: 5,
              color: color.fgOnAccent,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            拒绝
          </button>
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: decided === 'approved' ? color.success : color.danger,
          }}
        >
          {decided === 'approved' ? '已批准' : '已拒绝'}
        </div>
      )}
    </div>
  );
}

function UICodeDiff({ payload }: { payload: Record<string, unknown> }) {
  const diff = typeof payload.diff === 'string' ? payload.diff : '';
  const filename = typeof payload.filename === 'string' ? payload.filename : undefined;
  if (diff.trim().length > 0) {
    return <UnifiedCodeDiff diffText={diff} filePath={filename} maxHeight={320} />;
  }

  const before = (payload.before as string) ?? '';
  const after = (payload.after as string) ?? '';
  const cell: React.CSSProperties = {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '0.5rem',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: 'var(--fg-strong)',
    overflow: 'auto',
    maxHeight: 240,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(payload.filename as string) && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{payload.filename as string}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={cell}>{before}</div>
        <div style={{ ...cell, background: 'rgba(52,211,153,0.07)' }}>{after}</div>
      </div>
    </div>
  );
}

function UIStatus({ payload }: { payload: Record<string, unknown> }) {
  const tone = (payload.tone as string) ?? 'info';
  const toneColor =
    tone === 'success'
      ? color.success
      : tone === 'warning'
        ? color.contrast
        : tone === 'error'
          ? color.danger
          : 'var(--aux)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: toneColor }}>
        {(payload.title as string) ?? '状态更新'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-strong)', whiteSpace: 'pre-wrap' }}>
        {(payload.message as string) ?? ''}
      </div>
    </div>
  );
}

function UICompaction({ payload }: { payload: Record<string, unknown> }) {
  const phase =
    payload['phase'] === 'started' || payload['phase'] === 'completed' || payload['phase'] === 'failed'
      ? payload['phase']
      : 'completed';
  const trigger =
    phase === 'started'
      ? payload['trigger'] === 'automatic'
        ? '正在自动压缩上下文'
        : '正在压缩上下文'
      : phase === 'failed'
        ? payload['trigger'] === 'automatic'
          ? '自动压缩未完成'
          : '压缩未完成'
        : payload['trigger'] === 'automatic'
          ? '已自动压缩上下文'
          : '已压缩上下文';
  const toneColor =
    phase === 'failed'
      ? 'var(--danger)'
      : phase === 'started'
        ? 'var(--warning)'
        : 'var(--fg-subtle)';
  const bgColor =
    phase === 'failed'
      ? 'var(--danger-muted)'
      : phase === 'started'
        ? 'var(--warning-muted)'
        : 'var(--accent-muted)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minWidth: 0,
        maxWidth: '100%',
        color: toneColor,
        fontSize: 11,
        lineHeight: 1.4,
        backgroundColor: bgColor,
        padding: '6px 12px',
        borderRadius: 6,
        border: `1px solid ${phase === 'failed' ? 'var(--danger-border)' : phase === 'started' ? 'var(--warning-border)' : 'var(--accent-border)'}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: phase === 'failed' ? 'var(--danger)' : phase === 'started' ? 'var(--warning)' : 'var(--aux)', fontSize: 10 }}
      >
        •
      </span>
      <span>{trigger}</span>
    </div>
  );
}

function UIToolCall({ payload }: { payload: Record<string, unknown> }) {
  const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool';
  const kind =
    payload['kind'] === 'agent' ||
    payload['kind'] === 'mcp' ||
    payload['kind'] === 'skill' ||
    payload['kind'] === 'tool'
      ? payload['kind']
      : undefined;
  const input =
    payload['input'] && typeof payload['input'] === 'object' && !Array.isArray(payload['input'])
      ? (payload['input'] as Record<string, unknown>)
      : {};
  const status =
    payload['status'] === 'running' ||
    payload['status'] === 'completed' ||
    payload['status'] === 'failed'
      ? payload['status']
      : undefined;

  return (
    <ToolCallCard
      kind={kind}
      toolName={toolName}
      input={input}
      output={payload['output']}
      isError={payload['isError'] === true}
      status={status}
      style={{ maxWidth: '100%' }}
    />
  );
}

export function GenerativeUIRenderer({ message }: GenerativeUIRendererProps) {
  const wrapper: React.CSSProperties = {
    background: 'var(--bg-overlay)',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 10,
    padding: '1rem',
  };
  switch (message.type) {
    case 'form':
      return (
        <div style={wrapper}>
          <UIForm payload={message.payload} />
        </div>
      );
    case 'table':
      return (
        <div style={wrapper}>
          <UITable payload={message.payload} />
        </div>
      );
    case 'chart':
      return (
        <div style={wrapper}>
          <UIChart payload={message.payload} />
        </div>
      );
    case 'approval':
      return (
        <div style={wrapper}>
          <UIApproval payload={message.payload} />
        </div>
      );
    case 'code_diff':
      return (
        <div style={wrapper}>
          <UICodeDiff payload={message.payload} />
        </div>
      );
    case 'status':
      return (
        <div style={wrapper}>
          <UIStatus payload={message.payload} />
        </div>
      );
    case 'compaction':
      return <UICompaction payload={message.payload} />;
    case 'tool_call':
      return (
        <div style={wrapper}>
          <UIToolCall payload={message.payload} />
        </div>
      );
    default:
      return null;
  }
}
