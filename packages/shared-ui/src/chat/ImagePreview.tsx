import type { CSSProperties } from 'react';
import { color, radius } from '../tokens.js';

export interface ImagePreviewProps {
  src: string;
  alt?: string;
  caption?: string;
  onRemove?: () => void;
  /**
   * 点击 / 键盘激活缩略图时打开放大查看器。
   *
   * 可选：缺省时缩略图保持纯展示，行为与旧版完全一致——shared-ui 不感知
   * 查看器实现，图集索引与开关由消费方（apps/web）负责。
   */
  onOpen?: () => void;
  /** 放大查看按钮的无障碍名称，默认「放大查看图片」。 */
  openLabel?: string;
  maxWidth?: number;
  style?: CSSProperties;
}

const imageStyle: CSSProperties = {
  maxWidth: '100%',
  borderRadius: 8,
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  display: 'block',
};

const zoomButtonStyle: CSSProperties = {
  // 背景经自定义属性间接引用，注入样式的 :hover / :active 才能真正覆盖生效；
  // 默认态回退 transparent，与旧版视觉逐像素一致。
  background: 'var(--openawork-image-preview-zoom-bg, transparent)',
  border: 'none',
  borderRadius: radius.md,
  cursor: 'zoom-in',
  display: 'block',
  maxWidth: '100%',
  padding: 0,
};

/**
 * 移除按钮压在任意图片内容上：用中性浮层色（`--bg-elevated` + `--fg-strong` +
 * `--border-emphasis`）替代深色遮罩 + accent 文字色——暗色主题下 `--fg-on-accent`
 * 近黑，压在遮罩上不可见，该 token 只允许用在 accent 实色填充之上。
 *
 * 背景 / 描边经自定义属性间接引用：内联声明优先级高于样式表，直接写死 token 会让
 * 注入样式的 `:hover` / `:active` 永不生效；变量缺省时回退默认态 token。
 */
const removeButtonStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: `var(--openawork-image-preview-remove-bg, ${color.bgElevated})`,
  border: `1px solid var(--openawork-image-preview-remove-border, ${color.borderEmphasis})`,
  boxSizing: 'border-box',
  color: color.fgStrong,
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1,
};

/**
 * shared-ui 没有 CSS 资源，交互态以模块级 `<style>` 单例注入并作用域限定在
 * `data-openawork-image-preview` 内（与 MCPServerConfig 的 focus-visible
 * 注入方式一致），保证 hover / active / focus-visible 三态齐全。
 */
const imagePreviewCss = `
[data-openawork-image-preview] [data-image-preview-zoom]:hover {
  --openawork-image-preview-zoom-bg: var(--accent-subtle);
}

[data-openawork-image-preview] [data-image-preview-zoom]:active {
  --openawork-image-preview-zoom-bg: var(--accent-muted);
}

[data-openawork-image-preview] [data-image-preview-zoom]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}

[data-openawork-image-preview] > button:not([data-image-preview-zoom]):hover {
  --openawork-image-preview-remove-bg: var(--bg-hover);
  --openawork-image-preview-remove-border: var(--border-strong);
}

[data-openawork-image-preview] > button:not([data-image-preview-zoom]):active {
  --openawork-image-preview-remove-bg: var(--bg-active);
}

[data-openawork-image-preview] > button:not([data-image-preview-zoom]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
`;

const IMAGE_PREVIEW_STYLE_ATTR = 'data-image-preview-styles';

let imagePreviewStyleInjected = false;

/** 模块级单例：composer 的 N 张缩略图只会在 `document.head` 留下一份样式。 */
function ensureImagePreviewStyles(): void {
  if (imagePreviewStyleInjected || typeof document === 'undefined') return;
  const styleElement = document.createElement('style');
  styleElement.setAttribute(IMAGE_PREVIEW_STYLE_ATTR, 'true');
  styleElement.textContent = imagePreviewCss;
  document.head.appendChild(styleElement);
  imagePreviewStyleInjected = true;
}

export function ImagePreview({
  src,
  alt,
  caption,
  onRemove,
  onOpen,
  openLabel = '放大查看图片',
  maxWidth = 320,
  style,
}: ImagePreviewProps) {
  // 交互态样式按需懒注入（模块级单例）。刻意不用 useEffect：shared-ui 与 apps/web
  // 各自解析出一份 react，跨包消费时 hooks 会拿到 null dispatcher；幂等的纯函数注入
  // 不依赖 hooks，两个宿主都安全。纯展示实例不注入任何样式，与旧版渲染逐元素一致。
  if (onOpen || onRemove) ensureImagePreviewStyles();

  return (
    <div
      data-openawork-image-preview={onOpen ? 'true' : undefined}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 4,
        position: 'relative',
        maxWidth,
        ...style,
      }}
    >
      {onRemove && (
        <button type="button" onClick={onRemove} style={removeButtonStyle}>
          ×
        </button>
      )}
      {onOpen ? (
        <button
          type="button"
          data-image-preview-zoom="true"
          aria-label={openLabel}
          title={openLabel}
          onClick={onOpen}
          style={zoomButtonStyle}
        >
          <img src={src} alt={alt ?? ''} style={imageStyle} />
        </button>
      ) : (
        <img src={src} alt={alt ?? ''} style={imageStyle} />
      )}
      {caption && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-muted)',
            textAlign: 'center',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
