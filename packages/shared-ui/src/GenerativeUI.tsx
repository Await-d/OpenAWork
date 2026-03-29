import React, { useState } from 'react';
import { ToolCallCard } from './ToolCallCard.js';
import { UnifiedCodeDiff } from './UnifiedCodeDiff.js';

export interface GenerativeUIMessage {
  type:
    | 'form'
    | 'table'
    | 'chart'
    | 'approval'
    | 'code_diff'
    | 'status'
    | 'compaction'
    | 'tool_call';
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
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text, #f1f5f9)' }}>
          {payload.title as string}
        </div>
      )}
      {fields.map((f) => (
        <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            htmlFor={`gen-${f.name}`}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted, #94a3b8)' }}
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
              background: 'var(--color-bg, #0f172a)',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 5,
              color: 'var(--color-text, #f1f5f9)',
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
          background: '#6366f1',
          border: 'none',
          borderRadius: 5,
          color: '#fff',
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
          <tr style={{ borderBottom: '1px solid var(--color-border, #334155)' }}>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  padding: '0.4rem 0.75rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--color-muted, #94a3b8)',
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
                    ri < rows.length - 1 ? '1px solid var(--color-border, #334155)' : 'none',
                }}
              >
                {cols.map((c) => (
                  <td
                    key={c}
                    style={{ padding: '0.4rem 0.75rem', color: 'var(--color-text, #f1f5f9)' }}
                  >
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
            color: 'var(--color-text, #f1f5f9)',
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
              color: 'var(--color-muted, #94a3b8)',
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
              background: 'var(--color-bg, #0f172a)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(item.value / max) * 100}%`,
                background: '#6366f1',
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span
            style={{
              width: 40,
              fontSize: 11,
              color: 'var(--color-text, #f1f5f9)',
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
      <div style={{ fontSize: 12, color: 'var(--color-text, #f1f5f9)' }}>
        {(payload.message as string) ?? '批准此操作？'}
      </div>
      {!decided ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setDecided('approved')}
            style={{
              padding: '5px 16px',
              background: '#34d399',
              border: 'none',
              borderRadius: 5,
              color: '#0f172a',
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
              background: '#f87171',
              border: 'none',
              borderRadius: 5,
              color: '#fff',
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
            color: decided === 'approved' ? '#34d399' : '#f87171',
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
    background: 'var(--color-bg, #0f172a)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: 'var(--color-text, #f1f5f9)',
    overflow: 'auto',
    maxHeight: 240,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(payload.filename as string) && (
        <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>
          {payload.filename as string}
        </div>
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
      ? '#34d399'
      : tone === 'warning'
        ? '#facc15'
        : tone === 'error'
          ? '#f87171'
          : '#60a5fa';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: toneColor }}>
        {(payload.title as string) ?? '状态更新'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text, #f1f5f9)', whiteSpace: 'pre-wrap' }}>
        {(payload.message as string) ?? ''}
      </div>
    </div>
  );
}

function UICompaction({ payload }: { payload: Record<string, unknown> }) {
  const trigger = payload['trigger'] === 'automatic' ? '自动压缩' : '手动压缩';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>
        {(payload['title'] as string) ?? '会话已压缩'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>{trigger}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text, #f1f5f9)', whiteSpace: 'pre-wrap' }}>
        {(payload['summary'] as string) ?? ''}
      </div>
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
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
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
      return (
        <div style={wrapper}>
          <UICompaction payload={message.payload} />
        </div>
      );
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
