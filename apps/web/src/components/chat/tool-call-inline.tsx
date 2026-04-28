import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  BashTerminalCard,
  BatchTerminalCard,
  resolveToolCallCardDisplayData,
  resolveToolVisualStatus,
  type ToolCallCardProps,
  UnifiedCodeDiff,
} from '@openAwork/shared-ui';
import { resolveBatchTerminalView } from './tool-call-batch.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolIcon } from './tool-icon';
import { ImageLightbox } from './image-lightbox.js';
import { useAuthStore } from '../../stores/auth.js';

/* ── Inline tool set ── */

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

const INLINE_TOOLS = new Set([
  'read',
  'skill',
  'question',
  'askuserquestion',
  'todowrite',
  'todoread',
  'subtodowrite',
  'subtodoread',
  'enterplanmode',
  'exitplanmode',
]);

// Tools that render inline but can optionally show expandable output
const INLINE_WITH_OUTPUT = new Set(['read']);

function isInlineTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (INLINE_TOOLS.has(normalized)) return true;
  if (normalized.startsWith('lsp_')) return true;
  return false;
}


/* ── Shared helpers ── */

function trimPath(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 4 ? '…/' + segments.slice(-3).join('/') : segments.join('/');
}

function extractFilePath(input: Record<string, unknown>): string | undefined {
  const raw = input['filePath'] ?? input['file_path'] ?? input['path'] ?? input['file'];
  return typeof raw === 'string' && raw.trim() ? trimPath(raw) : undefined;
}

/**
 * Build a human-readable inline summary from tool input parameters.
 * Tries common field names in priority order, then falls back to
 * a compact JSON representation of the first few entries.
 */
function buildGenericInputSummary(input: Record<string, unknown>, maxLen = 80): string {
  // Priority-ordered field names that typically carry the most useful info
  const priorityKeys = [
    'pattern', 'query', 'command', 'url', 'filePath', 'file_path',
    'path', 'file', 'skillId', 'toolName', 'description', 'name',
    'target', 'message', 'content', 'text', 'expression', 'arguments',
    'input',
  ];
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const key of priorityKeys) {
    const val = input[key];
    if (val === undefined || val === null) continue;
    seen.add(key);
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    if (!str || str.length === 0) continue;
    const display = str.length > 40 ? str.slice(0, 37) + '…' : str;
    parts.push(display);
    if (parts.join(' · ').length >= maxLen) break;
  }

  // Add remaining fields not covered above
  const remaining = Object.entries(input).filter(
    ([k, v]) =>
      !seen.has(k) &&
      v !== undefined &&
      v !== null &&
      v !== '' &&
      k !== 'options' &&
      k !== 'metadata' &&
      k !== 'extra',
  );
  for (const [key, val] of remaining) {
    if (parts.join(' · ').length >= maxLen) break;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    if (!str || str.length === 0) continue;
    const display = str.length > 40 ? str.slice(0, 37) + '…' : str;
    parts.push(display);
  }

  const result = parts.join(' · ');
  return result.length > maxLen ? result.slice(0, maxLen - 1) + '…' : result;
}

/* ── Copy button (OpenCowork-style) ── */

