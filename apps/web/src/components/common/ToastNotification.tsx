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

const TYPE_BG: Record<ToastType, string> = {
  info: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    const dur = t.duration ?? 3500;
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
        timers.current.delete(id);
      }, dur),
    );
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
        <div
          key={t.id}
          style={{
            background: TYPE_BG[t.type],
            color: 'var(--accent-text)',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 12,
            fontWeight: 500,
            boxShadow: 'var(--shadow-md)',
            maxWidth: 340,
            lineHeight: 1.4,
            pointerEvents: 'auto',
            animation: 'toast-in 0.2s ease',
          }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes toast-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
