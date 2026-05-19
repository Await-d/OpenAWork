import { useState } from 'react';

/**
 * Generated-image display block: rounded card, hover-revealed action bar
 * (download + open-in-lightbox), checkerboard background to highlight
 * transparency. Click anywhere on the image opens the lightbox.
 *
 * Download is implemented by synthesising an `<a download>` because
 * `imageSrc` is a `data:` URL and the browser cannot stream a remote URL
 * filename without help.
 */
export function GenerateImageDisplay({
  imageSrc,
  alt,
  fileName,
  onOpenLightbox,
}: {
  imageSrc: string;
  alt: string;
  fileName: string;
  onOpenLightbox: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        maxWidth: 480,
      }}
    >
      <div
        style={{
          position: 'relative',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 2px 8px color-mix(in oklch, var(--fg-strong) 6%, transparent)',
          background:
            'repeating-conic-gradient(color-mix(in oklch, var(--bg-base) 94%, var(--fg-muted) 0% 25%, transparent 0% 50%) 50% / 16px 16px',
          lineHeight: 0,
          cursor: 'pointer',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={onOpenLightbox}
      >
        <img
          src={imageSrc}
          alt={alt}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: 420,
            objectFit: 'contain',
          }}
        />
        {/* Hover action bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 4,
            padding: 6,
            background: 'linear-gradient(rgba(0,0,0,0.45) 0%, transparent 100%)',
            opacity: hover ? 1 : 0,
            transition: 'opacity 150ms ease',
            pointerEvents: hover ? 'auto' : 'none',
          }}
        >
          <button
            type="button"
            title="下载图片"
            onClick={(e) => {
              e.stopPropagation();
              const a = document.createElement('a');
              a.href = imageSrc;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            style={hoverButtonStyle}
          >
            ↓
          </button>
          <button
            type="button"
            title="放大查看"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLightbox();
            }}
            style={hoverButtonStyle}
          >
            ⤢
          </button>
        </div>
      </div>
    </div>
  );
}

const hoverButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  background: 'rgba(255,255,255,0.18)',
  backdropFilter: 'blur(6px)',
  color: 'var(--fg-on-accent))',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
