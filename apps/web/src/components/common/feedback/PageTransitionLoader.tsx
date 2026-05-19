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
  const animate = !prefersReducedMotion;

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
          ? 'radial-gradient(circle at 50% 18%, var(--accent-muted), transparent 36%), radial-gradient(circle at 50% 82%, color-mix(in oklch, var(--success) 18%, transparent), transparent 42%), var(--bg-base)'
          : 'linear-gradient(180deg, color-mix(in oklch, var(--bg-base) 6%, transparent), color-mix(in oklch, var(--bg-base) 18%, transparent))',
        backdropFilter: isFullscreen ? undefined : 'blur(2px) saturate(1.05)',
        WebkitBackdropFilter: isFullscreen ? undefined : 'blur(2px) saturate(1.05)',
        zIndex: isFullscreen ? undefined : 4,
      }}
    >
      <div
        style={{
          width: 'min(100%, 340px)',
          display: 'grid',
          gap: 16,
          padding: isFullscreen ? '20px 20px 18px' : '18px 18px 16px',
          borderRadius: 22,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-md), var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          animation: animate
            ? 'route-loader-panel-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both'
            : undefined,
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
              width: 46,
              height: 46,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {/* Soft halo aura */}
            <span
              style={{
                position: 'absolute',
                inset: -4,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle at center, var(--accent-muted), transparent 70%)',
                filter: 'blur(2px)',
                animation: animate ? 'route-loader-aura 2.4s ease-in-out infinite' : undefined,
              }}
            />

            {/* Outer conic ring (primary spinner) */}
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background:
                  'conic-gradient(from 0deg, transparent 0deg, var(--accent) 120deg, transparent 240deg, var(--accent) 320deg, transparent 360deg)',
                WebkitMask: 'radial-gradient(circle at center, transparent 14px, #000 15px)',
                mask: 'radial-gradient(circle at center, transparent 14px, #000 15px)',
                animation: animate
                  ? 'route-loader-orbit 1.05s cubic-bezier(0.6, 0.05, 0.4, 0.95) infinite'
                  : undefined,
              }}
            />

            {/* Inner counter-rotating wisp */}
            <span
              style={{
                position: 'absolute',
                inset: 5,
                borderRadius: '50%',
                border: '1px solid transparent',
                borderTopColor: 'rgba(255, 255, 255, 0.45)',
                borderRightColor: 'rgba(255, 255, 255, 0.18)',
                opacity: 0.7,
                animation: animate ? 'route-loader-orbit-reverse 1.6s linear infinite' : undefined,
              }}
            />

            {/* Subtle inner ring backdrop */}
            <span
              style={{
                position: 'absolute',
                inset: 8,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.18), transparent 70%), var(--bg-surface)',
                border: '1px solid var(--border-default)',
              }}
            />

            {/* Pulsing core dot */}
            <span
              style={{
                position: 'relative',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.85), var(--accent) 70%)',
                animation: animate ? 'route-loader-pulse 1.6s ease-in-out infinite' : undefined,
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
                fontWeight: 700,
                color: 'var(--fg-muted)',
                ...(animate
                  ? {
                      backgroundImage:
                        'linear-gradient(90deg, var(--fg-muted) 0%, var(--fg-muted) 35%, var(--accent) 50%, var(--fg-muted) 65%, var(--fg-muted) 100%)',
                      backgroundSize: '220% 100%',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      animation: 'route-loader-caption-shimmer 2.6s linear infinite',
                    }
                  : null),
              }}
            >
              {caption}
            </span>
            <strong
              style={{
                fontSize: isFullscreen ? 18 : 16,
                lineHeight: 1.15,
                letterSpacing: '-0.03em',
                color: 'var(--fg-strong)',
                fontWeight: 700,
              }}
            >
              {title}
            </strong>
            <span
              style={{
                color: 'var(--fg-default)',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {description}
            </span>
          </div>
        </div>

        {/* Indeterminate progress with dual streams */}
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            height: 6,
            overflow: 'hidden',
            borderRadius: 999,
            background:
              'linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04))',
            boxShadow: 'inset 0 1px 1px rgba(0, 0, 0, 0.18)',
          }}
        >
          {/* Trailing shadow stream */}
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 999,
              background:
                'linear-gradient(90deg, transparent, var(--accent-muted), transparent)',
              animation: animate
                ? 'route-loader-track-tail 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                : undefined,
              opacity: animate ? undefined : 0.4,
            }}
          />
          {/* Primary highlight stream */}
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 999,
              background:
                'linear-gradient(90deg, transparent, var(--accent), transparent)',
              animation: animate
                ? 'route-loader-track 1.5s cubic-bezier(0.22, 1, 0.36, 1) infinite'
                : undefined,
              filter: 'drop-shadow(0 0 6px var(--accent-muted))',
              opacity: animate ? undefined : 0.7,
            }}
          />
        </div>
      </div>
    </div>
  );
});

export default PageTransitionLoader;
