import { useState, useCallback, useEffect, useRef } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

type ToastHandler = (toast: Omit<Toast, 'id'>) => void;

let _addToast: ToastHandler = () => undefined;

export function toast(message: string, type: ToastType = 'info', duration = 3500) {
  _addToast({ message, type, duration });
}

// ── Type config ────────────────────────────────────────────────

const TYPE_CONFIG: Record<ToastType, { bg: string; icon: string; accent: string }> = {
  info: {
    bg: 'color-mix(in srgb, var(--aux) 14%, var(--bg-overlay))',
    icon: 'var(--aux)',
    accent: 'var(--aux)',
  },
  success: {
    bg: 'color-mix(in srgb, var(--success) 14%, var(--bg-overlay))',
    icon: 'var(--success)',
    accent: 'var(--success)',
  },
  warning: {
    bg: 'color-mix(in srgb, var(--warning) 14%, var(--bg-overlay))',
    icon: 'var(--warning)',
    accent: 'var(--warning)',
  },
  error: {
    bg: 'color-mix(in srgb, var(--danger) 14%, var(--bg-overlay))',
    icon: 'var(--danger)',
    accent: 'var(--danger)',
  },
};

function ToastTypeIcon({ type, size = 16 }: { type: ToastType; size?: number }) {
  switch (type) {
    case 'success':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case 'warning':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'error':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

// ── Toast item ─────────────────────────────────────────────────

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const config = TYPE_CONFIG[t.type];
  const duration = t.duration ?? 3500;
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(Date.now());
  const [progress, setProgress] = useState(100);

  // Countdown progress
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, duration - elapsed);
      setProgress((remaining / duration) * 100);
      if (remaining > 0 && !exiting) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [duration, exiting]);

  // Auto dismiss
  useEffect(() => {
    if (exiting) {
      timerRef.current = setTimeout(() => onDismiss(t.id), 180);
      return;
    }
    timerRef.current = setTimeout(() => setExiting(true), duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration, t.id, onDismiss, exiting]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        background: config.bg,
        backdropFilter: 'blur(12px)',
        color: 'var(--fg-strong)',
        borderRadius: 10,
        padding: '10px 12px 10px 14px',
        fontSize: 12,
        fontWeight: 500,
        boxShadow: 'var(--shadow-md)',
        maxWidth: 360,
        minWidth: 260,
        lineHeight: 1.4,
        pointerEvents: 'auto',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${config.accent}`,
        animation: exiting
          ? 'toast-out 180ms cubic-bezier(0.4,0,0.2,1) forwards'
          : 'toast-in 220ms cubic-bezier(0.16,1,0.3,1)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Type icon */}
      <span
        style={{
          display: 'inline-flex',
          flexShrink: 0,
          marginTop: 1,
          color: config.icon,
        }}
      >
        <ToastTypeIcon type={t.type} size={15} />
      </span>

      {/* Message */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          color: 'var(--fg-strong)',
          wordBreak: 'break-word',
        }}
      >
        {t.message}
      </span>

      {/* Close button */}
      <button
        type="button"
        aria-label="关闭"
        onClick={() => setExiting(true)}
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: 5,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          marginTop: -1,
          opacity: 0.5,
          transition: 'opacity 100ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.5';
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: config.accent,
          opacity: 0.35,
          transformOrigin: 'left',
          transform: `scaleX(${progress / 100})`,
          transition: 'transform 60ms linear',
        }}
      />
    </div>
  );
}

// ── Container ──────────────────────────────────────────────────

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    _addToast = addToast;
    return () => {
      _addToast = () => undefined;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(20px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to { opacity: 0; transform: translateX(20px) scale(0.95); }
        }
      `}</style>
    </div>
  );
}
