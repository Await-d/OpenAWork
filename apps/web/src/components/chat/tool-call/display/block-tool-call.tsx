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
import { resolveMcpBuiltinToolName, unwrapMcpPayload } from '../shared/mcp-builtin-alias.js';
import { toolCallSummary, ToolCallStatus } from '../shared/tool-call-presentation.js';
import { SearchStateBadge, type SearchVisualState } from '../shared/search-state-badge.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { extractWebSummary, isSearchToolName, isWebToolName } from '../shared/web-helpers.js';
import { formatWebResultCount } from '../shared/web-structured-results.js';
import { resolveToolCallImageSource } from '../shared/tool-call-image-source.js';
import { ToolCallImagePreview } from '../io/ToolCallImagePreview.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { resolveToolInputSection } from '../shared/tool-input-fields.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { parseFileChangeResult } from '../shared/file-change-result.js';
import { buildFileSnapshotChangeResult } from '../shared/file-snapshot-result.js';
import { WebResultCards } from '../previews/web-result-cards.js';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';
import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';
import { parsePatchFiles, patchResult } from '../shared/patch-view.js';
import { PatchPreview } from '../previews/patch-preview.js';

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
  fileDiffs,
  sessionId,
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
  fileDiffs?: unknown;
  /** 当前消息所属会话 id（仅供文件变更卡按需加载完整快照，可选）。 */
  sessionId?: string | undefined;
}) {
  const normalized = toolName.trim().toLowerCase();
  const isPatchTool = normalized === 'patch' || normalized === 'apply_patch';
  const patchFiles = isPatchTool
    ? parsePatchFiles(input.patchText ?? input.patch ?? input.input)
    : null;
  const patchOutput = isPatchTool ? patchResult(output) : null;
  // 入参抽屉的标题 / 计数：与 `ToolInputPreview` 同源（见 shared/tool-input-fields）。
  const inputSection = resolveToolInputSection(toolName, input, kind);
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError: isError || patchOutput?.success === false,
    output,
    status,
  });
  // MCP 通道可能对应内置工具（`mcp__open_websearch__fetch_web` → `webfetch`）。
  // 归一化后，抓取类 MCP 调用复用同一套网页结果卡片，不再退化成纯文本——
  // 折叠标题仍用原名，避免把内部的 server / tool 名暴露给用户。
  const mcpBuiltinToolName = resolveMcpBuiltinToolName(toolName, input);
  const dispatchToolName = mcpBuiltinToolName ?? normalized;
  const isWebTool = isWebToolName(dispatchToolName);
  // `interactive_bash` shares bash's input contract (`{command, ...}`) and
  // emits the same shell stdout/stderr/exitCode envelope, so reuse the
  // BashTerminalCard renderer instead of falling through to the generic
  // `<toolName> <generic>` title + JSON output dump.
  const isBashLike = dispatchToolName === 'bash' || dispatchToolName === 'interactive_bash';

  // MCP 抓取的 output 是 `{ content: [{ type: 'text' }] }` 信封，先剥壳再解析，
  // 否则 web 卡拿不到 url / content。非 MCP 通道原样透传。
  const webOutput = useMemo(
    () => (mcpBuiltinToolName ? unwrapMcpPayload(output) : output),
    [mcpBuiltinToolName, output],
  );

  // 「搜索结果」识别只在搜索类工具上跑：`webfetch` 的正文是页面内容，页面自己的编号
  // 列表（HN 首页那种）不是搜索结果，按结果卡片拆会得到一堆错位的 title / snippet。
  const isSearchTool = isSearchToolName(dispatchToolName);
  const webSummary = useMemo(
    () =>
      isWebTool && visualState === 'completed'
        ? extractWebSummary(webOutput, { searchTool: isSearchTool })
        : null,
    [isWebTool, visualState, webOutput, isSearchTool],
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

  // 结构化结果（GitHub 仓库 / 用户 / 通用记录）：命中后展开体渲染卡片，
  // 不再把原始 JSON 平铺成文本。
  const webStructured = webSummary?.structuredResults ?? null;
  // web 卡与通用兜底**必须互补**，否则会出现「整块空白」。两个真实触发档：
  // ① `webSummary` 这个 memo 在 `visualState !== 'completed'`（例如流式进行中）时返回
  //    null——注意 `extractWebSummary` 本身对对象输入**总会返回对象**，不是它返回 null；
  // ② 即使 `completed`，四个展示分支（imageUrl / cleanedContent / searchResults /
  //    structuredResults）也可能全为空（`content: ''` 时 `cleanedContent === ''`）。
  // 此前兜底条件写的是 `!isWebTool`，于是「web 工具但无内容可展示」这一档既没有
  // web 卡、也不落通用预览。⚠️ 本判据必须与下方 `{renderedWebBlock && (` 处的 web 卡
  // 渲染条件保持逐字一致（测试已钉住两向行为），改一处必须改另一处。
  const renderedWebBlock = Boolean(
    isWebTool &&
    webSummary &&
    (webSummary.imageUrl || webSummary.cleanedContent || webSummary.searchResults || webStructured),
  );
  const webStatus = webSummary?.status;
  const webStatusOk = webStatus !== undefined && webStatus >= 200 && webStatus < 300;
  const webHost = useMemo(() => resolveHost(webSummary?.url), [webSummary?.url]);
  const webCountLabel = useMemo(
    () =>
      formatWebResultCount(
        webSummary?.structuredResults ?? null,
        webSummary?.searchResults?.length ?? 0,
      ),
    [webSummary],
  );

  const hasFileChangeResult = useMemo(() => parseFileChangeResult(output) !== null, [output]);

  const displayData = useMemo(
    () =>
      resolveToolCallCardDisplayData({
        toolName,
        input,
        // 文件结果按需计算差异，避免折叠卡片先计算一次随后不会使用的完整快照。
        output: hasFileChangeResult && !isBashLike ? undefined : output,
        includeOutputDetails: effectiveOpen,
      }),
    [toolName, input, output, effectiveOpen, hasFileChangeResult, isBashLike],
  );

  // 单条 bash 的真·实时输出：网关把滚动 stdout 以「单元素 subTools」形态写进
  // `_batchProgress`（与 batch 子行同一条数据通道），这里把它合成为终端卡的
  // live 输出；工具结算后 `_batchProgress` 消失，自动回到最终 output。
  const liveBashOutputText = useMemo(() => {
    if (!isBashLike) return undefined;
    // 审批恢复后仍可能残留 paused 阶段的占位 output；只要工具重新进入
    // running，实时快照就应优先于旧 output，否则终端会停在审批前的画面。
    if (output !== undefined && visualState !== 'running') return undefined;
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
  }, [isBashLike, input, output, visualState]);

  const bashView = useMemo(
    () =>
      displayData.bashView && liveBashOutputText !== undefined
        ? { ...displayData.bashView, mode: 'live' as const, output: liveBashOutputText }
        : displayData.bashView,
    [displayData.bashView, liveBashOutputText],
  );

  const title = useMemo(
    () => (isPatchTool ? '应用补丁' : toolCallSummary(toolName, input, output, visualState)),
    [isPatchTool, toolName, input, output, visualState],
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

  const hasDiff = !patchFiles && !hasFileChangeResult && displayData.diffView !== undefined;
  /*
   * 输出区是否已能画出文件差异（含「瘦身后只保留前段」的部分对比）。
   *
   * 与 `hasDiff` 分开判定是必要的：`hasDiff` 走 `resolveToolCallCardDisplayData`，
   * 它对**任何带截断标记**的 JSON 都放弃解析（`tolerant.truncated → undefined`）。
   * 而 recovery 瘦身后的 write / edit 输出几乎必然带标记，于是出现
   * 「顶部判定无 diff（参数区照常铺 content / oldString）、下方输出区却渲染了 diff」
   * 的错配——同一份代码在卡片里出现两遍。实测 25/25 条大文件记录全部命中该错配。
   *
   * 这里复用输出区同一套判定（`buildFileSnapshotChangeResult`），只用于「别再铺参数」，
   * 不改变 diff 的渲染位置。
   */
  const outputRendersFileDiff = useMemo(
    () => !hasDiff && !patchFiles && buildFileSnapshotChangeResult(output, output) !== null,
    [hasDiff, patchFiles, output],
  );
  const hasBashOutput = isBashLike && displayData.bashView !== undefined;

  const diffSummary = patchFiles
    ? `${patchFiles.length} 个文件 · 请求 +${patchFiles.reduce((sum, file) => sum + file.added, 0)} / -${patchFiles.reduce((sum, file) => sum + file.removed, 0)}`
    : hasFileChangeResult
      ? undefined
      : displayData.diffView?.summary;

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
          <ToolCallStatus status={visualState} toolName={toolName} />
          <span className="tool-call-block-title" data-tool-category={getToolCategory(toolName)}>
            {colorizeSummary(title)}
          </span>
          {/* web 工具把「状态码 + 域名 + 结果量」压在标题后一行，替代原先在展开体里
              单列一整行 URL 的做法——折叠态就能看出抓到的是哪个站点、有多少内容。 */}
          {webStatus !== undefined && (
            <span
              className="tool-call-block-web-status"
              data-status-ok={webStatusOk ? 'true' : undefined}
            >
              {webStatus}
            </span>
          )}
          {webHost && (
            <span className="tool-call-block-web-host" title={webSummary?.url}>
              {webHost}
            </span>
          )}
          {webCountLabel && <span className="tool-call-block-web-count">{webCountLabel}</span>}
          {diffSummary && visualState === 'completed' && !open && (
            <span className="tool-call-block-diff-summary">{diffSummary}</span>
          )}
          {/* 2xx 已经表达了「找到了」，再挂一个「✓ 已找到」只是重复噪声；
              只有「无结果 / 错误」这类反直觉结论才值得单独标出来。 */}
          {searchVisualState && !(searchVisualState === 'found' && webStatusOk) && (
            <SearchStateBadge state={searchVisualState} />
          )}
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
          {/* 展开后由失败卡自己的标题行承载同一句结论，pill 收起——与
              `collapsedSummary` 的既有约定一致（展开态不再重复折叠态摘要）。 */}
          {errorSummary && !open && (
            <span className="tool-call-error-summary" title={errorSummary}>
              {errorSummary}
            </span>
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
            {patchFiles && (
              <PatchPreview
                files={patchFiles}
                fileDiffs={[
                  ...(Array.isArray(fileDiffs) ? fileDiffs : []),
                  ...(Array.isArray(patchOutput?.fileDiffs) ? patchOutput.fileDiffs : []),
                  ...(Array.isArray(patchOutput?.files) ? patchOutput.files : []),
                ]}
                label={
                  visualState === 'failed' || patchOutput?.success === false
                    ? '补丁失败 · 请求的变更（未确认应用）'
                    : visualState === 'completed' && patchOutput?.success === true
                      ? '补丁已应用'
                      : output === undefined
                        ? '等待补丁结果 · 请求的变更'
                        : '结果未确认 · 请求的变更'
                }
              />
            )}
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
                          viewMode="auto"
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
                      viewMode="auto"
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
              (webSummary.imageUrl ||
                webSummary.cleanedContent ||
                webSummary.searchResults ||
                webStructured) && (
                <div className="tool-call-block-output">
                  {/* Meta row: 完整 URL + copy。状态码已经上移到折叠行，这里不再重复。
                      命中结构化结果时整行省掉——每条结果卡片自带链接，域名与结果量
                      也已在折叠行交代，再铺一遍完整 URL 就是截图里的那种噪声。 */}
                  {!webStructured && (
                    <div className="tool-call-block-web-meta">
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
                  )}

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

                  {/* 结构化 API 响应（GitHub 仓库 / 用户 / 通用记录）：渲染结果卡片，
                      原始 JSON 收进折叠区，不再作为正文平铺占满视口。 */}
                  {!webSummary.imageUrl && webStructured && (
                    <>
                      <WebResultCards results={webStructured} />
                      <details className="tool-call-block-web-raw">
                        <summary>
                          原始响应
                          {/* 体积上限是静默施加的：不说明的话，这里看起来就是完整响应 */}
                          {webSummary.contentTruncated ? '（已截断）' : ''}
                        </summary>
                        <pre className="tool-call-block-web-raw-body">{webSummary.content}</pre>
                      </details>
                    </>
                  )}

                  {/* Search results — full list, the card itself is the disclosure */}
                  {!webStructured && webResults.length > 0 && (
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
                  {!webSummary.imageUrl &&
                    !webStructured &&
                    webResults.length === 0 &&
                    webSummary.isMarkdown && (
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
                  {!webSummary.imageUrl &&
                    !webStructured &&
                    webResults.length === 0 &&
                    !webSummary.isMarkdown && (
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

            {/* Generic output fallback：以 `renderedWebBlock` 的**否定**为条件，
                web 工具在没有可展示内容时可回落到这里，不再留空白。 */}
            {!hasDiff &&
              !hasBashOutput &&
              !renderedWebBlock &&
              output !== undefined &&
              (!patchFiles ||
                hasFileChangeResult ||
                !patchOutput ||
                patchOutput.success !== true ||
                visualState === 'failed') && (
                <div className="tool-call-block-output">
                  <ToolOutputPreview
                    toolName={toolName}
                    output={output}
                    input={input}
                    isError={isError === true || visualState === 'failed'}
                    sessionId={sessionId}
                  />
                </div>
              )}

            {/* 入参抽屉：主要内容（终端块 / 文件卡 / 目录树 / 成功确认）已经表达了
                入参的这几类工具不再展示；其余工具保持一次点击看全。
                标题与计数读 `resolveToolInputSection`（与预览同一个规则源）：MCP-legacy
                的入参裹了一层 `arguments`，按裸 key 数会得到与实际渲染不符的「参数 (1)」；
                渠道发送类展示的是消息正文，标题为「内容」。 */}
            {Object.keys(input).length > 0 &&
              !embedded &&
              !hasBashOutput &&
              !hasDiff &&
              !outputRendersFileDiff &&
              !patchFiles &&
              !HIDE_PARAMS_TOOLS.has(normalized) && (
                <details className="tool-call-block-params" open={!isWebTool}>
                  <summary>
                    {inputSection.count === null
                      ? inputSection.title
                      : `${inputSection.title} (${inputSection.count})`}
                  </summary>
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

/** 从抓取 URL 里取域名——折叠行只需要域名，完整 URL 留在展开体里。 */
function resolveHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
