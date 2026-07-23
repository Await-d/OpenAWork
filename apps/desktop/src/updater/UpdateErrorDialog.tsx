import type { UpdateErrorKind } from './auto-update.js';

export interface UpdateErrorDialogProps {
  kind: UpdateErrorKind;
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

const ERROR_TITLES: Record<UpdateErrorKind, string> = {
  network: '连接失败',
  signature: '校验失败',
  permission: '权限不足',
  no_update: '暂无更新',
  unknown: '更新出错',
};

const ERROR_HINTS: Record<UpdateErrorKind, string> = {
  network: '无法连接到更新服务器或加速镜像，请检查网络后重试。',
  signature: '更新包签名校验失败。请重试，或从 GitHub Releases 手动下载安装。',
  permission: '当前权限不足以安装更新。请尝试以管理员/具备写入权限的账户运行。',
  no_update: '当前已是最新版本。',
  unknown: '更新过程中发生未知错误，请重试。',
};

export function UpdateErrorDialog({ kind, message, onRetry, onDismiss }: UpdateErrorDialogProps) {
  return (
    <dialog
      open
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9001,
        border: 'none',
        padding: 0,
        margin: 0,
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss();
      }}
    >
      <div
        style={{
          background: 'hsl(var(--background))',
          border: '1px solid hsl(var(--destructive) / 0.4)',
          borderRadius: 12,
          padding: '1.5rem',
          width: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'hsl(var(--destructive))' }}>
          {ERROR_TITLES[kind]}
        </div>
        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
          {ERROR_HINTS[kind]}
        </div>
        <details style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
          <summary style={{ cursor: 'pointer' }}>技术详情</summary>
          <pre
            style={{
              marginTop: 4,
              fontSize: 11,
              background: 'hsl(var(--muted) / 0.5)',
              borderRadius: 6,
              padding: '0.5rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {message}
          </pre>
        </details>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid hsl(var(--border-default))',
              borderRadius: 6,
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            关闭
          </button>
          {kind !== 'no_update' && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: '6px 14px',
                background: 'hsl(var(--primary))',
                border: 'none',
                borderRadius: 6,
                color: 'hsl(var(--primary-foreground))',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
