import type { CSSProperties, ReactElement } from 'react';
import { BS_GHOST } from '../shared/settings-section-styles.js';
import {
  useDisplayPreferencesSyncStore,
  type DisplayPreferencesSyncStatus,
} from '../../../stores/settings/display-preferences-sync.js';

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  marginBottom: 12,
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  fontSize: 12,
  color: 'var(--fg-muted)',
};

const DOT: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const DOT_COLORS: Record<DisplayPreferencesSyncStatus, string> = {
  local: 'var(--fg-muted)',
  loading: 'var(--accent)',
  synced: 'var(--success)',
  error: 'var(--danger)',
};

const STATUS_TEXT: Record<DisplayPreferencesSyncStatus, string> = {
  local: '显示偏好仅保存在本地',
  loading: '正在读取云端显示偏好…',
  synced: '显示偏好已同步到账号',
  error: '同步失败，显示偏好仅本地生效',
};

/**
 * 显示设置页顶部的同步状态行：让用户明确区分「已同步到账号」和「仅本地」。
 */
export function DisplayPreferencesSyncStatusRow(): ReactElement {
  const status = useDisplayPreferencesSyncStore((state) => state.status);
  const errorMessage = useDisplayPreferencesSyncStore((state) => state.errorMessage);
  const lastSyncedAt = useDisplayPreferencesSyncStore((state) => state.lastSyncedAt);
  const retry = useDisplayPreferencesSyncStore((state) => state.retry);

  const lastSyncedTitle =
    status === 'synced' && lastSyncedAt
      ? `上次同步：${new Date(lastSyncedAt).toLocaleString()}`
      : undefined;

  return (
    <div style={ROW} title={lastSyncedTitle}>
      <span style={{ ...DOT, background: DOT_COLORS[status] }} aria-hidden="true" />
      <span role="status" aria-live="polite">
        {STATUS_TEXT[status]}
      </span>
      {status === 'error' && errorMessage ? (
        <span
          style={{
            color: 'var(--fg-subtle)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {errorMessage}
        </span>
      ) : null}
      {status === 'error' ? (
        <button
          type="button"
          onClick={retry}
          style={{ ...BS_GHOST, marginLeft: 'auto', flexShrink: 0 }}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
