import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BashTerminalCard,
  resolveToolCallCardDisplayData,
  type ToolCallCardProps,
  UnifiedCodeDiff,
} from '@openAwork/shared-ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ── Inline tool set ── */

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

const INLINE_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'list',
  'skill',
  'question',
  'askuserquestion',
  'todowrite',
  'todoread',
  'subtodowrite',
  'subtodoread',
  'codesearch',
  'enterplanmode',
  'exitplanmode',
]);

function isInlineTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (INLINE_TOOLS.has(normalized)) return true;
  if (normalized.startsWith('lsp_') || normalized.startsWith('ast_grep')) return true;
  if (normalized.startsWith('mcp_')) return true;
  return false;
}

/* ── Icon mapping ── */

const TOOL_ICON_MAP: Record<string, string> = {
  write: '←',
  edit: '←',
  multi_edit: '←',
  apply_patch: '%',
  read: '→',
  grep: '✱',
  glob: '✱',
  list: '→',
  bash: '$',
  webfetch: '⬡',
  websearch: '◈',
  google_search: '◈',
  codesearch: '◇',
  skill: '★',
  question: '?',
  askuserquestion: '?',
  todowrite: '☑',
  todoread: '☑',
  task: '│',
  agent: '│',
  call_omo_agent: '│',
  enterplanmode: '▶',
  exitplanmode: '◀',
};

function toolIcon(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  return TOOL_ICON_MAP[normalized] ?? '⚙';
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

/* ── Status dot with animation (OpenCowork-style) ── */

type ToolVisualStatus = 'completed' | 'running' | 'failed' | 'idle';

function resolveVisualStatus(
  status: ToolCallCardProps['status'] | undefined,
  isError: boolean | undefined,
  output: unknown,
): ToolVisualStatus {
  if (isError || status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (status === 'completed' || (status === undefined && output !== undefined)) return 'completed';
  return 'idle';
}

function ToolStatusDot({ state }: { state: ToolVisualStatus }) {
  return (
    <span className="tool-status-dot" data-state={state}>
      {state === 'running' && <span className="tool-status-dot-ping" />}
      <span className="tool-status-dot-core" />
    </span>
  );
}

/* ── Search state badge (OpenCowork-style) ── */

type SearchVisualState = 'found' | 'empty' | 'error';

function SearchStateBadge({ state }: { state: SearchVisualState }) {
  const labels: Record<SearchVisualState, string> = {
    found: '✓ found',
    empty: '∅ no results',
    error: '✗ error',
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
        <span className="tool-output-label">Output</span>
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

/* ── InlineToolCall ── */

export function InlineToolCall({
  toolName,
  input,
  output,
  status,
  isError,
}: {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
}) {
  const filePath = extractFilePath(input);
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveVisualStatus(status, isError, output);

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
      return filePath ?? 'reading…';
    }
    if (filePath) return filePath;
    const desc = typeof input['description'] === 'string' ? input['description'] : '';
    return desc.length > 80 ? desc.slice(0, 77) + '…' : desc;
  }, [normalized, input, filePath]);

  return (
    <div className="tool-call-inline" data-tool-status={visualState}>
      <ToolStatusDot state={visualState} />
      <span className="tool-call-inline-name">{toolName}</span>
      <span className="tool-call-inline-summary">{summary}</span>
    </div>
  );
}

/* ── BlockToolCall (write / edit / bash / web / apply_patch / multi_edit) ── */

// Tools that auto-expand when they have output
const AUTO_EXPAND_TOOLS = new Set(['bash', 'webfetch', 'websearch', 'google_search']);

export function BlockToolCall({
  toolName,
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveVisualStatus(status, isError, output);
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
    const verb =
      normalized === 'write'
        ? 'Write'
        : normalized === 'edit' || normalized === 'multi_edit'
          ? 'Edit'
          : normalized === 'apply_patch'
            ? 'Patch'
            : toolName;
    return filePath ? `${verb} ${filePath}` : verb;
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
        <ToolStatusDot state={visualState} />
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
              exit {displayData.bashView.exitCode}
            </span>
          )}
        {visualState === 'completed' && !open && collapsedSummary && (
          <span className="tool-call-block-collapsed-summary">{collapsedSummary}</span>
        )}
        {visualState === 'running' && (
          <span className="tool-call-block-running-hint">running…</span>
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
    </div>
  );
}

/* ── Router: pick inline vs block ── */

export function ToolCallDisplay(props: {
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
  if (
    props.toolName.trim().toLowerCase() === 'task' ||
    props.toolName.trim().toLowerCase() === 'agent' ||
    props.toolName.trim().toLowerCase() === 'call_omo_agent'
  ) {
    return null; // Task tools handled separately by TaskToolInline
  }

  if (isInlineTool(props.toolName)) {
    return (
      <InlineToolCall
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
      toolName={props.toolName}
      input={props.input}
      output={props.output}
      status={props.status}
      isError={props.isError}
      durationMs={props.durationMs}
    />
  );
}
