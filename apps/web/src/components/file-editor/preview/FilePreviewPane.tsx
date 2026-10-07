import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Components } from 'react-markdown';
import {
  buildPreviewDocument,
  getFilePreviewKind,
  getPreviewSandbox,
  getPreviewTitle,
  isBinaryPreviewKind,
  type FilePreviewKind,
} from '../../../utils/file/file-preview.js';
import { ImageZoomTrigger } from '../../common/display/ImageZoomTrigger.js';
import { ImageLightbox } from '../../chat/image/image-lightbox.js';
import {
  MarkdownImage,
  MarkdownImageInsideLinkContext,
  MarkdownImageProvider,
} from '../../chat/markdown/markdown-image.js';
import { extractMarkdownImageUrls } from '../../chat/markdown/markdown-image-urls.js';
import { getCodeFenceText, getTrimmedCodeFenceText } from '../../chat/markdown/code-fence-text.js';
import { ChatMarkdownTable } from '../../chat/markdown/chat-markdown-table.js';
import { normalizeTableCellAlign } from '../../chat/markdown/markdown-message-content.js';
import {
  buildExportableSvg,
  isMermaidFenceLanguage,
} from '../../chat/markdown/mermaid-diagram-meta.js';
import { useMarkdownThemeTokens } from '../../chat/markdown/use-markdown-theme.js';
import { tryOpenLinkPreview } from '../../../utils/preview/link-preview.js';
import { resolveSvgIntrinsicSize } from '../../../utils/svg/resolve-svg-intrinsic-size.js';
import { sanitizeSvg } from '../../../utils/svg/sanitize-svg.js';
import { OfficePreview } from '../../office-preview/OfficePreview.js';
import { ChartPreview } from './ChartPreview.js';
import { CopyButton } from './CopyButton.js';
import { CsvPreview } from './CsvPreview.js';
import { PreviewToolbar, ZoomControls } from './PreviewToolbar.js';
import { TextPreview } from './TextPreview.js';
import { usePreviewZoom } from './use-preview-zoom.js';
import '../../office-preview/office-preview.css';

/**
 * 文件内容预览：按类型分发到具体渲染器（Markdown / 图表 / 矢量图 / 图片 /
 * 表格 / 纯文本 / JSON / Office / 二进制提示 / iframe 沙箱）。
 *
 * 这里**不**处理右键菜单 —— 调用方用 `ContentContextMenuHost` 包住本组件，
 * 即可同时获得右键与键盘（菜单键 / Shift+F10）呼出的菜单，菜单项与锚点计算
 * 都收敛在那个宿主里，避免每个预览面各写一份。
 */