function CopyBtn({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      type="button"
      className="tool-call-copy-btn"
      onClick={handleClick}
      title={title ?? 'Copy'}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

/* ── Search state badge (OpenCowork-style) ── */

type SearchVisualState = 'found' | 'empty' | 'error';

function SearchStateBadge({ state }: { state: SearchVisualState }) {
  const labels: Record<SearchVisualState, string> = {
    found: '✓ 已找到',
    empty: '∅ 无结果',
    error: '✗ 错误',
  };
  return <span className={`tool-search-badge tool-search-badge-${state}`}>{labels[state]}</span>;
}

/* ── Web content cleaner ── */

function cleanWebContent(raw: string): string {
  let text = raw;
  text = text.replace(/\/\/<!\[CDATA\[[\s\S]*?\/\/\]\]>/g, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g, '');
  text = text.replace(/&#\d+;/g, ' ');
  text = text.replace(/&[a-zA-Z]+;/g, ' ');
  text = text.replace(/\{[^}]*\}/g, '');
  text = text.replace(/(?:var|let|const|function)\s+\w+\s*=[^;]*;/g, '');
  text = text.replace(/\w+\.\w+\s*=\s*[^;]+;/g, '');
  text = text.replace(/\\u[0-9a-fA-F]{4}/g, '');
  text = text.replace(/\\x[0-9a-fA-F]{2}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
  return text;
}

interface SearchResultItem {
  title: string;
  snippet: string;
  url?: string;
}

function extractSearchResults(cleaned: string): SearchResultItem[] | null {
  const lines = cleaned.split('\n');
  const results: SearchResultItem[] = [];
  let i = 0;
  while (i < lines.length && !/^\d+\.\s/.test(lines[i]!)) i++;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (!numMatch) continue;
    const title = numMatch[2]!.trim();
    const snippetLines: string[] = [];
    let j = i + 1;
    while (
      j < lines.length &&
      !/^(\d+)\.\s/.test(lines[j]!) &&
      !/^\*?\s*(Privacy|Terms|Next|Pagination)/.test(lines[j]!)
    ) {
      const sl = lines[j]!.trim();
      if (sl) snippetLines.push(sl);
      j++;
    }
    const snippet = snippetLines.join(' ').slice(0, 200);
    if (title.length > 2) {
      results.push({ title, snippet });
    }
    if (results.length >= 8) break;
  }
  return results.length >= 2 ? results : null;
}

function isMarkdownContent(text: string): boolean {
  let score = 0;
  if (/^#{1,3}\s/m.test(text)) score++;
  if (/\*\*[^*]+\*\*/.test(text)) score++;
  if (/\[.+\]\(.+\)/.test(text)) score++;
  if (/^\s*[-*]\s/m.test(text)) score++;
  if (/^\s*\d+\.\s/m.test(text)) score++;
  if (/^>\s/m.test(text)) score++;
  if (/`[^`]+`/.test(text)) score++;
  return score >= 2;
}

interface WebSummary {
  url?: string;
  status?: number;
  contentType?: string;
  format?: string;
  content: string;
  cleanedContent: string;
  isMarkdown: boolean;
  searchResults: SearchResultItem[] | null;
  lineCount: number;
}

function extractWebSummary(output: unknown): WebSummary {
  if (typeof output !== 'object' || output === null) {
    const text = typeof output === 'string' ? output : '';
    const cleaned = cleanWebContent(text);
    return {
      content: text.slice(0, 4000),
      cleanedContent: cleaned.slice(0, 4000),
      isMarkdown: isMarkdownContent(text),
      searchResults: extractSearchResults(cleaned),
      lineCount: cleaned.split('\n').length,
    };
  }
  const obj = output as Record<string, unknown>;
  const url = typeof obj['url'] === 'string' ? obj['url'] : undefined;
  const status = typeof obj['status'] === 'number' ? obj['status'] : undefined;
  const contentType = typeof obj['contentType'] === 'string' ? obj['contentType'] : undefined;
  const format = typeof obj['format'] === 'string' ? obj['format'] : undefined;
  const content =
    typeof obj['content'] === 'string'
      ? obj['content']
      : typeof obj['output'] === 'string'
        ? obj['output']
        : '';
  const cleaned = cleanWebContent(content);
  const isMd = format === 'markdown' || isMarkdownContent(content) || isMarkdownContent(cleaned);
  return {
    url,
    status,
    contentType,
    format,
    content: content.slice(0, 8000),
    cleanedContent: cleaned.slice(0, 8000),
    isMarkdown: isMd,
    searchResults: extractSearchResults(cleaned),
    lineCount: cleaned.split('\n').length,
  };
}

/* ── Expandable output block (OpenCowork-style) ── */

function ExpandableOutput({ text, maxChars = 500 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  const lineCount = text.split('\n').length;
  const displayed = isLong && !expanded ? text.slice(0, maxChars) + '…' : text;

  return (
    <div>
      <div className="tool-output-header">
        <span className="tool-output-meta">{lineCount} lines</span>
        <CopyBtn text={text} />
      </div>
      <pre className="tool-output-pre">{displayed}</pre>
      {isLong && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `显示全部 (${lineCount} 行, ${text.length} 字符)`}
        </button>
      )}
    </div>
  );
}

function ToolApprovalActions({
  approvalActions,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
}) {
  if (!approvalActions || approvalActions.items.length === 0) {
    return null;
  }

  return (
    <div className="tool-call-approval-actions" data-tool-approval-actions="true">
      <div className="tool-call-approval-buttons">
        {approvalActions.items.map((action) => (
          <button
            key={action.id}
            type="button"
            className="tool-call-approval-button"
            data-variant={action.primary ? 'primary' : action.danger ? 'danger' : 'secondary'}
            disabled={action.disabled}
            title={action.hint}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
      {(approvalActions.pendingLabel ||
        approvalActions.helperMessage ||
        approvalActions.errorMessage) && (
        <div className="tool-call-approval-notes">
          {approvalActions.pendingLabel && (
            <div className="tool-call-approval-note" data-tone="warning">
              {approvalActions.pendingLabel}
            </div>
          )}
          {approvalActions.helperMessage && (
            <div className="tool-call-approval-note" data-tone="muted">
              {approvalActions.helperMessage}
            </div>
          )}
          {approvalActions.errorMessage && (
            <div className="tool-call-approval-note" data-tone="danger">
              {approvalActions.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── InlineToolCall ── */

export function InlineToolCall({
  approvalActions,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
}) {
  const filePath = extractFilePath(input);
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveToolVisualStatus({ defaultStatus: 'running', isError, output, status });

  const summary = useMemo(() => {
    if (normalized === 'grep') {
      const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
      return filePath ? `${filePath} · "${pattern}"` : `"${pattern}"`;
    }
    if (normalized === 'glob') {
      const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
      return filePath ? `${filePath} · "${pattern}"` : `"${pattern}"`;
    }
    if (normalized === 'read') {
      if (filePath) {
        const offset = typeof input['offset'] === 'number' ? input['offset'] : undefined;
        const limit = typeof input['limit'] === 'number' ? input['limit'] : undefined;
        const suffix = offset != null || limit != null
          ? ` [${limit != null ? `limit=${limit}` : ''}${offset != null ? `${limit != null ? ', ' : ''}offset=${offset}` : ''}]`
          : '';
        return `${filePath}${suffix}`;
      }
      return 'reading…';
    }
    if (normalized === 'skill') {
      const skillId = typeof input['skillId'] === 'string' ? input['skillId'] : '';
      const prompt = typeof input['prompt'] === 'string' ? input['prompt'] : '';
      if (skillId && prompt) return `${skillId} · "${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}"`;
      if (skillId) return skillId;
      if (prompt) return `"${prompt.slice(0, 50)}${prompt.length > 50 ? '…' : ''}"`;
    }
    if (filePath) return filePath;
    const generic = buildGenericInputSummary(input);
    return generic || '';
  }, [normalized, input, filePath]);

  const canShowOutput =
    INLINE_WITH_OUTPUT.has(normalized) || normalized.startsWith('lsp_');
  const hasOutput = canShowOutput && output !== undefined;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-call-inline-wrap" data-tool-status={visualState}>
      <div
        className="tool-call-inline"
        data-tool-status={visualState}
        {...(hasOutput
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => setExpanded((p) => !p),
              style: { cursor: 'pointer' },
            }
          : {})}
      >
        <ToolIcon kind={kind} toolName={toolName} status={visualState} size={13} />
        <span className="tool-call-inline-name">{toolName}</span>
        <span className="tool-call-inline-summary">{summary}</span>
        {hasOutput && (
          <span className="tool-call-inline-chevron">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {expanded && hasOutput && (
        <div className="tool-call-inline-output">
          <ExpandableOutput
            text={
              typeof output === 'string'
                ? output
                : (JSON.stringify(output, null, 2) ?? '')
            }
            maxChars={400}
          />
        </div>
      )}
      <ToolApprovalActions approvalActions={approvalActions} />
    </div>
  );
}

/* ── BlockToolCall (write / edit / bash / web / apply_patch / multi_edit) ── */

// Tools that auto-expand when they have output
const AUTO_EXPAND_TOOLS = new Set(['bash', 'webfetch', 'websearch', 'google_search']);

export function BlockToolCall({
  approvalActions,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveToolVisualStatus({ defaultStatus: 'running', isError, output, status });
  const isWebTool =
    normalized === 'webfetch' || normalized === 'websearch' || normalized === 'google_search';

  // Auto-expand for errors, running bash, and tools with output
  const shouldAutoExpand =
    visualState === 'failed' ||
    (visualState === 'completed' && AUTO_EXPAND_TOOLS.has(normalized)) ||
    (normalized === 'bash' && visualState === 'running');

  const [open, setOpen] = useState(shouldAutoExpand);

  // Expand when output arrives for web tools
  useEffect(() => {
    if (shouldAutoExpand) setOpen(true);
  }, [shouldAutoExpand]);

  const filePath = extractFilePath(input);

  const displayData = useMemo(
    () =>
      resolveToolCallCardDisplayData({
        toolName,
        input,
        output,
        includeOutputDetails: open,
      }),
    [toolName, input, output, open],
  );

  const title = useMemo(() => {
    if (normalized === 'bash') {
      const cmd = typeof input['command'] === 'string' ? input['command'].slice(0, 80) : '';
      const desc = typeof input['description'] === 'string' ? input['description'] : 'Shell';
      return cmd ? `$ ${cmd}` : desc;
    }
    if (isWebTool) {
      const url =
        typeof input['url'] === 'string'
          ? input['url']
          : typeof input['query'] === 'string'
            ? input['query']
            : '';
      const display = url.length > 60 ? url.slice(0, 57) + '…' : url;
      const label = normalized === 'webfetch' ? 'Fetch' : 'Search';
      return `${label} ${display}`;
    }
    if (normalized === 'grep') {
      const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
      return filePath ? `grep ${filePath} · "${pattern}"` : `grep "${pattern}"`;
    }
    if (normalized === 'glob') {
      const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
      return filePath ? `glob ${filePath} · "${pattern}"` : `glob "${pattern}"`;
    }
    if (normalized === 'list') {
      return filePath ? `list ${filePath}` : 'list';
    }
    if (normalized === 'codesearch') {
      const query = typeof input['query'] === 'string' ? input['query'] : '';
      return query ? `codesearch "${query}"` : 'codesearch';
    }
    if (normalized.startsWith('ast_grep')) {
      const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
      return pattern ? `${toolName} "${pattern}"` : toolName;
    }
    if (normalized.startsWith('mcp_')) {
      const generic = buildGenericInputSummary(input);
      return generic ? `${toolName} ${generic}` : toolName;
    }
    if (normalized === 'skill') {
      const skillId = typeof input['skillId'] === 'string' ? input['skillId'] : '';
      const prompt = typeof input['prompt'] === 'string' ? input['prompt'] : '';
      if (skillId && prompt) return `skill ${skillId} · "${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}"`;
      if (skillId) return `skill ${skillId}`;
      const generic = buildGenericInputSummary(input);
      return generic ? `skill ${generic}` : 'skill';
    }
    const verb =
      normalized === 'write'
        ? 'Write'
        : normalized === 'edit' || normalized === 'multi_edit'
          ? 'Edit'
          : normalized === 'apply_patch'
            ? 'Patch'
            : '';
    if (verb && filePath) return `${verb} ${filePath}`;
    if (verb) return verb;
    // Generic fallback: show tool name + input summary
    const generic = buildGenericInputSummary(input);
    return generic ? `${toolName} ${generic}` : toolName;
  }, [normalized, input, filePath, toolName, isWebTool]);

  // Collapsed summary (shown when not expanded)
  const collapsedSummary = useMemo(() => {
    if (normalized === 'bash' && output !== undefined) {
      const outStr = typeof output === 'string' ? output : JSON.stringify(output);
      if (outStr) {
        const first = outStr
          .split('\n')
          .map((l: string) => l.trim())
          .find((l: string) => l.length > 0);
        if (first) return first.length > 80 ? first.slice(0, 77) + '…' : first;
      }
    }
    return undefined;
  }, [normalized, output]);

  const hasDiff = displayData.diffView !== undefined;
  const hasBashOutput = normalized === 'bash' && displayData.bashView !== undefined;
  const webSummary = useMemo(
    () => (isWebTool && visualState === 'completed' ? extractWebSummary(output) : null),
    [isWebTool, visualState, output],
  );

  const diffSummary = displayData.diffView?.summary;

  // Search visual state for badge
  const searchVisualState: SearchVisualState | null = useMemo(() => {
    if (!isWebTool || !webSummary) return null;
    if (visualState === 'failed') return 'error';
    if (webSummary.searchResults && webSummary.searchResults.length > 0) return 'found';
    if (webSummary.cleanedContent.length > 0) return 'found';
    return 'empty';
  }, [isWebTool, webSummary, visualState]);

  return (
    <div className="tool-call-block" data-tool-status={visualState}>
      {/* Header — click to toggle */}
      <button
        type="button"
        className="tool-call-block-header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <ToolIcon kind={kind} toolName={toolName} status={visualState} size={14} />
        <span className="tool-call-block-title">{title}</span>
        {diffSummary && visualState === 'completed' && (
          <span className="tool-call-block-diff-summary">{diffSummary}</span>
        )}
        {searchVisualState && <SearchStateBadge state={searchVisualState} />}
        {hasBashOutput &&
          displayData.bashView?.exitCode !== undefined &&
          visualState !== 'running' && (
            <span
              className="tool-call-block-exit-code"
              data-exit-ok={displayData.bashView.exitCode === 0 ? 'true' : undefined}
            >
              退出码 {displayData.bashView.exitCode}
            </span>
          )}
        {visualState === 'completed' && !open && collapsedSummary && (
          <span className="tool-call-block-collapsed-summary">{collapsedSummary}</span>
        )}
        {visualState === 'running' && (
          <span className="tool-call-block-running-hint">执行中…</span>
        )}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span className="tool-call-block-elapsed">{formatElapsed(durationMs)}</span>
        )}
        <span className="tool-call-block-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="tool-call-block-body">
          {/* Diff view */}
          {hasDiff && (
            <div className="tool-call-block-diff">
              {displayData.diffView!.files && displayData.diffView!.files.length > 1 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {displayData.diffView!.files.map((file, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>
                        {file.summary}
                      </div>
                      <UnifiedCodeDiff
                        beforeText={file.beforeText}
                        afterText={file.afterText}
                        chrome="minimal"
                        filePath={file.filePath}
                        maxHeight={240}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <UnifiedCodeDiff
                  beforeText={displayData.diffView?.beforeText}
                  afterText={displayData.diffView?.afterText}
                  chrome="minimal"
                  diffText={displayData.diffView?.diffText}
                  filePath={displayData.diffView?.filePath}
                  maxHeight={320}
                />
              )}
            </div>
          )}

          {/* Bash terminal output */}
          {hasBashOutput && displayData.bashView && (
            <BashTerminalCard compact={!open} view={displayData.bashView} />
          )}

          {/* Web tool output */}
          {isWebTool && webSummary && (webSummary.cleanedContent || webSummary.searchResults) && (
            <div className="tool-call-block-output">
              {/* Meta row: status + URL + line count + copy */}
              <div className="tool-call-block-web-meta">
                {webSummary.status !== undefined && (
                  <span
                    className="tool-call-block-web-status"
                    data-status-ok={
                      webSummary.status >= 200 && webSummary.status < 300 ? 'true' : undefined
                    }
                  >
                    {webSummary.status}
                  </span>
                )}
                {webSummary.url && (
                  <span className="tool-call-block-web-url" title={webSummary.url}>
                    {webSummary.url.length > 80
                      ? webSummary.url.slice(0, 77) + '…'
                      : webSummary.url}
                  </span>
                )}
                <span className="tool-call-block-web-lines">{webSummary.lineCount} lines</span>
                <CopyBtn text={webSummary.cleanedContent} title="Copy content" />
              </div>

              {/* Search results */}
              {webSummary.searchResults && (
                <div className="tool-call-block-search-results">
                  {webSummary.searchResults.map((r, idx) => (
                    <div key={idx} className="tool-call-block-search-item">
                      <div className="tool-call-block-search-title">
                        <span className="tool-call-block-search-idx">{idx + 1}</span>
                        {r.title}
                      </div>
                      {r.url && (
                        <div className="tool-call-block-search-url" title={r.url}>
                          {r.url.length > 70 ? r.url.slice(0, 67) + '…' : r.url}
                        </div>
                      )}
                      {r.snippet && (
                        <div className="tool-call-block-search-snippet">{r.snippet}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Markdown content */}
              {!webSummary.searchResults && webSummary.isMarkdown && (
                <div className="tool-call-block-web-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {webSummary.cleanedContent}
                  </ReactMarkdown>
                </div>
              )}

              {/* Plain text with expand/collapse */}
              {!webSummary.searchResults && !webSummary.isMarkdown && (
                <ExpandableOutput text={webSummary.cleanedContent} maxChars={600} />
              )}
            </div>
          )}

          {/* Generic output fallback */}
          {!hasDiff && !hasBashOutput && !isWebTool && output !== undefined && (
            <div className="tool-call-block-output">
              <ExpandableOutput
                text={typeof output === 'string' ? output : (JSON.stringify(output, null, 2) ?? '')}
                maxChars={500}
              />
            </div>
          )}
        </div>
      )}
      <ToolApprovalActions approvalActions={approvalActions} />
    </div>
  );
}

/* ── GenerateImageToolCard ── */

interface GenerateImageResult {
  success: boolean;
  artifactId: string;
  title: string;
  fileName?: string;
  modelId: string;
  providerId: string;
  size: string;
  quality: string;
  outputFormat: string;
  revisedPrompt: string | null;
  summary: string;
}

function parseGenerateImageOutput(output: unknown): GenerateImageResult | null {
  if (typeof output !== 'string') return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (parsed['success'] === true && typeof parsed['artifactId'] === 'string') {
      return parsed as unknown as GenerateImageResult;
    }
  } catch {
    // not JSON — older format or error
  }
  return null;
}

/**
 * Parse a "WxH" size string (e.g. "1024x1024", "1536x1024") into an aspect ratio
 * suitable for CSS `aspect-ratio`. Falls back to 1 (square) when unparseable —
 * which is the natural default while the tool input is still streaming.
 */
function parseImageAspectRatio(rawSize: unknown): number {
  if (typeof rawSize !== 'string') return 1;
  const match = rawSize.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

function GenerateImageToolCard({
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageHover, setImageHover] = useState(false);
  const imageFileName = useRef<string>('generated-image.png');

  const visualState = resolveToolVisualStatus({ defaultStatus: 'running', isError, output, status });
  const result = useMemo(() => parseGenerateImageOutput(output), [output]);
  if (result?.fileName) imageFileName.current = result.fileName;
  const prompt = typeof input['prompt'] === 'string' ? input['prompt'] : '';
  const promptShort = prompt.length > 60 ? prompt.slice(0, 57) + '…' : prompt;
  const aspectRatio = useMemo(() => parseImageAspectRatio(input['size']), [input]);

  // Fetch the artifact image once we have a result. Errors must be surfaced
  // (not silently swallowed) — otherwise a 404/401/CORS failure leaves the
  // body empty with no way to diagnose, which is exactly the "image gone
  // after refresh" symptom users hit when the artifact endpoint or auth
  // header is mis-configured.
  useEffect(() => {
    if (!result?.artifactId || !token) return;
    let cancelled = false;
    setImageLoading(true);
    setFetchError(null);
    setImageSrc(null);
    const artifactId = result.artifactId;
    void (async () => {
      try {
        const res = await fetch(`${gatewayUrl}/artifacts/${artifactId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          const message = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${
            bodyText ? ` — ${bodyText.slice(0, 200)}` : ''
          }`;
          console.error('[generate_image] artifact fetch failed', {
            artifactId,
            url: `${gatewayUrl}/artifacts/${artifactId}`,
            status: res.status,
            statusText: res.statusText,
            body: bodyText.slice(0, 500),
          });
          setFetchError(message);
          return;
        }
        const data = (await res.json()) as {
          artifact?: { content?: string; metadata?: Record<string, unknown> };
        };
        const content = data.artifact?.content;
        const meta = data.artifact?.metadata;
        if (meta?.['fileName'] && typeof meta['fileName'] === 'string') {
          imageFileName.current = meta['fileName'] as string;
        }
        if (!content) {
          console.error('[generate_image] artifact content empty', { artifactId, artifact: data.artifact });
          setFetchError('图片 artifact 内容为空');
          return;
        }
        setImageSrc(
          content.startsWith('data:')
            ? content
            : `data:${(meta?.['mimeType'] as string) ?? 'image/png'};base64,${content}`,
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[generate_image] artifact fetch threw', { artifactId, error: err });
        setFetchError(message || '加载失败');
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token, result?.artifactId, retryNonce]);

  const paramPillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    height: 18,
    padding: '0 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    background: 'color-mix(in oklch, var(--text-3) 8%, transparent)',
    color: 'var(--text-3)',
  };

  return (
    <div
      className="tool-call-block"
      data-tool-status={visualState}
      style={{ overflow: 'hidden', paddingLeft: 0 }}
    >
      {/* Header */}
      <div
        className="tool-call-block-header"
        style={{ cursor: 'default', minHeight: 32 }}
      >
        <ToolIcon toolName="generate_image" status={visualState} size={14} />
        <span
          className="tool-call-block-title"
          style={{ flex: '0 1 auto', maxWidth: '55%' }}
          title={prompt}
        >
          {visualState === 'running'
            ? '正在生成图片…'
            : visualState === 'failed'
              ? '图片生成失败'
              : `生成图片 ${promptShort}`}
        </span>

        {/* Param pills */}
        {result && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            <span style={paramPillStyle}>{result.modelId}</span>
            <span style={paramPillStyle}>{result.size}</span>
            <span style={paramPillStyle}>{result.outputFormat.toUpperCase()}</span>
          </div>
        )}
        {visualState === 'running' && (
          <span className="tool-call-block-running-hint" style={{ marginLeft: 'auto' }}>
            生成中…
          </span>
        )}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span className="tool-call-block-elapsed">{formatElapsed(durationMs)}</span>
        )}
      </div>

      {/* Running placeholder — occupies space and signals image is being generated */}
      {visualState === 'running' && (
        <div
          style={{
            padding: '6px 12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <style>{`
@keyframes omo-image-gen-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes omo-image-gen-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .omo-image-gen-shimmer { animation: none !important; opacity: 0; }
  .omo-image-gen-pulse { animation: none !important; opacity: 0.85; }
}
          `}</style>
          <div
            style={{
              width: '100%',
              maxWidth: 360,
              aspectRatio: String(aspectRatio),
              borderRadius: 12,
              border: '1px dashed var(--border-subtle)',
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--accent) 6%, var(--surface)) 0%, var(--surface) 60%, color-mix(in oklch, var(--accent) 4%, var(--surface)) 100%)',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Shimmer sweep */}
            <div
              aria-hidden="true"
              className="omo-image-gen-shimmer"
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(110deg, transparent 35%, color-mix(in oklch, var(--accent) 14%, transparent) 50%, transparent 65%)',
                animation: 'omo-image-gen-shimmer 1.8s ease-in-out infinite',
                pointerEvents: 'none',
              }}
            />
            {/* Status content */}
            <div
              className="omo-image-gen-pulse"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-2)',
                animation: 'omo-image-gen-pulse 1.8s ease-in-out infinite',
                padding: '0 16px',
                textAlign: 'center',
              }}
            >
              <ToolIcon toolName="generate_image" status="running" size={22} />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                正在生成图片…
              </div>
              {promptShort && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    lineHeight: 1.5,
                    maxWidth: '100%',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={prompt}
                >
                  {promptShort}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      {visualState !== 'running' && (
        <div
          style={{
            padding: '6px 12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Loading placeholder */}
          {imageLoading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 160,
                borderRadius: 12,
                border: '1px dashed var(--border-subtle)',
                background: 'var(--surface)',
                color: 'var(--text-3)',
                fontSize: 11,
              }}
            >
              加载图片中…
            </div>
          )}

          {/* Image */}
          {!imageLoading && imageSrc && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                maxWidth: 480,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: '0 2px 8px color-mix(in oklch, var(--text) 6%, transparent)',
                  background:
                    'repeating-conic-gradient(color-mix(in oklch, var(--bg) 94%, var(--text-3)) 0% 25%, transparent 0% 50%) 50% / 16px 16px',
                  lineHeight: 0,
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setImageHover(true)}
                onMouseLeave={() => setImageHover(false)}
                onClick={() => setLightboxOpen(true)}
              >
                <img
                  src={imageSrc}
                  alt={result?.title ?? '生成的图片'}
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: 420,
                    objectFit: 'contain',
                  }}
                />
                {/* Hover action bar */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 4,
                    padding: 6,
                    background: 'linear-gradient(rgba(0,0,0,0.45) 0%, transparent 100%)',
                    opacity: imageHover ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: imageHover ? 'auto' : 'none',
                  }}
                >
                  <button
                    type="button"
                    title="下载图片"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!imageSrc) return;
                      const a = document.createElement('a');
                      a.href = imageSrc;
                      a.download = imageFileName.current;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      border: 'none',
                      background: 'rgba(255,255,255,0.18)',
                      backdropFilter: 'blur(6px)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="放大查看"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxOpen(true);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      border: 'none',
                      background: 'rgba(255,255,255,0.18)',
                      backdropFilter: 'blur(6px)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ⤢
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Lightbox */}
          {imageSrc && (
            <ImageLightbox
              src={imageSrc}
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              alt={result?.title ?? '生成的图片'}
              {...(result?.title ? { caption: result.title } : {})}
              fileName={imageFileName.current}
            />
          )}

          {/* Artifact fetch error (tool itself succeeded, but /artifacts/:id failed) */}
          {!imageLoading && !imageSrc && fetchError && !isError && visualState !== 'failed' && (
            <div
              style={{
                borderRadius: 10,
                border: '1px solid color-mix(in oklch, var(--warning) 22%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--warning) 5%, var(--surface))',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--warning)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>⚠</span>
                图片加载失败
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--text-3)',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {fetchError}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  style={{
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--surface)',
                    color: 'var(--text-2)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {!imageLoading && !imageSrc && (isError || visualState === 'failed') && (
            <div
              style={{
                borderRadius: 10,
                border: '1px solid color-mix(in oklch, var(--danger) 20%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--danger) 4%, var(--surface))',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--danger)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</span>
                图片生成失败
              </div>
              {typeof output === 'string' && output.length > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: 'color-mix(in oklch, var(--danger) 70%, var(--text-3))',
                    wordBreak: 'break-word',
                  }}
                >
                  {output}
                </div>
              )}
            </div>
          )}

          {/* Meta */}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 18,
                    padding: '0 7px',
                    borderRadius: 999,
                    background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  图片已生成
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={result.title}
                >
                  {result.title}
                </span>
              </div>
              {result.fileName && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: 'var(--text-3)',
                    lineHeight: 1.4,
                    paddingLeft: 2,
                  }}
                >
                  <span style={{ opacity: 0.6, flexShrink: 0 }}>文件:</span>
                  <code
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono, monospace)',
                      background: 'color-mix(in oklch, var(--text-3) 8%, transparent)',
                      padding: '1px 6px',
                      borderRadius: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={result.fileName}
                  >
                    {result.fileName}
                  </code>
                </div>
              )}
              {result.revisedPrompt && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    lineHeight: 1.5,
                    paddingLeft: 2,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={result.revisedPrompt}
                >
                  <span style={{ fontStyle: 'italic', opacity: 0.7 }}>优化后:</span>{' '}
                  {result.revisedPrompt}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Router: pick inline vs block ── */

export function ToolCallDisplay(props: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
  resumedAfterApproval?: boolean;
  kind?: ToolCallCardProps['kind'];
  toolCallId?: string;
}) {
  const normalized = props.toolName.trim().toLowerCase();

  if (
    normalized === 'task' ||
    normalized === 'agent' ||
    normalized === 'call_omo_agent'
  ) {
    return null; // Task tools handled separately by TaskToolInline
  }

  if (normalized === 'batch') {
    const batchView = resolveBatchTerminalView(props.input, props.output);
    if (batchView) {
      return <BatchTerminalCard view={batchView} />;
    }
    return (
      <BlockToolCall
        approvalActions={props.approvalActions}
        kind={props.kind}
        toolName={props.toolName}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (props.toolName.trim().toLowerCase() === 'generate_image') {
    return (
      <GenerateImageToolCard
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (isInlineTool(props.toolName)) {
    return (
      <InlineToolCall
        approvalActions={props.approvalActions}
        kind={props.kind}
        toolName={props.toolName}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
      />
    );
  }

  return (
    <BlockToolCall
      approvalActions={props.approvalActions}
      kind={props.kind}
      toolName={props.toolName}
      input={props.input}
      output={props.output}
      status={props.status}
      isError={props.isError}
      durationMs={props.durationMs}
    />
  );
}
