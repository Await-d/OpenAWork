import {
  Children,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { MarkdownPathRef } from './markdown-path-ref.js';
import { tokenizePathsInText } from './tool-call/shared/tokenize-paths.js';
import { transformInlineReasoningTags } from './transform-inline-reasoning-tags.js';

const CHAT_PREVIEW_MIN_HEIGHT = 360;
const PREVIEW_RESIZE_MSG_TYPE = 'oaw-preview-resize';

// Code blocks longer than this collapse to a clipped view with an
// "展开全部" affordance. The collapsed view shows ~36 lines (60vh fade)
// so the threshold needs to be enough above that to make folding
// meaningful — at 100 lines the user still sees ~36% of the content
// while genuinely long log dumps / file pastes get tamed. Earlier
// values (60: too aggressive, folds typical components; 200: rarely
// triggers in practice) were tuned away.
const CODE_BLOCK_FOLD_THRESHOLD = 100;
// How long the copy button stays in its "✓ 已复制" confirmation state.
const COPY_FEEDBACK_MS = 1500;

type StaticPreviewKind = 'html' | 'css' | 'javascript' | 'svg';

// Memoized: props are primitives (content / streaming) and shallow comparison
// hits 100% when the message content has not changed. Without this, every
// recovery commit triggers full remark/rehype + react-markdown re-parse for
// every message in the list, which is the dominant cost of the
// `'message' handler took N ms` violation surfaced after recovery payloads.
const MarkdownMessageContent = memo(function MarkdownMessageContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const normalizedContent = useMemo(() => transformInlineReasoningTags(content), [content]);
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [] : [rehypeHighlight]}
        components={markdownComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownMessageContent;

/**
 * Wrap detected file-path tokens inside markdown text children with
 * `<MarkdownPathRef>` so users can click `apps/web/src/foo.ts:30`
 * style references to open the file in the editor pane.
 *
 * Only string children are tokenised — nested React elements
 * (`<strong>`, `<em>`, inline `<code>`, `<a>` URL links) pass through
 * untouched. Code blocks are not affected because they are rendered by
 * the `code` component branch, not via these text-bearing elements.
 *
 * The walk is shallow on purpose: we tokenize each direct string
 * child but do not recurse into element children. Path references
 * inside emphasis (`**apps/web/foo.ts**`) are uncommon enough that
 * they don't justify the extra complexity for V1.
 */
function renderTextWithPaths(children: ReactNode, keyBase: string): ReactNode {
  let nextIndex = 0;
  const tokenizeOne = (text: string): ReactNode => {
    const tokens = tokenizePathsInText(text);
    if (tokens.length === 0) return text;
    if (tokens.length === 1 && tokens[0]?.type === 'text') {
      return text;
    }
    return tokens.map((tok, i) => {
      if (tok.type === 'text') return tok.value;
      const key = `${keyBase}-${nextIndex++}-${i}`;
      return <MarkdownPathRef key={key} path={tok.path} line={tok.line} raw={tok.raw} />;
    });
  };

  // `Children.map` flattens, applies keys, and walks single nodes
  // and arrays uniformly so we don't need to special-case either.
  const mapped = Children.map(children, (child) => {
    if (typeof child === 'string') return tokenizeOne(child);
    return child;
  });
  return mapped ?? children;
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="chat-markdown-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="chat-markdown-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="chat-markdown-h3">{children}</h3>,
  p: ({ children }) => <p className="chat-markdown-p">{renderTextWithPaths(children, 'p')}</p>,
  ul: ({ children }) => <ul className="chat-markdown-ul">{children}</ul>,
  ol: ({ children }) => <ol className="chat-markdown-ol">{children}</ol>,
  li: ({ children }) => <li className="chat-markdown-li">{renderTextWithPaths(children, 'li')}</li>,
  blockquote: ({ children }) => (
    <blockquote className="chat-markdown-blockquote">
      {renderTextWithPaths(children, 'bq')}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="chat-markdown-table-wrap">
      <table className="chat-markdown-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="chat-markdown-th">{children}</th>,
  td: ({ children }) => <td className="chat-markdown-td">{renderTextWithPaths(children, 'td')}</td>,
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
      return <ThinkingCodeBlock codeContent={codeContent} />;
    }

    if (isMarkdownLanguage(rawLanguage)) {
      return (
        <MarkdownPreviewCodeBlock
          codeContent={codeContent}
          codeProps={props}
          className={className}
          language={language}
        />
      );
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
      <CodeBlock
        codeContent={codeContent}
        codeProps={props}
        className={className}
        language={language}
      />
    );
  },
};

const noMarkdownPreviewComponents: Components = {
  ...markdownComponents,
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
      return <ThinkingCodeBlock codeContent={codeContent} />;
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
      <CodeBlock
        codeContent={codeContent}
        codeProps={props}
        className={className}
        language={language}
      />
    );
  },
};

