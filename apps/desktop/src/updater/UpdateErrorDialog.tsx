import type { UpdateErrorKind } from './auto-update.js';

export interface UpdateErrorDialogProps {
  kind: UpdateErrorKind;
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

const ERROR_TITLES: Record<UpdateErrorKind, string> = {
  network: 'Connection Failed',
  signature: 'Verification Failed',
  permission: 'Permission Denied',
  no_update: 'No Update Found',
  unknown: 'Update Error',
};

const ERROR_HINTS: Record<UpdateErrorKind, string> = {
  network: 'Check your internet connection and try again.',
  signature: 'The update package could not be verified. Please try again or download manually.',
  permission: 'The app lacks permission to install updates. Try running as administrator.',
  no_update: 'You are already on the latest version.',
  unknown: 'An unexpected error occurred.',
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
          <summary style={{ cursor: 'pointer' }}>Technical details</summary>
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
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Dismiss
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
              Retry
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