export function FilePreviewPane({ content, path }: { content: string; path: string }) {
  const previewKind = getFilePreviewKind(path);

  if (!previewKind) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: 'var(--fg-muted)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        当前文件类型暂不支持预览。
      </div>
    );
  }

  // Binary kinds (office docs, pdf, archives) — server reads them as
  // utf-8 which produces mojibake. Office docs go through dedicated
  // renderers (mammoth / SheetJS); archives keep the friendly notice.
  if (previewKind === 'binary-office' || previewKind === 'binary-pdf') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <OfficePreview path={path} />
      </div>
    );
  }
  if (isBinaryPreviewKind(previewKind)) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <BinaryFileNotice path={path} kind={previewKind} />
      </div>
    );
  }

  // Markdown preview
  if (previewKind === 'markdown') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <MarkdownPreview content={content} />
      </div>
    );
  }

  // Mermaid 图表源码（.mmd / .mermaid）
  if (previewKind === 'chart') {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 16px',
          boxSizing: 'border-box',
          background: 'var(--bg-overlay)',
        }}
      >
        <ChartPreview
          code={content}
          fileName={path
            .split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '')}
        />
      </div>
    );
  }

  // SVG preview
  if (previewKind === 'svg') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <SvgPreview content={content} path={path} />
      </div>
    );
  }

  // Image preview (content is base64 or path-based — for file editor it's raw content)
  if (previewKind === 'image') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ImagePreviewPane path={path} content={content} />
      </div>
    );
  }

  // JSON preview
  if (previewKind === 'json') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <JsonPreview content={content} />
      </div>
    );
  }

  // CSV / TSV — 首行表头 + 数据行表格
  if (previewKind === 'table') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <CsvPreview content={content} delimiter={path.endsWith('.tsv') ? '\t' : ','} path={path} />
      </div>
    );
  }

  // 纯文本（txt / log / yaml / xml / sql …）— 行号 + 语法高亮
  if (previewKind === 'text') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <TextPreview content={content} path={path} />
      </div>
    );
  }

  // HTML / CSS / JS — iframe-based preview
  // 预览类型标题条已移除：它只重复「这是 HTML/CSS/JS 预览」+ 隔离说明，占掉的
  // 垂直空间比信息量重要得多。iframe 因此直接铺满面板，外边距压到 6px —— 留这一
  // 圈只是为了让 iframe 的圆角与投影不被面板 overflow 裁掉。
  return (
    <div
      data-testid="file-editor-preview-body"
      style={{
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        padding: 6,
        background: 'var(--bg-base)',
        overflow: 'hidden',
      }}
    >
      <iframe
        data-testid="file-editor-preview-frame"
        title={getPreviewTitle(previewKind)}
        sandbox={getPreviewSandbox(previewKind)}
        referrerPolicy="no-referrer"
        loading="lazy"
        srcDoc={buildPreviewDocument(previewKind, content)}
        style={{
          flex: 1,
          minHeight: 320,
          width: '100%',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          // 沙箱 srcdoc 不继承宿主 CSS 变量：iframe 元素本身也用字面浅色纸底，
          // 避免暗色主题下「近黑底 + 初始黑字」。
          background: '#ffffff',
          display: 'block',
          boxShadow: '0 18px 36px var(--bg-base)',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown Preview
// ---------------------------------------------------------------------------
function MarkdownPreview({ content }: { content: string }) {
  return (
    <div
      data-testid="file-editor-markdown-preview"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '20px 24px',
        background: 'var(--bg-overlay)',
      }}
    >
      <div
        className="markdown-preview-content"
        style={{
          maxWidth: 720,
          margin: '0 auto',
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--text-1)',
          wordBreak: 'break-word',
        }}
      >
        <Suspense
          fallback={<div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>加载渲染器…</div>}
        >
          <MarkdownRenderer content={content} />
        </Suspense>
      </div>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  // We need to dynamically import and use the plugins
  // Since react-markdown, remark-gfm, rehype-highlight are already in deps
  return (
    <Suspense fallback={<pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{content}</pre>}>
      <MarkdownRendererInner content={content} />
    </Suspense>
  );
}

/**
 * 标记「当前 `code` 位于 `pre` 之内」，即围栏代码块而非行内代码。
 *
 * 与聊天侧同一个坑：react-markdown 不给**无语言标注**的围栏加
 * `language-*`，此时 className 是 undefined，与行内代码无法区分。只看
 * className 就会把 ASCII 树形图 / 日志片段渲染成 `inline-block` 行内代码，
 * 换行被折叠成一团。`pre` 先于 `code` 执行，在子树里 provide 该标记即可。
 */
const PreBlockContext = createContext(false);

const markdownPreviewComponents: Components = {
  h1: ({ children }) => (
    <h1
      style={{
        fontSize: 24,
        fontWeight: 700,
        margin: '24px 0 12px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: 8,
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        fontSize: 20,
        fontWeight: 600,
        margin: '20px 0 10px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: 6,
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px' }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: 14, fontWeight: 600, margin: '12px 0 6px' }}>{children}</h4>
  ),
  p: ({ children }) => <p style={{ margin: '8px 0', lineHeight: 1.7 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '8px 0', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '12px 0',
        padding: '12px 16px',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-raised)',
        borderRadius: '6px',
        boxShadow: 'var(--shadow-sm)',
        color: 'var(--fg-strong)',
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const inPreBlock = useContext(PreBlockContext);
    // 在 pre 内 = 围栏代码块；不在 pre 内 = 行内代码。仅看 className 会把
    // 无语言围栏（无 language-* className）误判成行内代码。
    if (!inPreBlock) {
      return (
        <code
          style={{
            padding: '2px 5px',
            borderRadius: 4,
            background: 'color-mix(in oklch, var(--text-1) 8%, transparent)',
            fontSize: '0.88em',
            fontFamily: 'var(--font-mono, monospace)',
          }}
          {...props}
        >
          {children}
        </code>
      );
    }

    // 图表围栏走图表渲染器，与消息内渲染保持一致（含 ```flowchart 这类
    // 直接把图表类型当语言名的写法）。
    const language = /language-([\w-]+)/.exec(className ?? '')?.[1]?.toLowerCase();
    if (isMermaidFenceLanguage(language)) {
      return <ChartPreview code={getTrimmedCodeFenceText(children)} inline />;
    }

    // 围栏块自己包 <pre>：图表分支要独占这一层，外层 pre 因此改为直通。
    // 工具栏只取语言与行数两项信息——文档预览是「读代码」的场景，行号槽会
    // 挤占本就有限的宽度；需要逐行对照时左侧编辑器里有 Monaco + 行号。
    const source = getCodeFenceText(children);
    // react-markdown 会在围栏末尾补一个换行，算行数前去掉，否则恒多 1 行。
    const lineCount = source.replace(/\n$/, '').split('\n').length;
    return (
      <div className="oaw-code-block">
        <div className="oaw-code-block-toolbar">
          <div className="oaw-preview-toolbar-meta">
            <span className="oaw-preview-label">{language ? language.toUpperCase() : 'CODE'}</span>
            <span className="oaw-preview-badge">{lineCount} 行</span>
          </div>
          <div className="oaw-preview-actions">
            <CopyButton text={source} label="复制代码" testId="file-editor-code-copy" />
          </div>
        </div>
        <pre className="oaw-code-block-pre">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },
  pre: ({ children }) => (
    <PreBlockContext.Provider value={true}>{children}</PreBlockContext.Provider>
  ),
  // 表格复用聊天侧同一个组件：sticky 表头、斑马纹、列对齐、列多时紧凑密度、
  // 横向渐隐提示、复制 TSV / 下载 CSV 工具栏全部一致。此前的裸内联样式表格
  // 缺这些，观感与消息里的表格差一截。
  table: ({ node, children }) => <ChatMarkdownTable node={node}>{children}</ChatMarkdownTable>,
  // th/td 只负责挂类名与列对齐，视觉全在 markdown-table.css 里。
  th: ({ children, style }) => (
    <th
      className="chat-markdown-th"
      data-align={normalizeTableCellAlign(style?.textAlign)}
      scope="col"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="chat-markdown-td" data-align={normalizeTableCellAlign(style?.textAlign)}>
      {children}
    </td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--accent)', textDecoration: 'underline' }}
      onClick={(event) => tryOpenLinkPreview(event, href)}
    >
      <MarkdownImageInsideLinkContext value={true}>{children}</MarkdownImageInsideLinkContext>
    </a>
  ),
  hr: () => (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid var(--border-subtle)',
        margin: '16px 0',
      }}
    />
  ),
  img: ({ src, alt, title }) => (
    <MarkdownImage
      src={src}
      alt={alt}
      title={title}
      imageStyle={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }}
    />
  ),
};

