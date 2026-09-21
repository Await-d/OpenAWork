import { useEffect, useState } from 'react';
import { GenerateImageDisplay } from '../tool-call/generate-image/image-display.js';
import { useGenerateImageArtifact } from '../tool-call/generate-image/use-artifact.js';
import { ImageLightbox } from './image-lightbox.js';
import './chat-image-generation-result-thumbnail.css';

export interface ChatImageGenerationResultThumbnailProps {
  artifactId: string;
  artifactTitle: string;
}

/**
 * 「最新图片结果」提示条的内联缩略图。
 *
 * 复用 `generate_image` 工具卡的取图链路（`useGenerateImageArtifact`）与展示组件
 * （`GenerateImageDisplay`），并在缩略图尺寸内就地处理 loading / error 两态，
 * 避免结果条出现空图框。
 *
 * 无障碍：缩略图容器只负责尺寸 / 裁剪 / 圆角，本身不承担任何交互语义；
 * 「放大查看」由与 `GenerateImageDisplay` 同级（不嵌套）的独立 `<button>` 承担，
 * 键盘 Enter / Space 交给原生按钮语义，不再用 `role="button"` 包住内部含真实
 * 按钮的组件。鼠标点击图片仍复用 `GenerateImageDisplay` 自带的 `onOpenLightbox`，
 * 两条路径各自只触发一次，不再出现容器点击与内部点击重复打开。
 */
export function ChatImageGenerationResultThumbnail({
  artifactId,
  artifactTitle,
}: ChatImageGenerationResultThumbnailProps) {
  const { imageSrc, imageLoading, fetchError, fileName, retry } =
    useGenerateImageArtifact(artifactId);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const openLightbox = () => setLightboxOpen(true);

  // 原始错误只进控制台：DOM（含 title / 文本）一律只保留通用文案。
  useEffect(() => {
    if (!fetchError) return;
    console.error('[chat-image-result-thumbnail] 图片加载失败', { artifactId, fetchError });
  }, [artifactId, fetchError]);

  if (fetchError) {
    return (
      <div
        className="chat-image-result-thumb chat-image-result-thumb--error"
        data-testid="chat-image-generation-thumbnail-error"
        role="alert"
      >
        <span className="chat-image-result-thumb__error-text">图片加载失败</span>
        <button
          type="button"
          className="chat-image-result-thumb__retry"
          data-testid="chat-image-generation-thumbnail-retry"
          title="图片加载失败"
          onClick={retry}
        >
          重试
        </button>
      </div>
    );
  }

  if (imageLoading || !imageSrc) {
    return (
      <div
        className="chat-image-result-thumb chat-image-result-thumb--loading"
        data-testid="chat-image-generation-thumbnail-loading"
        aria-busy="true"
      >
        <span className="chat-image-result-thumb__status">图片加载中…</span>
      </div>
    );
  }

  return (
    <>
      <div
        className="chat-image-result-thumb chat-image-result-thumb--ready"
        data-testid="chat-image-generation-thumbnail"
      >
        <GenerateImageDisplay
          imageSrc={imageSrc}
          alt={`${artifactTitle} 缩略图`}
          fileName={fileName}
          onOpenLightbox={openLightbox}
        />
        <button
          type="button"
          className="chat-image-result-thumb__zoom"
          data-testid="chat-image-generation-thumbnail-zoom"
          aria-label="放大查看生成的图片"
          onClick={openLightbox}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
      <ImageLightbox
        src={imageSrc}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        alt={artifactTitle}
        caption={artifactTitle}
        fileName={fileName}
      />
    </>
  );
}
