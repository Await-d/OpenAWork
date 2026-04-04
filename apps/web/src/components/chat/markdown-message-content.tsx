import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const CHAT_PREVIEW_MIN_HEIGHT = 360;
const PREVIEW_RESIZE_MSG_TYPE = 'oaw-preview-resize';

type StaticPreviewKind = 'html' | 'css' | 'javascript';

export default function MarkdownMessageContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [] : [rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="chat-markdown-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="chat-markdown-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="chat-markdown-h3">{children}</h3>,
  p: ({ children }) => <p className="chat-markdown-p">{children}</p>,
  ul: ({ children }) => <ul className="chat-markdown-ul">{children}</ul>,
  ol: ({ children }) => <ol className="chat-markdown-ol">{children}</ol>,
  li: ({ children }) => <li className="chat-markdown-li">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="chat-markdown-blockquote">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="chat-markdown-table-wrap">
      <table className="chat-markdown-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="chat-markdown-th">{children}</th>,
  td: ({ children }) => <td className="chat-markdown-td">{children}</td>,
  a: ({ children, href }) => (
    <a className="chat-markdown-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ children, className, ...props }) => {
    const match = /language-([\w-]+)/.exec(className ?? '');
    const codeContent = normalizeCodeChildren(children);

    if (!match && !className) {
      return (
        <code className="chat-markdown-inline-code" {...props}>
          {children}
        </code>
      );
    }

    const rawLanguage = match?.[1]?.toLowerCase();
    const language = rawLanguage?.toUpperCase();

    if (isThinkingLanguage(rawLanguage)) {
      return <ThinkingCodeBlock codeContent={codeContent} codeProps={props} />;
    }

    const previewKind = getStaticPreviewKind(rawLanguage);
    if (previewKind) {
      return (
        <StaticPreviewCodeBlock
          codeContent={codeContent}
          codeProps={props}
          className={className}
          language={language}
          previewKind={previewKind}
        />
      );
    }

    return (
      <div className="chat-markdown-code-block">
        <div className="chat-markdown-code-toolbar">
          <div className="chat-markdown-code-label">{language ?? 'CODE'}</div>
          <button
            type="button"
            data-testid="chat-markdown-code-copy"
            className="chat-markdown-code-copy"
            onClick={() => {
              const copyRequest = navigator.clipboard?.writeText(
                getCopyableCodeText(codeContent).replace(/\n$/, ''),
              );
              void copyRequest?.catch(() => undefined);
            }}
          >
            复制代码
          </button>
        </div>
        <pre className="chat-markdown-pre">
          <code className={className} {...props}>
            {codeContent}
          </code>
        </pre>
      </div>
    );
  },
};

function normalizeCodeChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    return children.replace(/\n$/, '');
  }

  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') {
    return children[0].replace(/\n$/, '');
  }

  return children;
}

function getCopyableCodeText(content: ReactNode): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => getCopyableCodeText(item)).join('');
  }

  if (!content || typeof content === 'boolean' || typeof content === 'number') {
    return content == null ? '' : String(content);
  }

  if (typeof content === 'object' && 'props' in content) {
    const props = content.props as { children?: ReactNode };
    return getCopyableCodeText(props.children);
  }

  return '';
}

function isThinkingLanguage(language: string | undefined): boolean {
  return (
    language === 'think' ||
    language === 'thinking' ||
    language === 'reasoning' ||
    language === 'thought' ||
    language === 'thoughts'
  );
}

function getStaticPreviewKind(language: string | undefined): StaticPreviewKind | null {
  if (language === 'html') {
    return 'html';
  }

  if (language === 'css') {
    return 'css';
  }

  if (language === 'javascript' || language === 'js') {
    return 'javascript';
  }

  return null;
}

const RESIZE_SCRIPT = `<script>
(function () {
  function postHeight() {
    var h = document.documentElement.scrollHeight;
    if (h > 0) {
      parent.postMessage({ type: '${PREVIEW_RESIZE_MSG_TYPE}', height: h }, '*');
    }
  }

  postHeight();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(postHeight).observe(document.body);
  }

  window.addEventListener('load', postHeight);

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(postHeight).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }
})();
<\/script>`;

