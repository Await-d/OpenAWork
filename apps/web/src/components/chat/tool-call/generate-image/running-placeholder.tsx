import { ToolIcon } from '../../tool-icon';

/**
 * Animated "正在生成图片…" placeholder shown while the tool itself is still
 * running. Renders a shimmer sweep + pulsing icon stack inside an aspect-
 * ratio-correct frame so the body's height is stable and switches to the
 * real image without layout shift.
 *
 * The keyframes live in a sibling `<style>` element scoped via class names
 * (`omo-image-gen-shimmer` / `omo-image-gen-pulse`) so they only apply
 * inside this card; `prefers-reduced-motion` disables both animations.
 */
export function GenerateImageRunningPlaceholder({
  prompt,
  promptShort,
  aspectRatio,
}: {
  prompt: string;
  promptShort: string;
  aspectRatio: number;
}) {
  return (
    <div
      style={{
        padding: '6px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <style>{`
@keyframes omo-image-gen-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes omo-image-gen-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .omo-image-gen-shimmer { animation: none !important; opacity: 0; }
  .omo-image-gen-pulse { animation: none !important; opacity: 0.85; }
}
          `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          aspectRatio: String(aspectRatio),
          borderRadius: 12,
          border: '1px dashed var(--border-subtle)',
          background:
            'linear-gradient(135deg, color-mix(in oklch, var(--accent) 6%, var(--surface)) 0%, var(--surface) 60%, color-mix(in oklch, var(--accent) 4%, var(--surface)) 100%)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Shimmer sweep */}
        <div
          aria-hidden="true"
          className="omo-image-gen-shimmer"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(110deg, transparent 35%, color-mix(in oklch, var(--accent) 14%, transparent) 50%, transparent 65%)',
            animation: 'omo-image-gen-shimmer 1.8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
        {/* Status content */}
        <div
          className="omo-image-gen-pulse"
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-2)',
            animation: 'omo-image-gen-pulse 1.8s ease-in-out infinite',
            padding: '0 16px',
            textAlign: 'center',
          }}
        >
          <ToolIcon toolName="generate_image" status="running" size={22} />
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-2)',
            }}
          >
            正在生成图片…
          </div>
          {promptShort && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                lineHeight: 1.5,
                maxWidth: '100%',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
              title={prompt}
            >
              {promptShort}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
