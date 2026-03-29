import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

export interface QRCodeDisplayProps {
  qrData: string;
  expiresAt: number;
  onExpired?: () => void;
  onRefresh?: () => void;
  size?: number;
  style?: CSSProperties;
}

export function QRCodeDisplay({
  qrData,
  expiresAt,
  onExpired,
  onRefresh,
  size = 200,
  style,
}: QRCodeDisplayProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        clearInterval(interval);
        onExpired?.();
      }
    }, 500);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const expired = secondsLeft === 0;
  const urgent = secondsLeft <= 10 && !expired;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(qrData)}`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '1.5rem',
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        ...style,
      }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <img
          src={qrUrl}
          alt="QR 码"
          width={size}
          height={size}
          style={{
            borderRadius: 8,
            filter: expired ? 'blur(4px) opacity(0.3)' : 'none',
            display: 'block',
          }}
        />
        {expired && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#fca5a5',
            }}
          >
            已过期
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 12,
          color: expired ? '#f87171' : urgent ? '#facc15' : 'var(--color-muted, #94a3b8)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {expired ? 'QR 码已过期' : `${secondsLeft}s 后过期`}
      </div>

      {(expired || urgent) && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          style={{
            background: 'var(--color-accent, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.4rem 1rem',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          刷新
        </button>
      )}
    </div>
  );
}
