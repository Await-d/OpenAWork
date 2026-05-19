import { color } from '../tokens.js';
import React, { useState } from 'react';

export interface ScheduleTaskItem {
  id: string;
  name: string;
  kind: 'cron' | 'interval' | 'once';
  expression: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface ScheduleManagerUIProps {
  tasks: ScheduleTaskItem[];
  onToggle?: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
  onAdd?: (name: string, kind: ScheduleTaskItem['kind'], expr: string) => void;
}

function formatTime(value?: number): string {
  if (value === undefined) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

export function ScheduleManagerUI({ tasks, onToggle, onRemove, onAdd }: ScheduleManagerUIProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ScheduleTaskItem['kind']>('cron');
  const [expression, setExpression] = useState('');

  const canAdd = name.trim().length > 0 && expression.trim().length > 0;

  return (
    <div
      style={{
        background: 'var(--bg-overlay, #121721)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '0.65rem 0.875rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          color: 'var(--fg-muted, #7b8a9e)',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        计划任务 ({tasks.length})
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' }}>
              <th style={headerCell}>名称</th>
              <th style={headerCell}>类型</th>
              <th style={headerCell}>表达式</th>
              <th style={headerCell}>上次运行</th>
              <th style={headerCell}>下次运行</th>
              <th style={headerCell}>操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ ...bodyCell, textAlign: 'center', color: 'var(--fg-muted, #7b8a9e)' }}
                >
                  暂无计划任务
                </td>
              </tr>
            ) : (
              tasks.map((task, index) => (
                <tr
                  key={task.id}
                  style={{
                    borderTop: index === 0 ? 'none' : '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  }}
                >
                  <td style={bodyCell}>{task.name}</td>
                  <td style={bodyCell}>{task.kind}</td>
                  <td style={{ ...bodyCell, fontFamily: 'monospace' }}>{task.expression}</td>
                  <td style={bodyCell}>{formatTime(task.lastRunAt)}</td>
                  <td style={bodyCell}>{formatTime(task.nextRunAt)}</td>
                  <td style={bodyCell}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {onToggle && (
                        <button
                          type="button"
                          onClick={() => onToggle(task.id, !task.enabled)}
                          style={{
                            border: 'none',
                            borderRadius: 6,
                            background: task.enabled ? color.contrastMuted : color.successMuted,
                            color: task.enabled ? color.contrast : 'var(--success, #3dd49a)',
                            padding: '0.3rem 0.55rem',
                            fontSize: 11,
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          {task.enabled ? '禁用' : '启用'}
                        </button>
                      )}
                      {onRemove && (
                        <button
                          type="button"
                          onClick={() => onRemove(task.id)}
                          style={{
                            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                            borderRadius: 6,
                            background: 'transparent',
                            color: 'var(--fg-strong, #f1f4f8)',
                            padding: '0.3rem 0.55rem',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          padding: '0.75rem 0.875rem',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="任务名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={inputStyle}
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as ScheduleTaskItem['kind'])}
          style={inputStyle}
        >
          <option value="cron">cron</option>
          <option value="interval">间隔</option>
          <option value="once">单次</option>
        </select>
        <input
          type="text"
          placeholder="表达式"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          style={{ ...inputStyle, flex: '1 1 260px' }}
        />
        <button
          type="button"
          onClick={() => {
            if (!onAdd || !canAdd) {
              return;
            }
            onAdd(name.trim(), kind, expression.trim());
            setName('');
            setExpression('');
          }}
          disabled={!onAdd || !canAdd}
          style={{
            border: 'none',
            borderRadius: 6,
            background: !onAdd || !canAdd ? 'var(--border-default, hsla(215, 18%, 50%, 0.12))' : '#4338ca',
            color: !onAdd || !canAdd ? 'var(--fg-muted, #7b8a9e)' : 'var(--fg-default, #c8d1e0)',
            padding: '0.45rem 0.85rem',
            fontSize: 12,
            fontWeight: 600,
            cursor: !onAdd || !canAdd ? 'not-allowed' : 'pointer',
          }}
        >
          添加任务
        </button>
      </div>
    </div>
  );
}

const headerCell: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  color: 'var(--fg-muted, #7b8a9e)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '0.5rem 0.65rem',
};

const bodyCell: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-strong, #f1f4f8)',
  padding: '0.55rem 0.65rem',
  verticalAlign: 'top',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  background: 'var(--bg-base, #080b12)',
  color: 'var(--fg-strong, #f1f4f8)',
  padding: '0.4rem 0.55rem',
  fontSize: 12,
  minWidth: 120,
};
