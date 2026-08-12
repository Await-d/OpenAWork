import {
  BashTerminalCard,
  resolveToolCallCardDisplayData,
  resolveToolVisualStatus,
  type ToolCallCardProps,
  UnifiedCodeDiff,
} from '@openAwork/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageLightbox } from '../../image/image-lightbox.js';
import { ToolIcon } from './tool-icon';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { CopyBtn } from '../shared/copy-btn.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { formatElapsed } from '../shared/format.js';
import { extractFilePath } from '../shared/input-paths.js';
import { naturalLanguageSummary } from '../shared/natural-language-summary.js';
import { SearchStateBadge, type SearchVisualState } from '../shared/search-state-badge.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { extractWebSummary } from '../shared/web-helpers.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';

/* ── BlockToolCall (write / edit / bash / web / apply_patch / multi_edit) ── */

export function BlockToolCall({
  approvalActions,
  pendingPermissionRequestId,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  pendingPermissionRequestId?: string;
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });
  const isWebTool =
    normalized === 'webfetch' || normalized === 'websearch' || normalized === 'google_search';
  // `interactive_bash` shares bash's input contract (`{command, ...}`) and
  // emits the same shell stdout/stderr/exitCode envelope, so reuse the
  // BashTerminalCard renderer instead of falling through to the generic
  // `<toolName> <generic>` title + JSON output dump.
  const isBashLike = normalized === 'bash' || normalized === 'interactive_bash';

  // Auto-expand block tools when they have meaningful content to show.
  // However, for completed tools with very large output, default to collapsed
  // to prevent long outputs from dominating the viewport. The user can always
  // click to expand.
  const hasLargeOutput = (() => {
    if (output === undefined) return false;
    const outStr = typeof output === 'string' ? output : JSON.stringify(output);
    return outStr.length > 2000;
  })();

  const webSummary = useMemo(
    () => (isWebTool && visualState === 'completed' ? extractWebSummary(output) : null),
    [isWebTool, visualState, output],
  );

  const searchVisualState: SearchVisualState | null = useMemo(() => {
    if (!isWebTool || !webSummary) return null;
    if (visualState === 'failed') return 'error';
    if (webSummary.imageUrl) return 'found';
    if (webSummary.searchResults && webSummary.searchResults.length > 0) return 'found';
    if (webSummary.cleanedContent.length === 0) return 'empty';
    // Treat "No results found" style messages as empty so they don't claim success.
    if (/^No results found\b/i.test(webSummary.cleanedContent.trim())) return 'empty';
    return 'found';
  }, [isWebTool, webSummary, visualState]);

  const shouldExpandByDefault = useToolExpandDefault()(toolName);

  const isWebEmptyResult = isWebTool && searchVisualState === 'empty';

  const shouldAutoExpand =
    visualState !== 'pending' &&
    !isWebEmptyResult &&
    (shouldExpandByDefault || visualState === 'running');

  const [open, setOpen] = useState(shouldAutoExpand);
  const [webResultsExpanded, setWebResultsExpanded] = useState(false);
  const [webImageLightboxOpen, setWebImageLightboxOpen] = useState(false);

  const webResults = webSummary?.searchResults ?? [];
  const MAX_VISIBLE_RESULTS = 3;
  const hasMoreResults = webResults.length > MAX_VISIBLE_RESULTS;
  const visibleWebResults = webResultsExpanded
    ? webResults
    : webResults.slice(0, MAX_VISIBLE_RESULTS);

  // Re-open if the visual state transitions out of pending mid-stream
  // (e.g. the model just finished emitting input + output deltas).
  useEffect(() => {
    if (shouldAutoExpand) setOpen(true);
  }, [shouldAutoExpand]);

  const filePath = extractFilePath(input);
  // filePath is kept for potential future use and passed to diff views

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

  const title = useMemo(
    () => naturalLanguageSummary(toolName, input),
    [toolName, input],
  );

  // Collapsed summary (shown when not expanded)
  const collapsedSummary = useMemo(() => {
    if (isBashLike && output !== undefined) {
      const outStr = typeof output === 'string' ? output : (JSON.stringify(output, null, 2) ?? '');
      if (outStr) {
        const first = outStr
          .split('\n')
          .map((l: string) => l.trim())
          .find((l: string) => l.length > 0);
        if (first) return first.length > 80 ? `${first.slice(0, 77)}…` : first;
      }
    }
    return undefined;
  }, [isBashLike, output]);

  const hasDiff = displayData.diffView !== undefined;
  const hasBashOutput = isBashLike && displayData.bashView !== undefined;

  const diffSummary = displayData.diffView?.summary;

  // Surface a short red error line in the header on failure so users
  // see *what went wrong* without expanding. The full payload (stack
  // traces, stderr) is still available in the expanded body via the
  // generic / bash / diff output renderers.
  const errorSummary = useMemo(
    () => (visualState === 'failed' ? extractErrorSummary(output, isError) : null),
    [visualState, output, isError],
  );

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
        <span className="tool-call-block-title" data-tool-category={getToolCategory(toolName)}>
          {colorizeSummary(title)}
        </span>
        {diffSummary && visualState === 'completed' && !open && (
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
          <span className="tool-call-block-collapsed-summary">
            {colorizeSummary(collapsedSummary)}
          </span>
        )}
        {errorSummary && (
          <span className="tool-call-error-summary" title={errorSummary}>
            {errorSummary}
          </span>
        )}
        {visualState === 'running' && <span className="tool-call-block-running-hint">执行中…</span>}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span
            className="tool-call-block-elapsed"
            data-duration-tier={
              durationMs >= 10_000 ? 'slow' : durationMs >= 1_000 ? 'normal' : 'fast'
            }
          >
            {formatElapsed(durationMs)}
          </span>
        )}
        <span className="tool-call-block-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="tool-call-block-body">
          {/* Diff view */}
          {hasDiff && (
            <div className="tool-call-block-diff">
              {displayData.diffView?.files && displayData.diffView?.files.length > 1 ? (
                <div className="tool-call-block-diff-multi">
                  {displayData.diffView?.files.map((file, i) => (
                    <UnifiedCodeDiff
                      key={i}
                      beforeText={file.beforeText}
                      afterText={file.afterText}
                      chrome="minimal"
                      filePath={file.filePath}
                      maxHeight={240}
                    />
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
          {isWebTool &&
            webSummary &&
            (webSummary.imageUrl || webSummary.cleanedContent || webSummary.searchResults) && (
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
                        ? `${webSummary.url.slice(0, 77)}…`
                        : webSummary.url}
                    </span>
                  )}
                  <CopyBtn
                    text={
                      webSummary.imageUrl
                        ? webSummary.imageUrl
                        : webSummary.searchResults
                          ? webSummary.searchResults
                              .map(
                                (r, idx) =>
                                  `${idx + 1}. ${r.title}${r.url ? `\n   ${r.url}` : ''}${r.snippet ? `\n   ${r.snippet}` : ''}`,
                              )
                              .join('\n')
                          : webSummary.cleanedContent
                    }
                    title="Copy content"
                  />
                </div>

                {webSummary.imageUrl && (
                  <>
                    <button
                      type="button"
                      className="tool-call-block-web-image"
                      onClick={(event) => {
                        event.stopPropagation();
                        setWebImageLightboxOpen(true);
                      }}
                      title="打开图片预览"
                    >
                      <img
                        src={webSummary.imageUrl}
                        alt="抓取到的网络图片"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </button>
                    <ImageLightbox
                      src={webSummary.imageUrl}
                      open={webImageLightboxOpen}
                      onClose={() => setWebImageLightboxOpen(false)}
                      alt="抓取到的网络图片"
                      caption={webSummary.url}
                    />
                  </>
                )}

                {/* Search results — compact list, no raw content duplication */}
                {webSummary.searchResults && webSummary.searchResults.length > 0 && (
                  <div className="tool-call-block-search-results">
                    {visibleWebResults.map((r, idx) => (
                      <div key={idx} className="tool-call-block-search-item">
                        <div className="tool-call-block-search-title">
                          <span className="tool-call-block-search-idx">{idx + 1}</span>
                          {r.title}
                        </div>
                        {r.url && (
                          <div className="tool-call-block-search-url" title={r.url}>
                            {r.url.length > 70 ? `${r.url.slice(0, 67)}…` : r.url}
                          </div>
                        )}
                        {r.snippet && (
                          <div className="tool-call-block-search-snippet">{r.snippet}</div>
                        )}
                      </div>
                    ))}
                    {hasMoreResults && (
                      <button
                        type="button"
                        className="tool-output-toggle tool-search-results-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWebResultsExpanded((v) => !v);
                        }}
                      >
                        {webResultsExpanded
                          ? '收起结果'
                          : `展开其余 ${webResults.length - MAX_VISIBLE_RESULTS} 个结果`}
                      </button>
                    )}
                  </div>
                )}

                {/* Markdown content */}
                {!webSummary.imageUrl && !webSummary.searchResults && webSummary.isMarkdown && (
                  <div className="tool-call-block-web-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {webSummary.cleanedContent}
                    </ReactMarkdown>
                  </div>
                )}

                {/* Plain text with expand/collapse; for empty search results keep it compact */}
                {!webSummary.imageUrl && !webSummary.searchResults && !webSummary.isMarkdown && (
                  <ExpandableOutput
                    text={webSummary.cleanedContent}
                    maxChars={600}
                    compact={searchVisualState === 'empty'}
                    defaultExpanded={shouldExpandByDefault}
                  />
                )}
              </div>
            )}

          {/* Generic output fallback */}
          {!hasDiff && !hasBashOutput && !isWebTool && output !== undefined && (
            <div className="tool-call-block-output">
              <ToolOutputPreview toolName={toolName} output={output} />
            </div>
          )}

          {/* Raw parameters — collapsed by default. Critical for tools whose
              specialised renderers (bash command, batch progress, mcp_call
              header) summarise input but don't expose every field. Users
              who need to see the exact JSON the model emitted can drill in. */}
          {Object.keys(input).length > 0 && (
            <details className="tool-call-block-params">
              <summary>参数 ({Object.keys(input).length})</summary>
              <div className="tool-call-block-params-body">
                <ToolInputPreview toolName={toolName} input={input} kind={kind} />
              </div>
            </details>
          )}
        </div>
      )}
      <ToolApprovalActions
        approvalActions={approvalActions}
        permissionRequestId={pendingPermissionRequestId}
      />
    </div>
  );
}
