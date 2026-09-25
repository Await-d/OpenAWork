import { useMemo, useState } from 'react';
import { detectLanguage, highlightCodeLines } from '@openAwork/shared-ui';
import type { DiffToken } from '@openAwork/shared-ui';
import { useFileEditorContext } from '../../../../App.js';
import { CopyBtn } from '../shared/copy-btn.js';
import { parseDirectoryListing } from '../shared/directory-listing.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/* ── FileContentPreview (read) ── */

export interface FileContentLike {
  path: string;
  content: string;
  truncated?: boolean;
  lineStart?: number;
  lineEnd?: number;
  totalLines?: number;
  byteLimitReached?: boolean;
}

/**
 * Recognise a `read` output envelope. Conservative:
 * requires *both* `path` and `content` to be strings so we don't poach the
 * generic textPayload path used by webfetch / lsp_* / mcp_call etc. (they
 * only carry `output|content|text|message|result`, never `path`).
 */
export function extractFileContentFromOutput(output: unknown): FileContentLike | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const r = output as Record<string, unknown>;
  if (typeof r.path !== 'string' || typeof r.content !== 'string') return null;
  return {
    path: r.path,
    content: r.content,
    truncated: r.truncated === true,
    lineStart: typeof r.lineStart === 'number' ? r.lineStart : undefined,
    lineEnd: typeof r.lineEnd === 'number' ? r.lineEnd : undefined,
    totalLines: typeof r.totalLines === 'number' ? r.totalLines : undefined,
    byteLimitReached: r.byteLimitReached === true,
  };
}

const FILE_CONTENT_PREVIEW_LINES = 30;
/**
 * 展开态一次渲染的行数上限：像 `read` 一个千行文件时，不能把全文都铺进 DOM
 * （与 diff 的 600 行上限同一思路）；超出部分由「显示全部」显式放开。
 */
const MAX_RENDERED_FILE_LINES = 300;

/** 渲染高亮 token（无高亮时退回纯文本，空行保留一行高度）。 */
function renderLineTokens(tokens: DiffToken[] | undefined, text: string) {
  if (tokens && tokens.length > 0) {
    return tokens.map((token, index) =>
      token.className ? (
        <span key={`${index}:${token.text.slice(0, 8)}`} className={token.className}>
          {token.text}
        </span>
      ) : (
        <span key={`${index}:${token.text.slice(0, 8)}`}>{token.text}</span>
      ),
    );
  }
  return text || ' ';
}

/**
 * Render a read-tool output with file path + line-range badge + line-numbered
 * code block. Replaces what would otherwise be a flat ExpandableOutput of
 * `output.content` (which loses the path/range/truncation context).
 */