/**
 * Shared renderer for fenced code blocks. Adds three things over the
 * stock `<pre><code>` rendering:
 *   1. Left-side line-number gutter aligned to the code via grid layout.
 *      Numbers are derived from the same `\n` segmentation we already
 *      use for `getCopyableCodeText`, so they stay in sync regardless
 *      of how rehype-highlight wraps tokens.
 *   2. Copy button with transient "✓ 已复制" confirmation. Without the
 *      visual ack users can't tell whether their click hit clipboard.
 *   3. Long-block fold: if the snippet exceeds `CODE_BLOCK_FOLD_THRESHOLD`
 *      lines, render a clipped view + "展开全部 N 行" toggle so a 600-line
 *      log doesn't dominate the message scroll.
 */
function CodeBlock({
  codeContent,
  codeProps,
  className,
  language,
}: {
  codeContent: ReactNode;
  codeProps: Record<string, unknown>;
  className?: string;
  language: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  // Cleanup on unmount so a stale timer can't toggle state on a
  // dismounted node (StrictMode double-invoke + scroll virtualization).
  useEffect(
    () => () => {
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  const text = useMemo(() => getCopyableCodeText(codeContent), [codeContent]);
  const lineCount = useMemo(() => (text === '' ? 0 : text.split('\n').length), [text]);
  const lineNumbers = useMemo(
    () =>
      lineCount === 0 ? '' : Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n'),
    [lineCount],
  );

  const isCollapsible = lineCount > CODE_BLOCK_FOLD_THRESHOLD;
  const collapsed = isCollapsible && !expanded;

  const handleCopy = useCallback(() => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) return;
    void writeText
      .call(navigator.clipboard, text.replace(/\n$/, ''))
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current != null) {
          window.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => undefined);
  }, [text]);

  return (
    <div className="chat-markdown-code-block" data-collapsed={collapsed ? 'true' : undefined}>
      <div className="chat-markdown-code-toolbar">
        <div className="chat-markdown-code-toolbar-meta">
          <div className="chat-markdown-code-label">{language ?? 'CODE'}</div>
          {lineCount > 0 && (
            <span className="chat-markdown-code-lines" aria-hidden="true">
              {lineCount} 行
            </span>
          )}
        </div>
        <div className="chat-markdown-code-actions">
          <button
            type="button"
            data-testid="chat-markdown-code-copy"
            data-copied={copied ? 'true' : undefined}
            className="chat-markdown-code-copy"
            onClick={handleCopy}
          >
            {copied ? '✓ 已复制' : '复制代码'}
          </button>
        </div>
      </div>
      <div className="chat-markdown-code-body">
        {lineCount > 0 && (
          <div className="chat-markdown-code-gutter" aria-hidden="true">
            {lineNumbers}
          </div>
        )}
        <pre className="chat-markdown-pre">
          <code className={className} {...codeProps}>
            {codeContent}
          </code>
        </pre>
      </div>
      {isCollapsible && !expanded && (
        <button
          type="button"
          data-testid="chat-markdown-code-expand"
          className="chat-markdown-code-expand"
          onClick={() => setExpanded(true)}
        >
          展开全部 {lineCount} 行
        </button>
      )}
      {isCollapsible && expanded && (
        <button
          type="button"
          data-testid="chat-markdown-code-collapse"
          className="chat-markdown-code-collapse"
          onClick={() => setExpanded(false)}
        >
          收起 ({lineCount} 行)
        </button>
      )}
    </div>
  );
}

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