// Lazy inner component that actually imports and renders markdown
const MarkdownRendererInner = lazy(async () => {
  const [{ default: ReactMarkdownComp }, { default: remarkGfm }, { default: rehypeHighlight }] =
    await Promise.all([import('react-markdown'), import('remark-gfm'), import('rehype-highlight')]);

  function MarkdownRendererInnerComponent({ content }: { content: string }) {
    return (
      <MarkdownImageProvider urls={extractMarkdownImageUrls(content)}>
        <ReactMarkdownComp
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownPreviewComponents}
        >
          {content}
        </ReactMarkdownComp>
      </MarkdownImageProvider>
    );
  }

  return { default: MarkdownRendererInnerComponent };
});

// ---------------------------------------------------------------------------
// SVG Preview
// ---------------------------------------------------------------------------
function SvgPreview({ content, path }: { content: string; path: string }) {
  // 净化后才能量尺寸：脏 SVG 里可能有解析失败的片段，先净化再取 viewBox。
  const sanitized = useMemo(() => sanitizeSvg(content), [content]);
  const intrinsic = useMemo(() => resolveSvgIntrinsicSize(sanitized), [sanitized]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { zoom, zoomIn, zoomOut, resetZoom, fit } = usePreviewZoom(viewportRef, intrinsic);
  const [showSource, setShowSource] = useState(false);
  const tokens = useMarkdownThemeTokens();

  const badge = intrinsic
    ? `${Math.round(intrinsic.width)} × ${Math.round(intrinsic.height)}`
    : `${content.length} 字符`;

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(content).catch(() => undefined);
  }, [content]);

  const handleDownload = useCallback(() => {
    const payload = buildExportableSvg(sanitized, tokens.bgRaised);
    const blob = new Blob([payload], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${path.split('/').pop() ?? 'diagram'}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [sanitized, tokens.bgRaised, path]);

  const canZoom = intrinsic !== null;

  return (
    <div
      className="oaw-preview"
      data-testid="file-editor-svg-preview"
      style={{ padding: 12, boxSizing: 'border-box', background: 'var(--bg-overlay)' }}
    >
      <PreviewToolbar label="SVG" badge={badge}>
        <button
          type="button"
          className="oaw-preview-btn"
          aria-pressed={!showSource}
          onClick={() => setShowSource((value) => !value)}
        >
          {showSource ? '查看图形' : '查看源码'}
        </button>
        {!showSource && canZoom && (
          <ZoomControls
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetZoom}
            onFit={fit}
            label="矢量图缩放"
          />
        )}
        {!showSource && (
          <button type="button" className="oaw-preview-btn" onClick={handleDownload}>
            下载 SVG
          </button>
        )}
        <button type="button" className="oaw-preview-btn" onClick={handleCopy}>
          复制源码
        </button>
      </PreviewToolbar>

      {showSource ? (
        <pre className="oaw-preview-source">{content}</pre>
      ) : sanitized === '' ? (
        <div className="oaw-preview-status">
          该 SVG 无法解析或体积超出上限，已跳过渲染。可切换为源码查看原文。
        </div>
      ) : canZoom ? (
        <div
          ref={viewportRef}
          className="oaw-preview-figure oaw-preview-figure--checker"
          data-testid="file-editor-svg-figure"
        >
          <div
            className="oaw-preview-canvas"
            style={{ width: intrinsic.width * zoom, height: intrinsic.height * zoom }}
          >
            <div
              className="oaw-preview-scaled"
              style={{
                width: intrinsic.width,
                height: intrinsic.height,
                transform: `scale(${zoom})`,
              }}
              // 内容已由白名单净化器 sanitizeSvg 清洗（剥离脚本、事件属性与外链）
              dangerouslySetInnerHTML={{ __html: sanitized }}
            />
          </div>
        </div>
      ) : (
        // 无 viewBox / width-height：按容器宽度自适应，不假装有固有尺寸。
        <div
          className="oaw-preview-figure oaw-preview-figure--fluid oaw-preview-figure--checker"
          data-testid="file-editor-svg-figure"
          // 内容已由白名单净化器 sanitizeSvg 清洗（剥离脚本、事件属性与外链）
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      )}
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function encodeUtf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function looksLikeBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function resolveImagePreviewSrc(content: string, mimeType: string): string {
  const trimmed = content.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }
  if (looksLikeBase64(trimmed)) {
    return `data:${mimeType};base64,${trimmed}`;
  }
  return `data:${mimeType};base64,${encodeUtf8ToBase64(content)}`;
}

// ---------------------------------------------------------------------------
// Image Preview (for binary files loaded as base64 or data URLs)
// ---------------------------------------------------------------------------
function ImagePreviewPane({ path, content }: { path: string; content: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
  const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const src = resolveImagePreviewSrc(content, mimeType);
  const fileName = path.split('/').pop() ?? 'preview';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <div
      data-testid="file-editor-image-preview"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg-overlay)',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          marginBottom: 12,
          fontSize: 10,
          color: 'var(--fg-muted)',
          fontWeight: 500,
        }}
      >
        图片预览 · {ext.toUpperCase()}
      </div>
      <div
        style={{
          maxWidth: '100%',
          maxHeight: 'calc(100% - 60px)',
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background:
            'repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg-base) 0% 50%) 50% / 16px 16px',
        }}
      >
        <ImageZoomTrigger
          src={src}
          alt={fileName}
          label={`放大查看图片：${fileName}`}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          imageStyle={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: 4,
          }}
          onOpen={() => setLightboxOpen(true)}
        />
        <ImageLightbox
          open={lightboxOpen}
          src={src}
          alt={fileName}
          caption={fileName}
          fileName={fileName}
          onClose={() => setLightboxOpen(false)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON Preview
// ---------------------------------------------------------------------------
function JsonPreview({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }, [content]);

  const stats = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return `数组 · ${parsed.length} 项`;
      if (typeof parsed === 'object' && parsed !== null)
        return `对象 · ${Object.keys(parsed).length} 个键`;
      return typeof parsed;
    } catch {
      return '解析失败';
    }
  }, [content]);

  return (
    <div
      data-testid="file-editor-json-preview"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-overlay)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-default)' }}>
          JSON 格式化预览
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{stats}</span>
      </div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '16px 20px',
          overflowY: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--text-1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <JsonHighlighted json={formatted} />
      </pre>
    </div>
  );
}

