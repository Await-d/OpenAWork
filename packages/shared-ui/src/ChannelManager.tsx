import type { CSSProperties } from 'react';

export type ChannelType = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'line' | 'custom';

export type ChannelStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface ChannelConfig {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  description?: string;
  metadata?: Record<string, string>;
  connectedAt?: number;
  errorMessage?: string;
}

export interface ChannelManagerProps {
  channels: ChannelConfig[];
  onConnect?: (channelId: string) => void;
  onDisconnect?: (channelId: string) => void;
  onDelete?: (channelId: string) => void;
  onAdd?: (type: ChannelType) => void;
  supportedTypes?: ChannelType[];
  style?: CSSProperties;
}

const STATUS_COLOR: Record<ChannelStatus, string> = {
  connected: '#34d399',
  disconnected: 'var(--color-muted, #94a3b8)',
  error: '#f87171',
  pending: '#facc15',
};

const STATUS_LABEL: Record<ChannelStatus, string> = {
  connected: '已连接',
  disconnected: '已断开',
  error: '错误',
  pending: '待连接',
};

const CHANNEL_ICON: Record<ChannelType, string> = {
  telegram: '✈',
  discord: '🎮',
  slack: '#',
  whatsapp: '💬',
  line: 'L',
  custom: '⚙',
};

const DEFAULT_SUPPORTED: ChannelType[] = [
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'line',
  'custom',
];

export function ChannelManager({
  channels,
  onConnect,
  onDisconnect,
  onDelete,
  onAdd,
  supportedTypes = DEFAULT_SUPPORTED,
  style,
}: ChannelManagerProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--color-surface, #1e293b)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.875rem',
          borderBottom: '1px solid var(--color-border, #334155)',
          background: 'var(--color-surface-raised, #0f172a)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          渠道 ({channels.length})
        </span>
        {onAdd && (
          <div style={{ display: 'flex', gap: 4 }}>
            {supportedTypes.map((type) => (
              <button
                key={type}
                type="button"
                title={`添加 ${type}`}
                onClick={() => onAdd(type)}
                style={{
                  background: 'var(--color-accent, #6366f1)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '0.25rem 0.55rem',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                + {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {channels.length === 0 ? (
        <div
          style={{
            padding: '1.25rem',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          暂无已配置渠道
        </div>
      ) : (
        channels.map((ch, i) => (
          <div
            key={ch.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0.6rem 0.875rem',
              borderTop: i > 0 ? '1px solid var(--color-border, #334155)' : 'none',
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'var(--color-surface-raised, #0f172a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                flexShrink: 0,
                border: '1px solid var(--color-border, #334155)',
              }}
            >
              {CHANNEL_ICON[ch.type]}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text, #f1f5f9)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ch.name}
              </div>
              {ch.description && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted, #94a3b8)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ch.description}
                </div>
              )}
              {ch.status === 'error' && ch.errorMessage && (
                <div style={{ fontSize: 11, color: '#f87171', marginTop: 1 }}>
                  {ch.errorMessage}
                </div>
              )}
            </div>

            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: STATUS_COLOR[ch.status],
                flexShrink: 0,
                padding: '0.15rem 0.45rem',
                borderRadius: 4,
                background: 'var(--color-surface-raised, #0f172a)',
                border: `1px solid ${STATUS_COLOR[ch.status]}40`,
              }}
            >
              {STATUS_LABEL[ch.status]}
            </span>

            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {ch.status !== 'connected' && onConnect && (
                <button
                  type="button"
                  onClick={() => onConnect(ch.id)}
                  style={{
                    background: '#166534',
                    color: '#86efac',
                    border: 'none',
                    borderRadius: 5,
                    padding: '0.25rem 0.6rem',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  连接
                </button>
              )}
              {ch.status === 'connected' && onDisconnect && (
                <button
                  type="button"
                  onClick={() => onDisconnect(ch.id)}
                  style={{
                    background: '#7c2d12',
                    color: '#fca5a5',
                    border: 'none',
                    borderRadius: 5,
                    padding: '0.25rem 0.6rem',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  断开
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(ch.id)}
                  title="删除渠道"
                  style={{
                    background: 'transparent',
                    color: 'var(--color-muted, #94a3b8)',
                    border: '1px solid var(--color-border, #334155)',
                    borderRadius: 5,
                    padding: '0.25rem 0.5rem',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
