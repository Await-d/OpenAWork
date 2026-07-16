import { lazy, type MouseEvent, Suspense, useMemo } from 'react';
import {
  buildPreviewDocument,
  getFilePreviewKind,
  getPreviewNote,
  getPreviewSandbox,
  getPreviewTitle,
  isBinaryPreviewKind,
  type FilePreviewKind,
} from '../../../utils/file/file-preview.js';
import { OfficePreview } from '../../office-preview/OfficePreview.js';
import '../../office-preview/office-preview.css';

export function FilePreviewPane({
  content,
  path,
  onContextMenu,
}: {
  content: string;
  path: string;
  onContextMenu?: (x: number, y: number) => void;
}) {
  const previewKind = getFilePreviewKind(path);

  const handleContextMenu = onContextMenu
    ? (e: MouseEvent<HTMLDivElement>) => {
        // Don't intercept right-click on the iframe / image / svg areas
        // where the browser's native context menu is more useful (image
        // save, link open, etc). We only attach the custom menu via the
        // outer wrapper so iframe content keeps its own.
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }
    : undefined;

  if (!previewKind) {
    return (
      <div
        onContextMenu={handleContextMenu}
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
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <OfficePreview path={path} />
      </div>
    );
  }
  if (isBinaryPreviewKind(previewKind)) {
    return (
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <BinaryFileNotice path={path} kind={previewKind} />
      </div>
    );
  }

  // Markdown preview
  if (previewKind === 'markdown') {
    return (
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <MarkdownPreview content={content} />
      </div>
    );
  }

  // SVG preview
  if (previewKind === 'svg') {
    return (
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <SvgPreview content={content} />
      </div>
    );
  }

  // Image preview (content is base64 or path-based — for file editor it's raw content)
  if (previewKind === 'image') {
    return (
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <ImagePreviewPane path={path} content={content} />
      </div>
    );
  }

  // JSON preview
  if (previewKind === 'json') {
    return (
      <div
        onContextMenu={handleContextMenu}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <JsonPreview content={content} />
      </div>
    );
  }

  // HTML / CSS / JS — iframe-based preview
  return (
    <div
      onContextMenu={handleContextMenu}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="file-editor-preview-body"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '10px 12px 12px',
          boxSizing: 'border-box',
          display: 'flex',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              background: 'var(--bg-overlay)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ color: 'var(--fg-strong)', fontSize: 11, fontWeight: 700 }}>
                {getPreviewTitle(previewKind)}
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}>
                {getPreviewNote(previewKind)}
              </span>
            </div>
            <span
              style={{
                flexShrink: 0,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              Live Preview
            </span>
          </div>
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
              background: 'var(--fg-on-accent)',
              display: 'block',
              boxShadow: '0 18px 36px var(--bg-base)',
            }}
          />
        </div>
      </div>
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

// Lazy inner component that actually imports and renders markdown
const MarkdownRendererInner = lazy(async () => {
  const [{ default: ReactMarkdownComp }, { default: remarkGfm }, { default: rehypeHighlight }] =
    await Promise.all([import('react-markdown'), import('remark-gfm'), import('rehype-highlight')]);

  function MarkdownRendererInnerComponent({ content }: { content: string }) {
    return (
      <ReactMarkdownComp
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
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
                padding: '8px 16px',
                borderLeft: '3px solid var(--accent)',
                background: 'color-mix(in oklch, var(--accent) 5%, transparent)',
                borderRadius: '0 6px 6px 0',
                color: 'var(--fg-default)',
              }}
            >
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
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
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre
              style={{
                margin: '12px 0',
                padding: '14px 16px',
                borderRadius: 8,
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                overflow: 'auto',
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '12px 0' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  fontSize: 13,
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                padding: '8px 12px',
                borderBottom: '2px solid var(--border-default)',
                textAlign: 'left',
                fontWeight: 600,
                fontSize: 12,
                background: 'var(--bg-overlay)',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 12,
              }}
            >
              {children}
            </td>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              {children}
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
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt ?? ''}
              style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdownComp>
    );
  }

  return { default: MarkdownRendererInnerComponent };
});

// ---------------------------------------------------------------------------
// SVG Preview
// ---------------------------------------------------------------------------
function SvgPreview({ content }: { content: string }) {
  return (
    <div
      data-testid="file-editor-svg-preview"
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
        SVG 预览 · {content.length} 字符
      </div>
      <div
        style={{
          maxWidth: '100%',
          maxHeight: 'calc(100% - 60px)',
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background:
            'repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg-base) 0% 50%) 50% / 16px 16px',
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG preview requires innerHTML
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(content) }}
      />
    </div>
  );
}

function sanitizeSvg(svg: string): string {
  // Remove script tags and event handlers from SVG for safety
  return svg
    .replace(/<script[\s>][\s\S]*?<\/script\s*>/giu, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/giu, '');
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
        <img
          src={src}
          alt={path.split('/').pop() ?? 'preview'}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: 4,
          }}
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
