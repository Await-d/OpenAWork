import { useMemo, useState } from 'react';
import { useFileEditorContext } from '../../../../App.js';
import { CopyBtn } from '../shared/copy-btn.js';

/* ── FileContentPreview (workspace_read_file / read) ── */

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
 * Recognise a `workspace_read_file` / `read` output envelope. Conservative:
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
 * Render a read-tool output with file path + line-range badge + line-numbered
 * code block. Replaces what would otherwise be a flat ExpandableOutput of
 * `output.content` (which loses the path/range/truncation context).
 */
export function FileContentPreview({ data }: { data: FileContentLike }) {
  const [expanded, setExpanded] = useState(false);
  const fileEditorRef = useFileEditorContext();
  const lines = useMemo(() => data.content.split('\n'), [data.content]);
  const start = data.lineStart ?? 1;
  const isLong = lines.length > FILE_CONTENT_PREVIEW_LINES;
  const visibleLines = isLong && !expanded ? lines.slice(0, FILE_CONTENT_PREVIEW_LINES) : lines;
  // Pad line-number gutter wide enough for the largest line number we'll show.
  const lastNumber = start + lines.length - 1;
  const padWidth = String(lastNumber).length;

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

  return (
    <div className="file-content-preview">
      <div className="file-content-meta">
        {canOpen ? (
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
        )}
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
              <span className="file-content-line-text">{line || ' '}</span>
            </div>
          );
        })}
      </div>
      {isLong && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `显示全部 (${lines.length} 行)`}
        </button>
      )}
    </div>
  );
}