export function FileContentPreview({
  data,
  defaultExpanded = false,
}: {
  data: FileContentLike;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // 「显示全部」是一次显式动作：展开态默认只渲染上限行数（见 MAX_RENDERED_FILE_LINES）。
  const [showAllLines, setShowAllLines] = useState(false);
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  const effectiveExpanded = expanded || isInsideExpandedCard;
  const fileEditorRef = useFileEditorContext();
  const lines = useMemo(() => data.content.split('\n'), [data.content]);
  const start = data.lineStart ?? 1;
  const showingAll = isInsideExpandedCard ? showAllLines : expanded;
  const visibleLimit = showingAll
    ? lines.length
    : effectiveExpanded
      ? MAX_RENDERED_FILE_LINES
      : FILE_CONTENT_PREVIEW_LINES;
  const visibleLines = lines.slice(0, visibleLimit);
  const toggleAllLines = () => {
    if (isInsideExpandedCard) {
      setShowAllLines((previous) => !previous);
      return;
    }
    setExpanded((previous) => !previous);
  };
  // 语法高亮：与 diff 共用 shared-ui 的整段高亮按行拆分（超预算 → undefined，退回纯文本）。
  const highlightedLines = useMemo(
    () => highlightCodeLines(data.content, detectLanguage(data.path)),
    [data.content, data.path],
  );
  // Pad line-number gutter wide enough for the largest line number we'll show.
  const lastNumber = start + lines.length - 1;
  const padWidth = String(lastNumber).length;

  // read 命中目录时，网关返回的是「`dir <名>` / `file <名>`」文本清单——按目录清单渲染，
  // 而不是「文件 N 行 + 行号代码」。
  const directoryEntries = useMemo(() => parseDirectoryListing(data.content), [data.content]);

  // Clicking the path opens the file in the editor pane positioned on the
  // line window this read actually returned — not line 1. Only wired when a
  // FileEditorContext is present (chat page with the editor pane available);
  // elsewhere the path stays a passive label.
  const canOpen = fileEditorRef?.current != null;
  const openAtRange = () => {
    const open = fileEditorRef?.current;
    if (!open) return;
    open(
      data.path,
      data.lineStart != null
        ? { line: data.lineStart, ...(data.lineEnd != null ? { endLine: data.lineEnd } : {}) }
        : undefined,
    );
  };
  const pathNode = canOpen ? (
    <button
      type="button"
      className="file-content-path file-content-path-clickable"
      title={`点击打开 ${data.path}${
        data.lineStart != null
          ? `:${data.lineStart}${data.lineEnd != null ? `-${data.lineEnd}` : ''}`
          : ''
      }`}
      onClick={(event) => {
        event.stopPropagation();
        openAtRange();
      }}
    >
      {data.path}
    </button>
  ) : (
    <span className="file-content-path" title={data.path}>
      {data.path}
    </span>
  );

  if (directoryEntries) {
    return (
      <div className="file-content-preview" data-directory-listing="true">
        <div className="file-content-meta">
          {pathNode}
          <span className="file-content-range">{directoryEntries.length} 项</span>
          {data.truncated && (
            <span className="file-content-flag" data-flag="truncated">
              已截断
            </span>
          )}
          <CopyBtn text={data.content} title="复制清单" />
        </div>
        <div className="file-content-pre" role="region" aria-label="directory listing">
          {directoryEntries.map((entry, index) => (
            <div
              key={`${entry.name}-${index}`}
              className="tool-call-tree-row"
              data-kind={entry.isDir ? 'dir' : 'file'}
            >
              <span className="tool-call-tree-glyph" aria-hidden="true">
                {entry.isDir ? '▸' : '·'}
              </span>
              <span className="tool-call-tree-name">{entry.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="file-content-preview">
      <div className="file-content-meta">
        {pathNode}
        {data.lineStart != null && data.lineEnd != null && data.totalLines != null && (
          <span className="file-content-range">
            {data.lineStart}–{data.lineEnd} / {data.totalLines} 行
          </span>
        )}
        {data.totalLines == null && <span className="file-content-range">{lines.length} 行</span>}
        {data.truncated && (
          <span className="file-content-flag" data-flag="truncated">
            已截断
          </span>
        )}
        {data.byteLimitReached && (
          <span className="file-content-flag" data-flag="oversize">
            超大文件
          </span>
        )}
        <CopyBtn text={data.content} title="复制内容" />
      </div>
      <div className="file-content-pre" role="region" aria-label="file content">
        {visibleLines.map((line, i) => {
          const lineNum = start + i;
          return (
            <div key={lineNum} className="file-content-line">
              {canOpen ? (
                <button
                  type="button"
                  className="file-content-line-num file-content-line-num-clickable"
                  title={`打开并跳转到第 ${lineNum} 行`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const open = fileEditorRef?.current;
                    if (open) open(data.path, { line: lineNum });
                  }}
                >
                  {String(lineNum).padStart(padWidth, ' ')}
                </button>
              ) : (
                <span className="file-content-line-num" aria-hidden>
                  {String(lineNum).padStart(padWidth, ' ')}
                </span>
              )}
              <span className="file-content-line-text">
                {renderLineTokens(highlightedLines?.[i], line)}
              </span>
            </div>
          );
        })}
      </div>
      {(lines.length > visibleLimit || showingAll) && (
        <button type="button" className="tool-output-toggle" onClick={toggleAllLines}>
          {showingAll ? '收起' : `显示全部（${lines.length} 行）`}
        </button>
      )}
    </div>
  );
}
