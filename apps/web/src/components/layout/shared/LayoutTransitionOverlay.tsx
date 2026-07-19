import { useEffect, useState, useCallback, useRef } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const TRANSITION_STYLE = `
@keyframes lto-backdrop-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes lto-backdrop-out {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes lto-glow-in {
  0% { opacity: 0; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes lto-glow-out {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.05); }
}
@keyframes lto-panel-scale {
  0% { opacity: 0; transform: scale(0.9); filter: blur(12px); }
  100% { opacity: 1; transform: scale(1); filter: blur(0); }
}
@keyframes lto-panel-fade {
  0% { opacity: 1; transform: scale(1); filter: blur(0); }
  100% { opacity: 0; transform: scale(0.98); filter: blur(6px); }
}
@keyframes lto-bar-left {
  0% { opacity: 0; transform: translateX(-20px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes lto-bar-right {
  0% { opacity: 0; transform: translateX(20px); }
  100% { opacity: 1; transform: translateX(0); }
}
@keyframes lto-bar-top {
  0% { opacity: 0; transform: translateY(-20px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes lto-bar-bottom {
  0% { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes lto-inner-fade {
  0% { opacity: 0; transform: scale(0.96); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes lto-text-reveal {
  0% { opacity: 0; transform: translateY(10px); letter-spacing: 0.2em; }
  100% { opacity: 1; transform: translateY(0); letter-spacing: 0.08em; }
}
@keyframes lto-progress {
  0% { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}
@keyframes lto-progress-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

export function LayoutTransitionOverlay() {
  const layoutMode = useUIStateStore((state) => state.workbenchLayoutMode);
  const [phase, setPhase] = useState<'idle' | 'entering' | 'exiting'>('idle');
  const [displayMode, setDisplayMode] = useState(layoutMode);
  const initialSkipRef = useRef(true);

  const triggerTransition = useCallback(() => {
    setPhase('entering');
    setDisplayMode(layoutMode);

    const exitTimer = window.setTimeout(() => {
      setPhase('exiting');
    }, 820);

    const doneTimer = window.setTimeout(() => {
      setPhase('idle');
    }, 1180);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [layoutMode]);

  useEffect(() => {
    if (initialSkipRef.current) {
      initialSkipRef.current = false;
      return;
    }

    const cleanup = triggerTransition();
    return cleanup;
  }, [triggerTransition]);

  if (phase === 'idle') {
    return null;
  }

  const isEntering = phase === 'entering';
  const isClassic = displayMode === 'classic';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: isEntering ? 'auto' : 'none',
        opacity: isEntering ? 1 : 0,
        animation: isEntering
          ? 'lto-backdrop-in 280ms cubic-bezier(0.22, 0.61, 0.36, 1) both'
          : 'lto-backdrop-out 360ms cubic-bezier(0.4, 0, 0.68, 0.06) both',
      }}
    >
      <style>{TRANSITION_STYLE}</style>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--bg-base)',
          opacity: 0.94,
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          animation: isEntering
            ? 'lto-glow-in 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both'
            : 'lto-glow-out 360ms cubic-bezier(0.4, 0, 0.68, 0.06) both',
          background:
            'radial-gradient(circle at 50% 45%, color-mix(in oklch, var(--accent) 10%, transparent) 0%, transparent 50%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          width: 220,
          animation: isEntering
            ? 'lto-panel-scale 480ms cubic-bezier(0.22, 0.61, 0.36, 1) both'
            : 'lto-panel-fade 360ms cubic-bezier(0.4, 0, 0.68, 0.06) both',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 80,
            height: 80,
            borderRadius: 20,
            border: '1.5px solid var(--border-default)',
            background: 'var(--bg-surface)',
            boxShadow: '0 24px 64px color-mix(in srgb, var(--bg-base) 60%, transparent)',
            overflow: 'hidden',
          }}
        >
          {isClassic ? (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  bottom: 12,
                  left: 12,
                  width: 20,
                  borderRadius: 8,
                  background: 'var(--accent)',
                  animation: 'lto-bar-left 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 80ms both',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: '50%',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    transform: 'translateX(-50%)',
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 35%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 240ms both',
                  }}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  bottom: 12,
                  right: 12,
                  left: 40,
                  borderRadius: 8,
                  background: 'color-mix(in oklch, var(--accent) 50%, var(--bg-surface))',
                  animation: 'lto-bar-right 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 10,
                    right: 10,
                    height: 4,
                    borderRadius: 2,
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 25%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 280ms both',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 22,
                    left: 10,
                    right: 18,
                    height: 4,
                    borderRadius: 2,
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 18%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 320ms both',
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  right: 12,
                  height: 20,
                  borderRadius: 8,
                  background: 'var(--accent)',
                  animation: 'lto-bar-top 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 80ms both',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: 10,
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    transform: 'translateY(-50%)',
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 30%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 240ms both',
                  }}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 38,
                  left: 12,
                  right: 12,
                  bottom: 12,
                  borderRadius: 8,
                  background: 'color-mix(in oklch, var(--accent) 50%, var(--bg-surface))',
                  animation: 'lto-bar-bottom 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 10,
                    right: 10,
                    height: 4,
                    borderRadius: 2,
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 25%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 280ms both',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 22,
                    left: 10,
                    right: 24,
                    height: 4,
                    borderRadius: 2,
                    background:
                      'color-mix(in oklch, var(--accent-foreground, var(--fg-strong)) 18%, transparent)',
                    animation: 'lto-inner-fade 320ms ease 320ms both',
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            width: '100%',
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: 'linear-gradient(180deg, var(--fg-strong) 0%, var(--fg-muted) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              animation: 'lto-text-reveal 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 140ms both',
            }}
          >
            {isClassic ? 'Classic' : 'Fusion'}
          </span>

          <div
            style={{
              width: '100%',
              height: 3,
              borderRadius: 2,
              background: 'var(--border-subtle)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'relative',
                height: '100%',
                width: '100%',
                background: 'var(--accent)',
                transformOrigin: 'left',
                animation: 'lto-progress 720ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                  animation: 'lto-progress-shimmer 900ms linear infinite',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