function isFullHtmlDocument(code: string): boolean {
  const trimmed = code.trimStart().slice(0, 200).toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function buildFullPagePreview(code: string): string {
  const safe = stripScriptTags(code);
  const baseTag = '<base href="about:srcdoc" target="_blank">';

  if (/<head[\s>]/iu.test(safe)) {
    const withBase = safe.replace(/(<head[^>]*>)/iu, `$1\n    ${baseTag}`);
    return withBase.replace(/<\/body\s*>/iu, `${RESIZE_SCRIPT}\n</body>`);
  }

  if (/<html[\s>]/iu.test(safe)) {
    const withHead = safe.replace(/(<html[^>]*>)/iu, `$1\n<head>${baseTag}</head>`);
    return withHead.replace(/<\/body\s*>/iu, `${RESIZE_SCRIPT}\n</body>`);
  }

  return `<!DOCTYPE html>
<html><head>${baseTag}</head>
<body>${safe}${RESIZE_SCRIPT}</body></html>`;
}

function buildPreviewDocument(previewKind: StaticPreviewKind, code: string): string {
  if (previewKind === 'html' && isFullHtmlDocument(code)) {
    return buildFullPagePreview(code);
  }

  const safeCode = previewKind === 'html' ? stripScriptTags(code) : code;
  const previewBody =
    previewKind === 'css'
      ? buildCssPreviewBody()
      : previewKind === 'javascript'
        ? buildJavascriptPreviewBody()
        : safeCode;
  const previewHead =
    previewKind === 'css'
      ? `<style>
${escapeForStyleTag(code)}
      </style>`
      : '';
  const previewScript =
    previewKind === 'javascript'
      ? `<script>
      (function () {
        const report = function (message) {
          const errorBox = document.getElementById('preview-errors');
          if (!errorBox) {
            return;
          }

          errorBox.hidden = false;
          errorBox.textContent = message;
        };

        window.addEventListener('error', function (event) {
          report('脚本执行失败：' + (event.message || '未知错误'));
        });

        try {
${escapeForInlineScript(code)}
        } catch (error) {
          report('脚本执行失败：' + (error && error.message ? error.message : String(error)));
        }
      })();
      <\/script>`
      : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="about:srcdoc" target="_blank">
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
        background: #ffffff;
        color: #111827;
      }

      body {
        padding: 12px;
        font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      }
    </style>
    ${previewHead}
  </head>
  <body>
${previewBody}
    ${previewScript}
    ${RESIZE_SCRIPT}
  </body>
</html>`;
}

function escapeForStyleTag(code: string): string {
  return code.replace(/<\/style/giu, '<\\/style');
}

function escapeForInlineScript(code: string): string {
  return code.replace(/<\/script/giu, '<\\/script');
}

function stripScriptTags(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script\s*>/giu, '')
    .replace(/<script[^>]*\/\s*>/giu, '');
}

function buildCssPreviewBody(): string {
  return `<main class="oa-css-preview-shell">
  <section class="oa-css-preview-hero">
    <span class="oa-css-preview-kicker">CSS Preview</span>
    <h1>前端样式效果预览</h1>
    <p>当前展示的是一组固定示例元素，方便直接观察颜色、层次、圆角、阴影与排版变化。</p>
    <div class="oa-css-preview-actions">
      <button class="demo-button" type="button">主按钮</button>
      <a class="demo-link" href="https://example.com">辅助链接</a>
    </div>
  </section>
  <section class="oa-css-preview-grid">
    <article class="oa-css-preview-card demo-card">
      <strong>统计卡片</strong>
      <p>支持观察容器、标题、正文与 badge 的样式组合。</p>
      <span class="oa-css-preview-badge">新增能力</span>
    </article>
    <article class="oa-css-preview-card demo-card">
      <label class="oa-css-preview-field demo-field">
        <span>搜索输入</span>
        <input class="demo-input" type="text" placeholder="输入关键字" />
      </label>
      <ul>
        <li>列表项 A</li>
        <li>列表项 B</li>
        <li>列表项 C</li>
      </ul>
    </article>
  </section>
</main>`;
}

function buildJavascriptPreviewBody(): string {
  return `<main class="oa-js-preview-shell demo-shell">
  <section class="oa-js-preview-stage demo-card">
    <span class="oa-js-preview-kicker">JavaScript Preview</span>
    <h1 id="preview-title">脚本预览基座</h1>
    <p id="preview-copy">这里是隔离沙箱中的演示 DOM，可供脚本直接操作。</p>
    <div class="oa-js-preview-actions">
      <button id="preview-button" class="demo-button" type="button">主按钮</button>
      <span id="preview-badge" class="oa-css-preview-badge">待运行</span>
    </div>
    <pre id="preview-errors" hidden></pre>
  </section>
</main>`;
}

function getPreviewBadgeLabel(previewKind: StaticPreviewKind): string {
  if (previewKind === 'css') {
    return '样式预览';
  }

  if (previewKind === 'javascript') {
    return '脚本预览';
  }

  return '静态预览';
}

function getPreviewTitle(previewKind: StaticPreviewKind): string {
  if (previewKind === 'css') {
    return 'CSS 预览';
  }

  if (previewKind === 'javascript') {
    return 'JavaScript 预览';
  }

  return 'HTML 预览';
}

function getPreviewNote(previewKind: StaticPreviewKind): string {
  if (previewKind === 'css') {
    return '当前使用固定示例骨架承载样式效果，便于安全观察布局、颜色和组件外观变化。';
  }

  if (previewKind === 'javascript') {
    return '当前脚本仅在隔离 iframe 中运行：允许脚本执行，但不会获得宿主页同源权限。';
  }

  return '安全沙箱预览：用户脚本已移除，外链将在新窗口打开。';
}

function getPreviewSandbox(_previewKind: StaticPreviewKind): string {
  return 'allow-scripts';
}

function StaticPreviewCodeBlock({
  codeContent,
  codeProps,
  className,
  language,
  previewKind,
}: {
  codeContent: ReactNode;
  codeProps: Record<string, unknown>;
  className?: string;
  language?: string;
  previewKind: StaticPreviewKind;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const copyableCode = getCopyableCodeText(codeContent).replace(/\n$/, '');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(CHAT_PREVIEW_MIN_HEIGHT);

  const handleMessage = useCallback((event: MessageEvent) => {
    if (
      typeof event.data !== 'object' ||
      event.data === null ||
      event.data.type !== PREVIEW_RESIZE_MSG_TYPE
    ) {
      return;
    }

    const height = Number(event.data.height);
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }

    const maxPx = window.innerHeight * 3;
    const clamped = Math.max(CHAT_PREVIEW_MIN_HEIGHT, Math.min(height, maxPx));
    setFrameHeight(clamped);
  }, []);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [previewOpen, handleMessage]);

  useEffect(() => {
    if (!previewOpen) {
      setFrameHeight(CHAT_PREVIEW_MIN_HEIGHT);
    }
  }, [previewOpen]);

  return (
    <div className="chat-markdown-code-block" data-preview-open={previewOpen ? 'true' : undefined}>
      <div className="chat-markdown-code-toolbar">
        <div className="chat-markdown-code-toolbar-meta">
          <div className="chat-markdown-code-label">{language ?? 'CODE'}</div>
          <span className="chat-markdown-preview-badge">{getPreviewBadgeLabel(previewKind)}</span>
        </div>
        <div className="chat-markdown-code-actions">
          <button
            type="button"
            data-testid="chat-markdown-preview-toggle"
            className="chat-markdown-code-copy"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
          >
            {previewOpen ? '返回代码' : '查看预览'}
          </button>
          <button
            type="button"
            data-testid="chat-markdown-code-copy"
            className="chat-markdown-code-copy"
            onClick={() => {
              const copyRequest = navigator.clipboard?.writeText(copyableCode);
              void copyRequest?.catch(() => undefined);
            }}
          >
            复制代码
          </button>
        </div>
      </div>
      {previewOpen ? (
        <div className="chat-markdown-preview-panel">
          <div className="chat-markdown-preview-note">{getPreviewNote(previewKind)}</div>
          <iframe
            ref={iframeRef}
            data-testid="chat-markdown-html-preview"
            className="chat-markdown-preview-frame"
            title={getPreviewTitle(previewKind)}
            sandbox={getPreviewSandbox(previewKind)}
            referrerPolicy="no-referrer"
            loading="lazy"
            srcDoc={buildPreviewDocument(previewKind, copyableCode)}
            style={{
              minHeight: CHAT_PREVIEW_MIN_HEIGHT,
              height: frameHeight,
            }}
          />
        </div>
      ) : (
        <pre className="chat-markdown-pre">
          <code className={className} {...codeProps}>
            {codeContent}
          </code>
        </pre>
      )}
    </div>
  );
}

function ThinkingCodeBlock({
  codeContent,
  codeProps,
}: {
  codeContent: ReactNode;
  codeProps: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="chat-markdown-thinking-block" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="chat-markdown-thinking-summary"
        className="chat-markdown-thinking-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="chat-markdown-thinking-label">思考内容</span>
        <span className="chat-markdown-thinking-hint">
          {open ? '点击收起思考内容' : '默认收起，点击展开查看'}
        </span>
      </button>
      {open && (
        <div className="chat-markdown-thinking-body">
          <pre className="chat-markdown-thinking-pre">
            <code className="chat-markdown-thinking-code" {...codeProps}>
              {codeContent}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
