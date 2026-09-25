import {
  BashTerminalCard,
  FileTypeIcon,
  resolveToolCallCardDisplayData,
  resolveToolVisualStatus,
  type ToolCallCardProps,
  UnifiedCodeDiff,
} from '@openAwork/shared-ui';
import { useState, useMemo } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageLightbox } from '../../image/image-lightbox.js';
import { ToolIcon } from './tool-icon';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { CopyBtn } from '../shared/copy-btn.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { formatElapsed } from '../shared/format.js';
import { naturalLanguageSummary } from '../shared/natural-language-summary.js';
import { SearchStateBadge, type SearchVisualState } from '../shared/search-state-badge.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { extractWebSummary } from '../shared/web-helpers.js';
import { resolveToolCallImageSource } from '../shared/tool-call-image-source.js';
import { ToolCallImagePreview } from '../io/ToolCallImagePreview.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';
import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';

/* ── BlockToolCall (write / edit / bash / web / patch / multi_edit) ── */

/**
 * `react-markdown` 会把 `![]()` 与危险协议（`![](javascript:…)`）的图片地址统一转成
 * 空串，照常渲染 `<img src="">` 会让浏览器把当前页面当成图片再请求一次（React 也会
 * 就此告警）。抓取页面的 Markdown 里这类坏图很常见，这里直接丢弃。
 */
const WEB_MARKDOWN_COMPONENTS: Components = {
  img: ({ src, alt, title }) =>
    src ? (
      <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
    ) : null,
};

/**
 * 参数区不再展示的工具：其内容预览（目录树 / 成功确认 / 路径清单）已经把入参
 * 表达出来，重复铺参数只会增加噪声（bash / diff 类在渲染分支里单独处理）。
 */
