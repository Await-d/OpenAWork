import {
  Children,
  Fragment,
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
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { MarkdownPathRef } from './markdown-path-ref.js';
import { tokenizePathsInText } from '../tool-call/shared/tokenize-paths.js';
import { normalizeMathMarkdown } from './normalize-math-markdown.js';
import { transformInlineReasoningTags } from './transform-inline-reasoning-tags.js';
import { MermaidPreviewCodeBlock } from './mermaid-preview-code-block.js';
import { ChatMarkdownTable } from './chat-markdown-table.js';
import { isMermaidFenceLanguage } from './mermaid-diagram-meta.js';
import { useFoldDisabled } from './fold-policy.js';

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

/**
 * KaTeX 的严格模式会对每个"不该出现在数学模式里的字符"逐字符 console.warn。
 * 模型输出不可控，中文/全角标点混进公式是常态，一条长回复能把控制台刷满
 * `unicodeTextInMathMode`。只对这一类降级为忽略，其余（未知符号、单位混用
 * 等）仍保留默认告警，便于发现真正的公式问题。
 */
const REHYPE_KATEX_OPTIONS = {
  strict: (errorCode: string) => (errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn'),
} as const;

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
  const normalizedContent = useMemo(
    () => stripStandaloneBreakLines(normalizeMathMarkdown(transformInlineReasoningTags(content))),
    [content],
  );
  const isBareHtmlDocument = useMemo(
    () => isFullHtmlDocument(normalizedContent),
    [normalizedContent],
  );
  if (isBareHtmlDocument) {
    return (
      <div className="chat-markdown">
        <StaticPreviewCodeBlock
          codeContent={normalizedContent}
          codeProps={{}}
          language="HTML"
          previewKind="html"
          initiallyOpen
        />
      </div>
    );
  }
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={
          streaming
            ? [[rehypeKatex, REHYPE_KATEX_OPTIONS]]
            : [[rehypeKatex, REHYPE_KATEX_OPTIONS], rehypeHighlight]
        }
        components={markdownComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownMessageContent;

/**
 * Matches a raw `<br>` (any casing / self-closing form) together with the
 * whitespace and soft line breaks hugging it. Newlines around a `<br>`
 * must be consumed too: they survive markdown parsing as soft breaks, and
 * `.chat-markdown-p[white-space: pre-wrap]` would render them on top of
 * our element, producing a blank line.
 */
const HARD_BREAK_TAG = /[ \t]*(?:\r?\n[ \t]*)?<br\s*\/?>[ \t]*(?:\r?\n[ \t]*)?/giu;

/**
 * A `<br>` that sits alone on its own line is parsed as *block-level* HTML
 * instead of inline HTML, so it never reaches the inline components that
 * `renderTextWithPaths` walks — it would keep rendering as a literal
 * `<br>` in the message body. Such a tag is only asking for a blank line,
 * which markdown already provides, so drop the tag and let the surrounding
 * blank lines handle the spacing.
 */
const STANDALONE_BREAK_LINE = /^[ \t]*<br\s*\/?>[ \t]*\r?$/gimu;

function stripStandaloneBreakLines(markdown: string): string {
  return markdown.replace(STANDALONE_BREAK_LINE, '');
}

interface TextRenderOptions {
  allowBareFilename?: boolean;
  /**
   * Re-interpret raw `<br>` found inside text children as a real line
   * break element.
   *
   * Model output uses `<br>` heavily — most importantly inside GFM table
   * cells, which have no line-break syntax of their own. react-markdown
   * does not parse raw HTML: without `rehype-raw` it rewrites HTML nodes
   * into literal text, so `<br>` reaches the DOM as the four visible
   * characters `<br>`. Enabling `rehype-raw` would fix that but would
   * also require a full sanitize schema to stay safe against untrusted
   * model output. Splitting the tag out of the text nodes we already
   * walk is both narrower and safer.
   *
   * Keep this off for inline code — there the author explicitly wants the
   * literal `<br>` text.
   */
  allowHardBreaks?: boolean;
}

const TEXT_WITH_HARD_BREAKS: TextRenderOptions = { allowHardBreaks: true };

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
function renderTextWithPaths(
  children: ReactNode,
  keyBase: string,
  options: TextRenderOptions = {},
): ReactNode {
  let nextIndex = 0;
  const tokenizeOne = (text: string): ReactNode => {
    const tokens = tokenizePathsInText(text, { allowBareFilename: options.allowBareFilename });
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

  const renderOne = (text: string): ReactNode => {
    if (!options.allowHardBreaks) return tokenizeOne(text);

    const segments = text.split(HARD_BREAK_TAG);
    if (segments.length === 1) return tokenizeOne(text);

    return segments.map((segment, index) => (
      <Fragment key={`${keyBase}-br-${nextIndex++}`}>
        {index > 0 ? <br /> : null}
        {segment === '' ? null : tokenizeOne(segment)}
      </Fragment>
    ));
  };

  // `Children.map` flattens, applies keys, and walks single nodes
  // and arrays uniformly so we don't need to special-case either. Text
  // nodes are buffered instead of mapped one by one: react-markdown
  // emits a raw `<br>` and the soft break that follows it as *separate*
  // children (`['第一行', '<br>', '\n第二行']`), so the trailing newline
  // can only be collapsed once adjacent text has been merged back
  // together. Non-text elements flush the buffer first, which keeps
  // inline markup (`<strong>`, `<code>`, …) in its original position.
  const output: ReactNode[] = [];
  let buffer = '';

  const flushBuffer = (): void => {
    if (buffer === '') return;
    output.push(renderOne(buffer));
    buffer = '';
  };

  for (const child of Children.toArray(children)) {
    if (typeof child === 'string') {
      buffer += child;
      continue;
    }
    flushBuffer();
    output.push(child);
  }
  flushBuffer();

  return output.length === 0 ? children : output;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="chat-markdown-h1">
      {renderTextWithPaths(children, 'h1', TEXT_WITH_HARD_BREAKS)}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="chat-markdown-h2">
      {renderTextWithPaths(children, 'h2', TEXT_WITH_HARD_BREAKS)}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="chat-markdown-h3">
      {renderTextWithPaths(children, 'h3', TEXT_WITH_HARD_BREAKS)}
    </h3>
  ),
  p: ({ children }) => (
    <p className="chat-markdown-p">{renderTextWithPaths(children, 'p', TEXT_WITH_HARD_BREAKS)}</p>
  ),
  ul: ({ children }) => <ul className="chat-markdown-ul">{children}</ul>,
  ol: ({ children }) => <ol className="chat-markdown-ol">{children}</ol>,
  li: ({ children }) => (
    <li className="chat-markdown-li">
      {renderTextWithPaths(children, 'li', TEXT_WITH_HARD_BREAKS)}
    </li>
  ),
  // Inline emphasis variants that frequently wrap path-style strings —
  // typical assistant output looks like "查看 **apps/web/src/foo.ts**"
  // or "the *src/utils.ts:42* function". Tokenize their text children
  // too so those references stay clickable. Bolds are recursed shallowly
  // (string-only walk) so deeper nested elements still pass through.
  strong: ({ children }) => (
    <strong>{renderTextWithPaths(children, 'strong', TEXT_WITH_HARD_BREAKS)}</strong>
  ),
  em: ({ children }) => <em>{renderTextWithPaths(children, 'em', TEXT_WITH_HARD_BREAKS)}</em>,
  del: ({ children }) => <del>{renderTextWithPaths(children, 'del', TEXT_WITH_HARD_BREAKS)}</del>,
  blockquote: ({ children }) => (
    <blockquote className="chat-markdown-blockquote">
      {renderTextWithPaths(children, 'bq')}
    </blockquote>
  ),
  table: ({ children, node }) => <ChatMarkdownTable node={node}>{children}</ChatMarkdownTable>,
  // react-markdown 会把 GFM 的 `align` 转成 `style.textAlign`（hast-util-to-jsx-runtime
  // 的 tableCellAlignToStyle 默认开启），这里再落到 `data-align`，避免内联样式散落。
  th: ({ children, style }) => (
    <th
      className="chat-markdown-th"
      data-align={normalizeTableCellAlign(style?.textAlign)}
      scope="col"
    >
      {renderTextWithPaths(children, 'th', TEXT_WITH_HARD_BREAKS)}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="chat-markdown-td" data-align={normalizeTableCellAlign(style?.textAlign)}>
      {renderTextWithPaths(children, 'td', TEXT_WITH_HARD_BREAKS)}
    </td>
  ),
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
      // Inline code — `path/to/file.ts` is a common authoring pattern
      // in assistant replies. Tokenize so those refs stay clickable.
      // Inside backticks we accept bare filenames too (e.g.
      // `create_quotation.py`, `需求分析.md`) since the user has
      // already framed it as a code-ish token.
      return (
        <code className="chat-markdown-inline-code" {...props}>
          {renderTextWithPaths(children, 'code', { allowBareFilename: true })}
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

    if (isMermaidLanguage(rawLanguage)) {
      return (
        <MermaidPreviewCodeBlock
          code={getCopyableCodeText(codeContent).replace(/\n$/, '')}
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
      // See `markdownComponents.code` — same inline-code tokenization
      // with bare-filename support.
      return (
        <code className="chat-markdown-inline-code" {...props}>
          {renderTextWithPaths(children, 'code', { allowBareFilename: true })}
        </code>
      );
    }

    const rawLanguage = match?.[1]?.toLowerCase();
    const language = rawLanguage?.toUpperCase();

    if (isThinkingLanguage(rawLanguage)) {
      return <ThinkingCodeBlock codeContent={codeContent} />;
    }

    if (isMermaidLanguage(rawLanguage)) {
      return (
        <MermaidPreviewCodeBlock
          code={getCopyableCodeText(codeContent).replace(/\n$/, '')}
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
  const foldDisabled = useFoldDisabled();

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
  const collapsed = isCollapsible && !expanded && !foldDisabled;

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
      {isCollapsible && !foldDisabled && !expanded && (
        <button
          type="button"
          data-testid="chat-markdown-code-expand"
          className="chat-markdown-code-expand"
          onClick={() => setExpanded(true)}
        >
          展开全部 {lineCount} 行
        </button>
      )}
      {isCollapsible && !foldDisabled && expanded && (
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

/**
 * 图表围栏识别。除 `mermaid` / `mmd` 外也接受 `mindmap`、`flowchart`
 * 等「直接写图表类型当语言名」的写法，见 `mermaid-diagram-meta.ts`。
 */
function isMermaidLanguage(language: string | undefined): boolean {
  return isMermaidFenceLanguage(language);
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

type TableCellAlign = 'left' | 'center' | 'right' | 'justify';

/**
 * GFM 表格的列对齐（`:---` / `:---:` / `---:`）会被 react-markdown 放进
 * 单元格的 `style.textAlign`。这里归一化为 `data-align`，交给 CSS 统一处理，
 * 顺带避开已废弃的 `align` 属性。
 */
function normalizeTableCellAlign(textAlign: string | undefined): TableCellAlign {
  if (textAlign === 'center') {
    return 'center';
  }

  if (textAlign === 'right' || textAlign === 'end') {
    return 'right';
  }

  if (textAlign === 'justify') {
    return 'justify';
  }

  return 'left';
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
        background: var(--bg-raised);
        color: var(--fg-strong);
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
  const foldDisabled = useFoldDisabled();
  const copyableCode = getCopyableCodeText(codeContent).replace(/\n$/, '');
  const isLong = copyableCode.length > 400 || copyableCode.split('\n').length > 15;
  const shouldCollapse = isLong && !expanded && !foldDisabled;

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
                    background: 'color-mix(in oklch, var(--accent) 16%, var(--bg-overlay) 84%)',
                    borderColor:
                      'color-mix(in oklch, var(--accent) 30%, var(--border-default) 70%)',
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
                background: 'linear-gradient(transparent, var(--bg-overlay)',
                pointerEvents: 'none',
              }}
            />
          )}
          {isLong && !foldDisabled && (
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
  initiallyOpen = false,
}: {
  codeContent: ReactNode;
  codeProps: Record<string, unknown>;
  className?: string;
  language?: string;
  previewKind: StaticPreviewKind;
  initiallyOpen?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(initiallyOpen);
  const copyableCode = getCopyableCodeText(codeContent).replace(/\n$/, '');
  const externalUrls = useMemo(() => extractExternalUrls(copyableCode), [copyableCode]);
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

    const maxPx = Math.min(window.innerHeight * 1.35, 760);
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
          {externalUrls.length > 0 && (
            <div className="chat-markdown-preview-links">
              <span>外联地址</span>
              {externalUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" title={url}>
                  {url}
                </a>
              ))}
            </div>
          )}
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

function extractExternalUrls(code: string): string[] {
  const urls = new Set<string>();
  for (const match of code.matchAll(/\bhttps?:\/\/[^\s"'<>]+/gi)) {
    const candidate = match[0].replace(/[),.;]+$/g, '');
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href);
    } catch {
      continue;
    }
  }
  return [...urls];
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
              'linear-gradient(to bottom, transparent 0%, var(--bg-base) 40%, var(--bg-base) 100%)',
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
