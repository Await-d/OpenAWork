import { useState } from 'react';
import { ImageZoomTrigger } from '../../../common/display/ImageZoomTrigger.js';
import { ImageLightbox } from '../../image/image-lightbox.js';
import type { ToolCallImageSource } from '../shared/tool-call-image-source.js';
import { useToolCallImagePreview } from './use-tool-call-image-preview.js';

/**
 * 展开态工具调用里的图片缩略预览（look_at / 桌面截图）。
 *
 * 只负责展示：108px 见方的缩略图 + 点击后复用 `ImageLightbox` 打开大图，
 * 与产物页 / web 抓图预览保持同一套放大体验。真正的取图逻辑在
 * `useToolCallImagePreview`（内联地址直出，工作区 / 产物走网关读取）。
 *
 * 三态齐全：loading 占位、error + 重试、成功缩略图。
 */
export function ToolCallImagePreview({ source }: { source: ToolCallImageSource | null }) {
  const { imageSrc, loading, error, retry } = useToolCallImagePreview(source);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (source === null) return null;

  // 异步源（workspace / artifact）在 effect 起跑前会有一帧「无图、无错误」的
  // 空窗，这里把它并入 loading，避免出现闪烁的空白块。
  const showPlaceholder = loading || (!imageSrc && !error);

  return (
    <div className="tool-call-image-preview">
      {showPlaceholder && (
        <div className="tool-call-image-preview__placeholder" role="status">
          图片加载中…
        </div>
      )}

      {!showPlaceholder && error && (
        <div className="tool-call-image-preview__error" role="status">
          <span className="tool-call-image-preview__error-text" title={error}>
            {error}
          </span>
          <button type="button" className="tool-call-image-preview__retry" onClick={retry}>
            重试
          </button>
        </div>
      )}

      {!showPlaceholder && imageSrc && (
        // 缩略图点击只应打开灯箱：阻断冒泡，避免触发展开体上的其它点击行为。
        <div
          className="tool-call-image-preview__thumb"
          onClick={(event) => event.stopPropagation()}
        >
          <ImageZoomTrigger
            className="tool-call-image-preview__trigger"
            src={imageSrc}
            alt={source.alt}
            label={`放大查看图片：${source.alt}`}
            onOpen={() => setLightboxOpen(true)}
          />
        </div>
      )}

      {imageSrc && (
        <ImageLightbox
          src={imageSrc}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          alt={source.alt}
          caption={source.alt}
        />
      )}
    </div>
  );
}
