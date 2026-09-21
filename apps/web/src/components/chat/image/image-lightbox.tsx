import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './image-lightbox.css';

export interface ImageLightboxItem {
  src: string;
  alt?: string;
  caption?: string;
  fileName?: string;
}

export interface ImageLightboxProps {
  open: boolean;
  onClose: () => void;
  /** 单图模式（向后兼容，现有调用点继续用） */
  src?: string;
  alt?: string;
  caption?: string;
  fileName?: string;
  /** 图集模式；传入非空数组时优先于 src */
  items?: readonly ImageLightboxItem[];
  /** 受控索引；不传则组件内部维护 */
  index?: number;
  onIndexChange?: (index: number) => void;
}

/**
 * Reusable fullscreen image lightbox with rotate / zoom / download / keyboard
 * shortcut support. Used by both the assistant-generated image card and
 * user-uploaded image attachments so the preview UX is consistent.
 *
 * Two input modes:
 *   - single image: legacy `src` / `alt` / `caption` / `fileName` props
 *   - gallery:      `items` (takes precedence) + optional controlled `index`
 *
 * Keyboard shortcuts (when open):
 *   Esc            close + reset
 *   ← / →          previous / next image (gallery mode only, no wrap-around)
 *   r / R          rotate +90°
 *   + / =          zoom in (+0.25)
 *   -              zoom out (-0.25)
 *   0              reset rotation + zoom
 */
export function ImageLightbox({
  open,
  onClose,
  src,
  alt,
  caption,
  fileName,
  items,
  index,
  onIndexChange,
}: ImageLightboxProps) {
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [internalIndex, setInternalIndex] = useState(0);

  // Gallery items win over the legacy single-image props; the legacy props are
  // wrapped into a one-item array so downstream logic only deals with one shape.
  const effectiveItems: readonly ImageLightboxItem[] =
    items && items.length > 0 ? items : src ? [{ src, alt, caption, fileName }] : [];
  const count = effectiveItems.length;
  const effectiveIndex = count === 0 ? 0 : Math.min(Math.max(index ?? internalIndex, 0), count - 1);
  const current = effectiveItems[effectiveIndex];
  const currentSrc = current?.src;
  const hasMultiple = count > 1;

  const handleClose = useCallback(() => {
    setRotation(0);
    setScale(1);
    onClose();
  }, [onClose]);

  const goToIndex = useCallback(
    (next: number) => {
      if (count === 0) return;
      const clamped = Math.min(Math.max(next, 0), count - 1);
      // 边界处 no-op（不循环），也不会把相同索引回抛给受控调用点。
      if (clamped === effectiveIndex) return;
      setInternalIndex(clamped);
      onIndexChange?.(clamped);
    },
    [count, effectiveIndex, onIndexChange],
  );

  // Reset transform whenever the lightbox opens or the visible image changes, so
  // prior rotation / zoom state neither leaks across open cycles nor carries over
  // from one gallery image to the next. 依赖当前条目的 src（而不是下标）：图集在
  // index 不变时被重排 / 刷新，只要当前图片变了同样要重置。
  useEffect(() => {
    if (!open) return;
    setRotation(0);
    setScale(1);
  }, [open, currentSrc]);

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
      } else if (hasMultiple && e.key === 'ArrowLeft') {
        e.preventDefault();
        goToIndex(effectiveIndex - 1);
      } else if (hasMultiple && e.key === 'ArrowRight') {
        e.preventDefault();
        goToIndex(effectiveIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose, hasMultiple, goToIndex, effectiveIndex]);

  // 没有任何图片时不渲染空壳（图集传空数组 + 无 src，且 open 为真）。
  if (!open || !current) return null;

  const downloadName = current.fileName ?? 'image.png';
  const altText = current.alt ?? current.caption ?? '图片预览';

  return createPortal(
    <div className="image-lightbox" onClick={handleClose}>
      {/* Toolbar */}
      <div className="image-lightbox__toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="缩小 (−)"
          aria-label="缩小"
          onClick={() => setScale((v) => Math.max(v - 0.25, 0.25))}
          className="image-lightbox__tool-btn"
        >
          －
        </button>
        <button
          type="button"
          title="重置缩放 (0)"
          aria-label="重置缩放"
          onClick={() => setScale(1)}
          className="image-lightbox__tool-btn image-lightbox__tool-btn--label"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          title="放大 (+)"
          aria-label="放大"
          onClick={() => setScale((v) => Math.min(v + 0.25, 5))}
          className="image-lightbox__tool-btn"
        >
          ＋
        </button>
        <div className="image-lightbox__divider" />
        <button
          type="button"
          title="左旋 90°"
          aria-label="向左旋转 90 度"
          onClick={() => setRotation((v) => v - 90)}
          className="image-lightbox__tool-btn"
        >
          ↺
        </button>
        <button
          type="button"
          title="右旋 90° (R)"
          aria-label="向右旋转 90 度"
          onClick={() => setRotation((v) => v + 90)}
          className="image-lightbox__tool-btn"
        >
          ↻
        </button>
        <div className="image-lightbox__divider" />
        <button
          type="button"
          title="重置全部 (0)"
          aria-label="重置缩放与旋转"
          onClick={() => {
            setRotation(0);
            setScale(1);
          }}
          className="image-lightbox__tool-btn"
        >
          ↩
        </button>
        <button
          type="button"
          title="下载图片"
          aria-label="下载图片"
          onClick={() => {
            const a = document.createElement('a');
            a.href = current.src;
            a.download = downloadName;
            a.referrerPolicy = 'no-referrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
          className="image-lightbox__tool-btn image-lightbox__tool-btn--label"
        >
          ↓ 下载
        </button>
        <div className="image-lightbox__divider" />
        <button
          type="button"
          title="关闭 (Esc)"
          aria-label="关闭预览"
          onClick={handleClose}
          className="image-lightbox__tool-btn image-lightbox__tool-btn--close"
        >
          ×
        </button>
      </div>
      {/* Gallery navigation — only rendered when there is more than one image. */}
      {hasMultiple && (
        <>
          <button
            type="button"
            title="上一张 (←)"
            aria-label="上一张"
            disabled={effectiveIndex <= 0}
            onClick={(e) => {
              e.stopPropagation();
              goToIndex(effectiveIndex - 1);
            }}
            className="image-lightbox__nav image-lightbox__nav--prev"
          >
            ←
          </button>
          <button
            type="button"
            title="下一张 (→)"
            aria-label="下一张"
            disabled={effectiveIndex >= count - 1}
            onClick={(e) => {
              e.stopPropagation();
              goToIndex(effectiveIndex + 1);
            }}
            className="image-lightbox__nav image-lightbox__nav--next"
          >
            →
          </button>
        </>
      )}
      {/* Full image */}
      <img
        className="image-lightbox__image"
        src={current.src}
        alt={altText}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: `rotate(${rotation}deg) scale(${scale})` }}
      />
      {/* Caption + gallery progress */}
      {(current.caption || hasMultiple) && (
        <div className="image-lightbox__caption">
          {current.caption && (
            <span className="image-lightbox__caption-text">{current.caption}</span>
          )}
          {hasMultiple && (
            <span className="image-lightbox__counter" aria-live="polite">
              {effectiveIndex + 1} / {count}
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
