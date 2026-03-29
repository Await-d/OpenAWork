import { memo } from 'react';

interface PageTransitionLoaderProps {
  caption: string;
  description: string;
  prefersReducedMotion?: boolean;
  title: string;
  variant?: 'fullscreen' | 'overlay';
}

const PageTransitionLoader = memo(function PageTransitionLoader({
  caption,
  description,
  prefersReducedMotion = false,
  title,
  variant = 'overlay',
}: PageTransitionLoaderProps) {
  const isFullscreen = variant === 'fullscreen';

  return (
    <div
      data-testid={`page-transition-loader-${variant}`}
      aria-live="polite"
      style={{
        position: isFullscreen ? 'relative' : 'absolute',
        inset: isFullscreen ? undefined : 0,
        display: 'flex',
        minHeight: isFullscreen ? '100dvh' : undefined,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isFullscreen ? '24px' : '20px',
        pointerEvents: isFullscreen ? undefined : 'none',
        background: isFullscreen
          ? 'radial-gradient(circle at top, var(--accent-muted), transparent 34%), var(--bg)'
          : 'linear-gradient(180deg, oklch(0 0 0 / 0.08), oklch(0 0 0 / 0.2))',
        zIndex: isFullscreen ? undefined : 4,
      }}
    >
      <div
        style={{
          width: 'min(100%, 320px)',
          display: 'grid',
          gap: 14,
          padding: isFullscreen ? '18px 18px 16px' : '16px 16px 14px',
          borderRadius: 20,
          background: 'var(--bg-glass)',
          border: '1px solid var(--bg-glass-border)',
          boxShadow: 'var(--shadow-md), var(--shadow-lg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          animation: prefersReducedMotion
            ? undefined
            : 'route-loader-panel-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'relative',
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent-muted), oklch(0 0 0 / 0))',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '1px solid oklch(1 0 0 / 0.12)',
                borderTopColor: 'var(--accent)',
                animation: prefersReducedMotion
                  ? undefined
                  : 'route-loader-orbit 1.05s linear infinite',
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: 9,
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 0 6px var(--accent-muted)',
                animation: prefersReducedMotion
                  ? undefined
                  : 'route-loader-pulse 1.6s ease-in-out infinite',
              }}
            />
          </div>

          <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                lineHeight: 1,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
                fontWeight: 700,
              }}
            >
              {caption}
            </span>
            <strong
              style={{
                fontSize: isFullscreen ? 18 : 16,
                lineHeight: 1.1,
                letterSpacing: '-0.03em',
                color: 'var(--text)',
                fontWeight: 700,
              }}
            >
              {title}
            </strong>
            <span
              style={{
                color: 'var(--text-2)',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {description}
            </span>
          </div>
        </div>

        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            height: 6,
            overflow: 'hidden',
            borderRadius: 999,
            background: 'oklch(1 0 0 / 0.08)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 999,
              background:
                'linear-gradient(90deg, oklch(1 0 0 / 0), var(--accent), oklch(1 0 0 / 0))',
              animation: prefersReducedMotion
                ? undefined
                : 'route-loader-track 1.5s cubic-bezier(0.22, 1, 0.36, 1) infinite',
            }}
          />
        </div>
      </div>
    </div>
  );
});

export default PageTransitionLoader;
