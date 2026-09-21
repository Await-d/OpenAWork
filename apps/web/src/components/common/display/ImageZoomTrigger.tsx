import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './image-zoom-trigger.css';

export interface ImageZoomTriggerProps {
  /** 图片地址 */
  src: string;
  alt: string;
  /** 点击 / 键盘激活时打开大图查看器 */
  onOpen: () => void;
  /** 无障碍名称与 title；默认「放大查看图片」 */
  label?: string;
  /** 按钮附加类名（尺寸 / 定位由调用方控制） */
  className?: string;
  /** 按钮内联样式 */
  style?: CSSProperties;
  /** 图片内联样式 */
  imageStyle?: CSSProperties;
  /** 图片附加类名（沿用来源既有样式，如 `.mcp-result-image`） */
  imageClassName?: string;
  /** 图片原生 title（保留 Markdown 等来源的 title）；按钮 title / aria-label 仍用 label */
  imageTitle?: string;
  /** 图片加载策略（Markdown 正文等长列表传 lazy） */
  loading?: 'eager' | 'lazy';
}

/**
 * 「没有内容基准、渲染后坍缩」的判定阈值（px）。
 *
 * 只有 `viewBox` 的 SVG 在真实 Chromium 中会被解码为默认对象尺寸
 * （`naturalWidth/naturalHeight` 返回 150×150），所以自然尺寸无法区分「有内禀
 * 尺寸」与「无内禀尺寸」；能反映问题的是**渲染尺寸**：实测坍缩后为 0×0（预览面板）
 * 或 2×2（聊天 Markdown 的 1px 边框内侧）。4px 同时覆盖这两档实测值，又远小于
 * 任何有真实内容的图片，不会碰到正常图片。
 */
const COLLAPSED_RENDER_THRESHOLD_PX = 4;

/**
 * 可点击放大的图片触发器。
 *
 * 只负责「点击打开查看器」的动作、zoom-in 光标与 hover / active / focus-visible
 * 反馈；真正的大图查看由 `ImageLightbox` 承担，避免各页面重复实现。
 *
 * 无内禀尺寸的图片（例如只有 `viewBox` 的 SVG）没有内容基准，作为 flex 子项会被
 * 压到 0×0 / 2×2；加载完成后按**渲染尺寸**判定，命中时打上
 * `data-intrinsic-size="none"`，由 CSS 给一个可读的最小尺寸兜底。判定只在元素确实
 * 参与布局（有布局盒）时生效，所以「暂时不可见 / 尚未布局」的 0×0 不会被误判；
 * 有内禀尺寸的图片不命中该判定，尺寸与布局保持原样。
 */
export function ImageZoomTrigger({
  src,
  alt,
  onOpen,
  label = '放大查看图片',
  className,
  style,
  imageStyle,
  imageClassName,
  imageTitle,
  loading,
}: ImageZoomTriggerProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  /** 已判定为坍缩的图片来源；换图后与 `src` 不再相等，标记自然失效 */
  const [collapsedSrc, setCollapsedSrc] = useState<string | null>(null);
  /** 是否已完成加载：加载中的图片没有内容基准，此时测量会误判 */
  const loadedRef = useRef(false);
  const measureFrameRef = useRef(0);

  /** 按渲染尺寸判定坍缩；判定成立即打标记，且只打不撤（撤销会与 CSS 兜底互相触发抖动）。 */
  const detectCollapsedImage = (): void => {
    const image = imageRef.current;
    if (!image || !loadedRef.current) return;
    // 没有布局盒（display:none、还在隐藏容器里、尚未参与布局）时 rect 为 0 是
    // 「暂时不可见」的正常态，不能当作坍缩；只有确实参与布局才有判定意义。
    if (image.getClientRects().length === 0) return;
    const { width, height } = image.getBoundingClientRect();
    if (width < COLLAPSED_RENDER_THRESHOLD_PX && height < COLLAPSED_RENDER_THRESHOLD_PX) {
      setCollapsedSrc(src);
    }
  };

  /** 推迟到下一帧测量：此时图片解码与加载后的布局都已稳定。 */
  const measureCollapsedImage = (): void => {
    if (typeof requestAnimationFrame !== 'function') {
      detectCollapsedImage();
      return;
    }
    cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = 0;
      detectCollapsedImage();
    });
  };

  const handleImageLoad = (): void => {
    loadedRef.current = true;
    measureCollapsedImage();
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;

    // 换图 / 缓存命中：load 事件可能早于 handler 挂载，先同步一次加载状态。
    loadedRef.current = image.complete;
    if (loadedRef.current) measureCollapsedImage();

    // 尺寸变化（容器展开 / 收窄）后重测。
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            measureCollapsedImage();
          });
    resizeObserver?.observe(image);

    // 可见性变化（从隐藏容器 / 视口外进入可见区域）后重测。RO 只报告 content-box，
    // 「没有布局盒 → 坍缩盒」的 content-box 都是 0×0（2×2 只是边框盒），不会触发
    // RO，必须由 IO 兜住这条路径。
    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) measureCollapsedImage();
            }
          });
    intersectionObserver?.observe(image);

    return () => {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [src]);

  useEffect(
    () => () => {
      cancelAnimationFrame(measureFrameRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={label}
      className={className ? `image-zoom-trigger ${className}` : 'image-zoom-trigger'}
      onClick={onOpen}
      style={style}
      title={label}
    >
      <img
        alt={alt}
        className={
          imageClassName
            ? `image-zoom-trigger__image ${imageClassName}`
            : 'image-zoom-trigger__image'
        }
        data-intrinsic-size={collapsedSrc === src ? 'none' : undefined}
        ref={imageRef}
        onLoad={handleImageLoad}
        src={src}
        style={imageStyle}
        title={imageTitle}
        loading={loading}
      />
    </button>
  );
}
