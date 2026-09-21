import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { ImageZoomTrigger } from '../../common/display/ImageZoomTrigger.js';
import { ImageLightbox, type ImageLightboxItem } from '../image/image-lightbox.js';

/**
 * Markdown 图片查看器的接线。
 *
 * `react-markdown` 的 `img` 渲染器拿不到「同一段 Markdown 里的兄弟图片」，
 * 图集下标只能在解析阶段解决：`extractMarkdownImageUrls` 按出现顺序抽出全部
 * 图片 URL，再由图片渲染器用自己的 `src` 在该列表里定位下标。列表通过
 * Context 下发，避免每个 `img` 实例重复解析整段正文。
 */
const MarkdownImageUrlsContext = createContext<readonly string[]>([]);

export function MarkdownImageProvider({
  urls,
  children,
}: {
  urls: readonly string[];
  children: ReactNode;
}) {
  return <MarkdownImageUrlsContext value={urls}>{children}</MarkdownImageUrlsContext>;
}

/**
 * 「当前图片位于链接内」标记。
 *
 * `[![alt](img)](href)` 会被 react-markdown 渲染成 `<a>` 包 `<img>`；若图片仍是
 * 可点击触发器，就会形成 `<a><button>` 的嵌套交互元素（axe nested-interactive），
 * 且点击会同时打开灯箱并触发锚点跳转（外部链接还会因 `target="_blank"` 多开一页）。
 * 由 Markdown 的 `a` 渲染器用本 Context 把 `children` 包住置为 `true`，图片据此回退
 * 为纯 `<img>`；不套 Provider 的独立使用（默认 `false`）行为保持不变。
 */
export const MarkdownImageInsideLinkContext = createContext(false);

export interface MarkdownImageProps {
  src?: string;
  alt?: string;
  /** Markdown 原有的 title（`![alt](url "title")`），保留为图片原生提示 */
  title?: string;
  /** 调用方既有的图片样式（Markdown 预览面板的圆角 / 间距等） */
  imageStyle?: CSSProperties;
}

/**
 * Markdown `img` 渲染器：点击（或键盘 Enter / Space）打开 `ImageLightbox`；
 * 同一段 Markdown 有多个图片时，打开任意一张都携带完整图集，支持左右切换。
 */
export function MarkdownImage({ src, alt, title, imageStyle }: MarkdownImageProps) {
  const urls = useContext(MarkdownImageUrlsContext);
  const insideLink = useContext(MarkdownImageInsideLinkContext);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // 空地址（被 react-markdown 过滤掉的危险协议等）保持默认渲染，不接查看器；
  // 链接内的图片同理回退为纯 `<img>`，把点击留给 `<a>` 的跳转语义。
  if (!src || insideLink) {
    return <img src={src} alt={alt ?? ''} title={title} style={imageStyle} loading="lazy" />;
  }

  // 抽不到下标（URL 被转义 / 解码改写）时退化为单图查看器，可点击能力不丢。
  const galleryIndex = urls.indexOf(src);
  const items: readonly ImageLightboxItem[] =
    galleryIndex >= 0
      ? urls.map((url) => (url === src ? { src: url, alt } : { src: url }))
      : [{ src, alt }];
  const altText = alt?.trim() ?? '';

  return (
    <>
      <ImageZoomTrigger
        src={src}
        alt={alt ?? ''}
        label={altText === '' ? '放大查看图片' : `放大查看图片：${altText}`}
        imageTitle={title}
        loading="lazy"
        imageStyle={imageStyle}
        onOpen={() => {
          setIndex(galleryIndex >= 0 ? galleryIndex : 0);
          setOpen(true);
        }}
      />
      <ImageLightbox
        open={open}
        items={items}
        index={index}
        onIndexChange={setIndex}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
