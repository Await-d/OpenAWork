import { PANEL_INSET_STYLE } from './team-runtime-settings-panel-shared.js';

export interface MemoryWriteBadgeProps {
  field: string;
  threat: string;
  reason: string;
  sample?: string;
}

export function MemoryWriteBadge({ field, threat, reason, sample }: MemoryWriteBadgeProps) {
  return (
    <div
      role="alert"
      style={{
        ...PANEL_INSET_STYLE,
        borderColor: 'color-mix(in srgb, var(--danger) 60%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
      }}
    >
      <strong style={{ fontSize: 12 }}>记忆写入被安全扫描拒绝</strong>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
        字段：<code>{field}</code> · 威胁：<code>{threat}</code>
      </span>
      <span style={{ fontSize: 12 }}>{reason}</span>
      {sample ? (
        <code style={{ fontSize: 11, color: 'var(--fg-muted)' }}>触发片段：{sample}</code>
      ) : null}
    </div>
  );
}
