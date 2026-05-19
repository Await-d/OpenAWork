export interface WorkerEntry {
  id: string;
  name: string;
  mode?: 'local' | 'cloud_worker' | 'sandbox';
  status: 'idle' | 'running' | 'stopped' | 'error';
  endpoint?: string;
}

export interface WorkerStatusIndicatorProps {
  workers: WorkerEntry[];
  onStop?: (id: string) => void;
  onConnect?: (id: string) => void;
}

const STATUS_COLOR: Record<WorkerEntry['status'], string> = {
  idle: 'var(--fg-muted, #7b8a9e)',
  running: 'var(--success, #3dd49a)',
  stopped: 'var(--warning, #f0b429)',
  error: 'var(--danger, #f06b7e)',
};

export function WorkerStatusIndicator({ workers, onStop, onConnect }: WorkerStatusIndicatorProps) {
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
        Worker（{workers.length}）
      </div>
      {workers.length === 0 ? (
        <div
          style={{
            padding: '1rem',
            color: 'var(--fg-muted, #7b8a9e)',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          暂无可用 Worker
        </div>
      ) : (
        workers.map((worker, index) => (
          <div
            key={worker.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0.65rem 0.875rem',
              borderTop: index === 0 ? 'none' : '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: STATUS_COLOR[worker.status],
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: 'var(--fg-strong, #f1f4f8)',
                  fontSize: 12,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {worker.name}
              </div>
              {worker.mode && (
                <div
                  style={{
                    color: 'var(--fg-muted, #7b8a9e)',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {worker.mode === 'cloud_worker'
                    ? 'Cloud Worker'
                    : worker.mode === 'sandbox'
                      ? 'Sandbox'
                      : 'Local'}
                </div>
              )}
              <div
                style={{
                  color: 'var(--fg-muted, #7b8a9e)',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {worker.endpoint ?? '未配置端点'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {onConnect && worker.status !== 'running' && (
                <button
                  type="button"
                  onClick={() => onConnect(worker.id)}
                  style={{
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    background: 'transparent',
                    color: 'var(--fg-strong, #f1f4f8)',
                    borderRadius: 6,
                    fontSize: 11,
                    padding: '0.3rem 0.6rem',
                    cursor: 'pointer',
                  }}
                >
                  连接
                </button>
              )}
              {onStop && worker.status === 'running' && (
                <button
                  type="button"
                  onClick={() => onStop(worker.id)}
                  style={{
                    border: 'none',
                    background: 'oklch(from var(--danger) 0.22 0.1 20)',
                    color: 'var(--danger, #fecaca)',
                    borderRadius: 6,
                    fontSize: 11,
                    padding: '0.3rem 0.6rem',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  停止
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