function JsonHighlighted({ json }: { json: string }) {
  // Simple syntax highlighting for JSON
  const highlighted = json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color: var(--accent)">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color: var(--success)">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color: var(--aux)">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span style="color: var(--danger)">$1</span>')
    .replace(/:\s*(null)/g, ': <span style="color: var(--fg-muted)">$1</span>');

  // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON highlighting is safe (content is from JSON.stringify)
  return <code dangerouslySetInnerHTML={{ __html: highlighted }} />;
}

// ---------------------------------------------------------------------------
// Binary file notice — Office docs / PDFs / archives can't be safely shown
// as text. The gateway's readFile is a utf-8 decode, so the bytes we get
// back for these files are mojibake. Render a clear placeholder so the
// user understands the file exists but isn't text-previewable yet.
// ---------------------------------------------------------------------------
function BinaryFileNotice({ path, kind }: { path: string; kind: FilePreviewKind }) {
  const ext = (path.split('.').pop() ?? '').toUpperCase();
  const kindLabel =
    kind === 'binary-office'
      ? 'Office 文档'
      : kind === 'binary-pdf'
        ? 'PDF 文档'
        : kind === 'binary-archive'
          ? '压缩包'
          : '二进制文件';
  const tip =
    kind === 'binary-office'
      ? '这是 Office 二进制文档（Word / Excel / PowerPoint）。文本预览会显示乱码，建议在系统中用对应程序打开。'
      : kind === 'binary-pdf'
        ? '这是 PDF 二进制文档。请在系统中用 PDF 阅读器打开。'
        : kind === 'binary-archive'
          ? '这是压缩归档（zip / tar / 7z 等）。请在文件管理器中解压后再查看其中文件。'
          : '该文件为二进制内容，无法以文本方式预览。';
  const filename = path.split('/').pop() ?? path;
  return (
    <div
      data-testid="file-editor-binary-notice"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg-overlay)',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'color-mix(in oklch, var(--accent) 12%, var(--bg-overlay))',
          color: 'var(--accent)',
          fontSize: 24,
        }}
      >
        📄
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
        {kindLabel} · {ext}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          maxWidth: 400,
          wordBreak: 'break-all',
        }}
      >
        {filename}
      </div>
      <div
        style={{
          maxWidth: 360,
          fontSize: 12,
          color: 'var(--fg-default)',
          lineHeight: 1.6,
        }}
      >
        {tip}
      </div>
    </div>
  );
}