const HIDE_PARAMS_TOOLS = new Set([
  'list',
  'workspace_create_directory',
  'workspace_review_revert',
]);

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
  embedded = false,
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
  /**
   * 嵌在 batch 子行展开区里渲染：外层行已提供标题 / 状态 / 摘要，
   * 这里隐藏 header 并直接渲染内容本体（不再需要二次点击）。
   */
  embedded?: boolean;
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

  const [open, toggleOpen] = useToolCallExpandState({
    shouldAutoExpand: shouldExpandByDefault,
    shouldExpandByDefault,
  });
  // embedded：外层 batch 子行就是唯一的 disclosure，嵌套卡直接展开内容。
  const effectiveOpen = embedded || open;
  const [webImageLightboxOpen, setWebImageLightboxOpen] = useState(false);

  const webResults = webSummary?.searchResults ?? [];

  const displayData = useMemo(
    () =>
      resolveToolCallCardDisplayData({
        toolName,
        input,
        output,
        includeOutputDetails: effectiveOpen,
      }),
    [toolName, input, output, effectiveOpen],
  );

  // 单条 bash 的真·实时输出：网关把滚动 stdout 以「单元素 subTools」形态写进
  // `_batchProgress`（与 batch 子行同一条数据通道），这里把它合成为终端卡的
  // live 输出；工具结算后 `_batchProgress` 消失，自动回到最终 output。
  const liveBashOutputText = useMemo(() => {
    if (!isBashLike || output !== undefined) return undefined;
    const progress = input['_batchProgress'];
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return undefined;
    const subTools = (progress as Record<string, unknown>).subTools;
    if (!Array.isArray(subTools) || subTools.length !== 1) return undefined;
    const entry = subTools[0];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    if (record.status !== 'running') return undefined;
    const partial = record.partialOutput;
    if (typeof partial !== 'string' || partial.length === 0) return undefined;
    return partial;
  }, [isBashLike, input, output]);

  const bashView = useMemo(
    () =>
      displayData.bashView && liveBashOutputText !== undefined
        ? { ...displayData.bashView, mode: 'live' as const, output: liveBashOutputText }
        : displayData.bashView,
    [displayData.bashView, liveBashOutputText],
  );

  const title = useMemo(
    () => naturalLanguageSummary(toolName, input, output),
    [toolName, input, output],
  );

  // 折叠态只解析来源不取图：真正的请求发生在 open === true 时渲染的预览组件里。
  const imageSource = useMemo(
    () => resolveToolCallImageSource(toolName, input, output),
    [toolName, input, output],
  );

  // Collapsed summary (shown when not expanded)
  const collapsedSummary = useMemo(() => {
    if (!isBashLike || output === undefined) return undefined;
    const text = resolveBashOutputText(output);
    return text ? firstNonEmptySummaryLine(text) : undefined;
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
      {/* Header — click to toggle（embedded 时外层行就是 disclosure，不渲染） */}
      {!embedded && (
        <button
          type="button"
          className="tool-call-block-header"
          onClick={toggleOpen}
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
            displayData.bashView.exitCode !== 0 &&
            visualState !== 'running' && (
              <span className="tool-call-block-exit-code">
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
          {visualState === 'running' && (
            <span className="tool-call-block-running-hint">执行中…</span>
          )}
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
      )}

      {/* Expanded details */}
      {effectiveOpen && (
        <ToolCardExpansionProvider>
          <div className="tool-call-block-body" data-embedded={embedded ? 'true' : undefined}>
            {/* Diff view —— 文件头（图标 + 目录/文件名 + +N/-M）+ diff 本体，
                对齐参考实现 opencode 的文件卡：内容变更直接可见，不再依赖内部头部。 */}
            {hasDiff && (
              <div className="tool-call-block-diff">
                {displayData.diffView?.files && displayData.diffView?.files.length > 1 ? (
                  <div className="tool-call-block-diff-multi">
                    {displayData.diffView?.files.map((file, i) => (
                      <div className="tool-call-block-diff-file" key={i}>
                        <FileChangeHeader filePath={file.filePath} summary={file.summary} />
                        <UnifiedCodeDiff
                          beforeText={file.beforeText}
                          afterText={file.afterText}
                          chrome="minimal"
                          hideHeader
                          filePath={file.filePath}
                          maxHeight={240}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <FileChangeHeader
                      filePath={displayData.diffView?.filePath}
                      summary={diffSummary}
                    />
                    <UnifiedCodeDiff
                      beforeText={displayData.diffView?.beforeText}
                      afterText={displayData.diffView?.afterText}
                      chrome="minimal"
                      hideHeader
                      diffText={displayData.diffView?.diffText}
                      filePath={displayData.diffView?.filePath}
                      maxHeight={320}
                    />
                  </>
                )}
              </div>
            )}

            {/* Bash terminal output */}
            {hasBashOutput && bashView && (
              <BashTerminalCard
                compact={!effectiveOpen}
                running={visualState === 'running' || liveBashOutputText !== undefined}
                view={bashView}
              />
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

                  {/* Search results — full list, the card itself is the disclosure */}
                  {webSummary.searchResults && webSummary.searchResults.length > 0 && (
                    <div className="tool-call-block-search-results">
                      {webResults.map((r, idx) => (
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
                    </div>
                  )}

                  {/* Markdown content */}
                  {!webSummary.imageUrl && !webSummary.searchResults && webSummary.isMarkdown && (
                    <div className="tool-call-block-web-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={WEB_MARKDOWN_COMPONENTS}
                      >
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

            {imageSource && <ToolCallImagePreview source={imageSource} />}

            {/* Generic output fallback */}
            {!hasDiff && !hasBashOutput && !isWebTool && output !== undefined && (
              <div className="tool-call-block-output">
                <ToolOutputPreview toolName={toolName} output={output} />
              </div>
            )}

            {/* 参数抽屉：主要内容（终端块 / 文件卡 / 目录树 / 成功确认）已经表达了
                入参的这几类工具不再展示参数区；其余工具保持一次点击看全。 */}
            {Object.keys(input).length > 0 &&
              !embedded &&
              !hasBashOutput &&
              !hasDiff &&
              !HIDE_PARAMS_TOOLS.has(normalized) && (
                <details className="tool-call-block-params" open>
                  <summary>参数 ({Object.keys(input).length})</summary>
                  <div className="tool-call-block-params-body">
                    <ToolInputPreview toolName={toolName} input={input} kind={kind} />
                  </div>
                </details>
              )}
          </div>
        </ToolCardExpansionProvider>
      )}
      <ToolApprovalActions
        approvalActions={approvalActions}
        permissionRequestId={pendingPermissionRequestId}
      />
    </div>
  );
}

/** First non-empty, trimmed line of `text`, capped at 80 chars for the header. */
function firstNonEmptySummaryLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!line) return undefined;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/**
 * Pull the readable shell text out of a bash-like tool output. The bash tool
 * returns `{ command, exitCode, output, ... }` where `output` holds the
 * combined stdout/stderr text; never stringify the whole envelope, because the
 * first pretty-printed line is just `{`.
 */
function resolveBashOutputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  for (const key of ['stdout', 'output', 'stderr'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * 文件变更头（对齐参考实现 opencode 的文件卡）：文件图标 + 目录（弱化）+ 文件名 +
 * `+N / -M`。diff 本体由调用方紧跟其后渲染。
 */
function FileChangeHeader({ filePath, summary }: { filePath?: string; summary?: string }) {
  const path = filePath ?? '';
  const { dir, name } = splitFilePath(path);
  const counts = parseDiffCounts(summary);
  return (
    <div className="tool-call-file-header">
      {path ? <FileTypeIcon path={path} size={14} /> : null}
      {dir ? (
        <span className="tool-call-file-dir" title={path}>
          {dir}
        </span>
      ) : null}
      <span className="tool-call-file-name" title={path}>
        {name || 'Diff'}
      </span>
      {counts ? (
        <span className="tool-call-file-stats">
          {counts.added > 0 ? <span data-kind="added">+{counts.added}</span> : null}
          {counts.removed > 0 ? <span data-kind="removed">-{counts.removed}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function splitFilePath(path: string): { dir: string; name: string } {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { dir: '', name: normalized };
  return { dir: normalized.slice(0, index + 1), name: normalized.slice(index + 1) };
}

/** 从 `path · +N / -M` 形式的 summary 取增删行数（解析不到返回 null）。 */
function parseDiffCounts(summary: string | undefined): { added: number; removed: number } | null {
  if (!summary) return null;
  const added = /\+(\d+)/.exec(summary);
  const removed = /-(\d+)/.exec(summary);
  if (!added && !removed) return null;
  return {
    added: Number.parseInt(added?.[1] ?? '0', 10),
    removed: Number.parseInt(removed?.[1] ?? '0', 10),
  };
}
