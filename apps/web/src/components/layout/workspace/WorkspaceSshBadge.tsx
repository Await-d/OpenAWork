import type { CSSProperties } from 'react';
import type { SshConnectionLabelMap } from '../../../hooks/workspace/useSshConnectionLabels.js';

export interface WorkspaceSshBadgeProps {
  /** 会话组 / 会话绑定的 SSH 连接 id；为空表示本地工作区，不渲染标识。 */
  connectionId: string | null;
  connections: SshConnectionLabelMap;
  /** 是否展示连接名。窄侧栏只展示 `SSH`，宽列表可追加连接名。 */
  showConnectionName?: boolean;
}

/** 连接状态 → 状态点颜色。语义沿用全局 token，不引入硬编码色值。 */
const STATUS_COLOR: Record<string, string> = {
  connected: 'var(--success)',
  connecting: 'var(--warning)',
  error: 'var(--danger)',
  disconnected: 'var(--fg-muted)',
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  maxWidth: 160,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid color-mix(in oklch, var(--aux) 30%, transparent)',
  background: 'color-mix(in oklch, var(--aux) 12%, transparent)',
  color: 'var(--aux)',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: '16px',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

const LABEL_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

/**
 * SSH 远程工作区标识。
 *
 * 会话列表里远端目录与同名本地目录仅靠路径无法区分，用一枚 `SSH` 徽标
 * 显式标注来源；连接名取自 SSH 连接列表，未加载到时退化为纯 `SSH`，
 * 保证「是否远端」这一信息在任何情况下都可辨识。
 */
export function WorkspaceSshBadge({
  connectionId,
  connections,
  showConnectionName = false,
}: WorkspaceSshBadgeProps) {
  if (!connectionId) {
    return null;
  }

  const connection = connections.get(connectionId);
  const statusColor = connection ? (STATUS_COLOR[connection.status] ?? 'var(--fg-muted)') : null;
  const label = connection?.label ?? '';
  const title = connection
    ? `SSH 远程工作区 · ${connection.label}（${connection.endpoint}）`
    : 'SSH 远程工作区';

  return (
    <span style={BADGE_STYLE} title={title} data-ssh-connection-id={connectionId}>
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
      <span style={LABEL_STYLE}>{showConnectionName && label ? `SSH · ${label}` : 'SSH'}</span>
      {statusColor && (
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
          }}
        />
      )}
    </span>
  );
}