function isMarkdownLanguage(language: string | undefined): boolean {
  return language === 'markdown' || language === 'md';
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

  if (language === 'svg' || language === 'xml') {
    return 'svg';
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
</script>`;

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
      : previewKind === 'svg'
        ? `<style>
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      svg {
        max-width: 100%;
        max-height: 100%;
      }
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
      </script>`
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

  if (previewKind === 'svg') {
    return '矢量预览';
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

  if (previewKind === 'svg') {
    return 'SVG 预览';
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

  if (previewKind === 'svg') {
    return '直接在白底沙箱中渲染矢量内容，便于检查图标与图示。';
  }

  return '安全沙箱预览：用户脚本已移除，外链将在新窗口打开。';
}

function getPreviewSandbox(_previewKind: StaticPreviewKind): string {
  return 'allow-scripts';
}

const MARKDOWN_PREVIEW_COLLAPSED_HEIGHT = 300;

function MarkdownPreviewCodeBlock({
  codeContent,
  codeProps,
  className,
  language,
}: {
  codeContent: ReactNode;
  codeProps: Record<string, unknown>;
  className?: string;
  language?: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const copyableCode = getCopyableCodeText(codeContent).replace(/\n$/, '');
  const isLong = copyableCode.length > 400 || copyableCode.split('\n').length > 15;
  const shouldCollapse = isLong && !expanded;

  return (
    <div className="chat-markdown-code-block" data-preview-open={previewOpen ? 'true' : undefined}>
      <div className="chat-markdown-code-toolbar">
        <div className="chat-markdown-code-toolbar-meta">
          <div className="chat-markdown-code-label">{language ?? 'MARKDOWN'}</div>
          <span className="chat-markdown-preview-badge">文档预览</span>
        </div>
        <div className="chat-markdown-code-actions">
          <button
            type="button"
            data-testid="chat-markdown-preview-toggle"
            className="chat-markdown-code-copy"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
            style={
              previewOpen
                ? {
                    background: 'color-mix(in oklch, var(--accent) 16%, var(--surface) 84%)',
                    borderColor: 'color-mix(in oklch, var(--accent) 30%, var(--border) 70%)',
                    color: 'var(--accent)',
                  }
                : undefined
            }
          >
            {previewOpen ? '源文本' : '预览'}
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
            复制
          </button>
          <button
            type="button"
            className="chat-markdown-code-copy"
            onClick={() => {
              const blob = new Blob([copyableCode], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `document-${Date.now()}.md`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            下载
          </button>
        </div>
      </div>
      {previewOpen ? (
        <div style={{ padding: '12px 14px 8px' }}>
          <div
            style={
              shouldCollapse
                ? {
                    maxHeight: MARKDOWN_PREVIEW_COLLAPSED_HEIGHT,
                    overflow: 'clip',
                  }
                : undefined
            }
          >
            <div className="chat-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={noMarkdownPreviewComponents}
              >
                {copyableCode}
              </ReactMarkdown>
            </div>
          </div>
          {shouldCollapse && (
            <div
              style={{
                marginTop: -64,
                height: 64,
                background:
                  'linear-gradient(transparent, color-mix(in oklch, var(--bg-2) 92%, transparent))',
                pointerEvents: 'none',
              }}
            />
          )}
          {isLong && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                paddingTop: 4,
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="chat-markdown-code-copy"
                style={{ fontSize: 11 }}
              >
                {expanded ? '收起' : '展开全部'}
              </button>
            </div>
          )}
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

function ThinkingCodeBlock({ codeContent }: { codeContent: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const previewSource = getCopyableCodeText(codeContent).replace(/\n$/, '');
  const labeledSource = `*Thinking:* ${previewSource}`;
  const lineCount = previewSource.split('\n').length;
  const isCollapsible = lineCount > 1;
  const shouldCollapse = isCollapsible && !expanded;

  return (
    <div className="assistant-reasoning-block" data-collapsed={shouldCollapse ? 'true' : undefined}>
      <div
        className="assistant-reasoning-body"
        style={
          shouldCollapse
            ? {
                maxHeight: `${2 * 1.6 * 13 + 4}px`,
                overflow: 'clip',
                position: 'relative',
              }
            : undefined
        }
      >
        <div className="assistant-rich-content-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {labeledSource}
          </ReactMarkdown>
        </div>
      </div>
      {shouldCollapse && (
        <div
          style={{
            position: 'relative',
            marginTop: -30,
            height: 30,
            background:
              'linear-gradient(to bottom, transparent 0%, color-mix(in oklch, var(--bg) 80%, transparent) 40%, var(--bg) 100%)',
            pointerEvents: 'none',
            borderRadius: '0 0 6px 6px',
          }}
        />
      )}
      {isCollapsible && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="chat-markdown-code-copy"
          style={{
            fontSize: 10,
            marginTop: 2,
            display: 'block',
            marginLeft: 'auto',
          }}
        >
          {expanded ? '收起思考' : '展开思考'}
        </button>
      )}
    </div>
  );
}
