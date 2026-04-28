import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ImageLightboxProps {
  src: string;
  open: boolean;
  onClose: () => void;
  alt?: string;
  caption?: string;
  fileName?: string;
}

const lbToolBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.12)',
  backdropFilter: 'blur(8px)',
  color: '#fff',
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Reusable fullscreen image lightbox with rotate / zoom / download / keyboard
 * shortcut support. Used by both the assistant-generated image card and
 * user-uploaded image attachments so the preview UX is consistent.
 *
 * Keyboard shortcuts (when open):
 *   Esc            close + reset
 *   r / R          rotate +90°
 *   + / =          zoom in (+0.25)
 *   -              zoom out (-0.25)
 *   0              reset rotation + zoom
 */
export function ImageLightbox({ src, open, onClose, alt, caption, fileName }: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);

  const handleClose = useCallback(() => {
    setRotation(0);
    setScale(1);
    onClose();
  }, [onClose]);

  // Reset transform whenever the lightbox opens with a new image so prior
  // rotation / zoom state from a previous open does not leak across instances.
  useEffect(() => {
    if (!open) return;
    setRotation(0);
    setScale(1);
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'r' || e.key === 'R') {
        setRotation((v) => v + 90);
      } else if (e.key === '+' || e.key === '=') {
        setScale((v) => Math.min(v + 0.25, 5));
      } else if (e.key === '-') {
        setScale((v) => Math.max(v - 0.25, 0.25));
      } else if (e.key === '0') {
        setRotation(0);
        setScale(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  if (!open || !src) return null;

  const downloadName = fileName ?? 'image.png';
  const altText = alt ?? caption ?? '图片预览';

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(8px)',
        cursor: 'zoom-out',
        animation: 'fade-in 150ms ease-out',
      }}
      onClick={handleClose}
    >
      {/* Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          gap: 6,
          zIndex: 1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="缩小 (−)"
          onClick={() => setScale((v) => Math.max(v - 0.25, 0.25))}
          style={lbToolBtnStyle}
        >
          －
        </button>
        <button
          type="button"
          title="重置缩放 (0)"
          onClick={() => setScale(1)}
          style={{
            ...lbToolBtnStyle,
            width: 'auto',
            padding: '0 8px',
            fontSize: 11,
            fontWeight: 600,
            minWidth: 44,
          }}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          title="放大 (+)"
          onClick={() => setScale((v) => Math.min(v + 0.25, 5))}
          style={lbToolBtnStyle}
        >
          ＋
        </button>
        <div
          style={{ width: 1, height: 20, alignSelf: 'center', background: 'rgba(255,255,255,0.15)' }}
        />
        <button
          type="button"
          title="左旋 90°"
          onClick={() => setRotation((v) => v - 90)}
          style={lbToolBtnStyle}
        >
          ↺
        </button>
        <button
          type="button"
          title="右旋 90° (R)"
          onClick={() => setRotation((v) => v + 90)}
          style={lbToolBtnStyle}
        >
          ↻
        </button>
        <div
          style={{ width: 1, height: 20, alignSelf: 'center', background: 'rgba(255,255,255,0.15)' }}
        />
        <button
          type="button"
          title="重置全部 (0)"
          onClick={() => {
            setRotation(0);
            setScale(1);
          }}
          style={lbToolBtnStyle}
        >
          ↩
        </button>
        <button
          type="button"
          title="下载图片"
          onClick={() => {
            const a = document.createElement('a');
            a.href = src;
            a.download = downloadName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
          style={{ ...lbToolBtnStyle, width: 'auto', padding: '0 12px', gap: 5 }}
        >
          ↓ 下载
        </button>
        <div
          style={{ width: 1, height: 20, alignSelf: 'center', background: 'rgba(255,255,255,0.15)' }}
        />
        <button
          type="button"
          title="关闭 (Esc)"
          onClick={handleClose}
          style={{ ...lbToolBtnStyle, fontSize: 18 }}
        >
          ×
        </button>
      </div>
      {/* Full image */}
      <img
        src={src}
        alt={altText}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 'calc(100vw - 80px)',
          maxHeight: 'calc(100vh - 80px)',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: 'default',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          transform: `rotate(${rotation}deg) scale(${scale})`,
          transition: 'transform 200ms ease',
        }}
      />
      {/* Caption */}
      {caption && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '80vw',
            padding: '6px 14px',
            borderRadius: 10,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(6px)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 12,
            fontWeight: 500,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {caption}
        </div>
      )}
    </div>,
    document.body,
  );
}
