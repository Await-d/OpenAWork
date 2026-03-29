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
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '0.65rem 0.875rem',
          borderBottom: '1px solid var(--color-border, #334155)',
          color: 'var(--color-muted, #94a3b8)',
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
            <tr style={{ borderBottom: '1px solid var(--color-border, #334155)' }}>
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
                  style={{ ...bodyCell, textAlign: 'center', color: 'var(--color-muted, #94a3b8)' }}
                >
                  暂无计划任务
                </td>
              </tr>
            ) : (
              tasks.map((task, index) => (
                <tr
                  key={task.id}
                  style={{
                    borderTop: index === 0 ? 'none' : '1px solid var(--color-border, #334155)',
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
                            background: task.enabled ? '#78350f' : '#14532d',
                            color: task.enabled ? '#fde68a' : '#86efac',
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
                            border: '1px solid var(--color-border, #334155)',
                            borderRadius: 6,
                            background: 'transparent',
                            color: 'var(--color-text, #f1f5f9)',
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
          borderTop: '1px solid var(--color-border, #334155)',
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
            background: !onAdd || !canAdd ? '#334155' : '#4338ca',
            color: !onAdd || !canAdd ? '#94a3b8' : '#e2e8f0',
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
  color: 'var(--color-muted, #94a3b8)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '0.5rem 0.65rem',
};

const bodyCell: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text, #f1f5f9)',
  padding: '0.55rem 0.65rem',
  verticalAlign: 'top',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border, #334155)',
  borderRadius: 6,
  background: '#0f172a',
  color: 'var(--color-text, #f1f5f9)',
  padding: '0.4rem 0.55rem',
  fontSize: 12,
  minWidth: 120,
};
