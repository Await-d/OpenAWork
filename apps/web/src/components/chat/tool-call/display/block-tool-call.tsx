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
import { ToolIcon } from './tool-icon';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { CopyBtn } from '../shared/copy-btn.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { formatElapsed } from '../shared/format.js';
import { extractFilePath, trimPath } from '../shared/input-paths.js';
import {
  buildGenericInputSummary,
  summarizeBackgroundOutputInput,
  summarizeBatchInput,
  summarizeMcpCallInput,
  summarizeSkillMcpInput,
} from '../shared/input-summary.js';
import { SearchStateBadge, type SearchVisualState } from '../shared/search-state-badge.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import { extractWebSummary } from '../shared/web-helpers.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';

/* ── BlockToolCall (write / edit / bash / web / apply_patch / multi_edit) ── */

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

  const shouldAutoExpand =
    visualState !== 'pending' && !(visualState === 'completed' && hasLargeOutput);

  const [open, setOpen] = useState(shouldAutoExpand);

  // Re-open if the visual state transitions out of pending mid-stream
  // (e.g. the model just finished emitting input + output deltas).
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
    if (isBashLike) {
      const cmd = typeof input.command === 'string' ? input.command.slice(0, 80) : '';
      const desc = typeof input.description === 'string' ? input.description : 'Shell';
      return cmd ? `$ ${cmd}` : desc;
    }
    if (normalized === 'task_create') {
      const t =
        typeof input.title === 'string' && input.title.trim()
          ? input.title.trim()
          : typeof input.subject === 'string'
            ? input.subject.trim()
            : '';
      return t ? `task_create "${t.slice(0, 80)}"` : 'task_create';
    }
    if (normalized === 'task_get') {
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      return id ? `task_get ${id}` : 'task_get';
    }
    if (normalized === 'task_list') {
      return 'task_list';
    }
    if (normalized === 'task_update') {
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      // Local var named `nextStatus` to avoid shadowing the outer
      // `status` prop (which feeds `resolveToolVisualStatus`).
      const nextStatus = typeof input.status === 'string' ? input.status.trim() : '';
      const lhs = id ? `task_update ${id}` : 'task_update';
      return nextStatus ? `${lhs} → ${nextStatus}` : lhs;
    }
    if (isWebTool) {
      const url =
        typeof input.url === 'string'
          ? input.url
          : typeof input.query === 'string'
            ? input.query
            : '';
      const display = url.length > 60 ? `${url.slice(0, 57)}…` : url;
      const label = normalized === 'webfetch' ? 'Fetch' : 'Search';
      return `${label} ${display}`;
    }
    if (normalized === 'grep') {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return filePath ? `grep ${filePath} · "${pattern}"` : `grep "${pattern}"`;
    }
    if (normalized === 'glob') {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return filePath ? `glob ${filePath} · "${pattern}"` : `glob "${pattern}"`;
    }
    if (normalized === 'list') {
      return filePath ? `list ${filePath}` : 'list';
    }
    if (normalized === 'codesearch') {
      const query = typeof input.query === 'string' ? input.query : '';
      return query ? `codesearch "${query}"` : 'codesearch';
    }
    if (normalized === 'ast_grep_search') {
      // AST-aware search reuses the grep-style header but adds the language
      // since the same pattern means very different things across langs.
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const lang = typeof input.lang === 'string' ? input.lang : '';
      const lhs = lang ? `ast-grep [${lang}]` : 'ast-grep';
      return pattern ? `${lhs} "${pattern}"` : lhs;
    }
    if (normalized === 'ast_grep_replace') {
      // Surface pattern → rewrite + dryRun badge so users can sanity-check
      // destructive replacements without expanding the card.
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const rewrite = typeof input.rewrite === 'string' ? input.rewrite : '';
      const lang = typeof input.lang === 'string' ? input.lang : '';
      const dryRun = input.dryRun !== false; // defaults to true server-side
      const lhs = lang ? `ast-grep replace [${lang}]` : 'ast-grep replace';
      const body =
        pattern && rewrite ? ` "${pattern}" → "${rewrite}"` : pattern ? ` "${pattern}"` : '';
      return dryRun ? `${lhs}${body} (dry-run)` : `${lhs}${body}`;
    }
    if (normalized === 'workspace_review_diff') {
      // Two-part path: workspace root + file inside it. We render the file
      // with trimPath() so deep paths don't blow out the header pill.
      const rel = typeof input.filePath === 'string' ? input.filePath : '';
      const trimmed = rel ? trimPath(rel) : '';
      return trimmed ? `review diff ${trimmed}` : 'workspace_review_diff';
    }
    if (normalized === 'session_list') {
      // Optional filters: limit, project_path, from/to_date. Show the most
      // useful one (project_path) when present, otherwise just the verb.
      const proj = typeof input.project_path === 'string' ? input.project_path.trim() : '';
      return proj ? `session_list ${trimPath(proj)}` : 'session_list';
    }
    if (normalized === 'session_read') {
      const sid = typeof input.session_id === 'string' ? input.session_id.trim() : '';
      return sid ? `session_read ${sid}` : 'session_read';
    }
    if (normalized === 'session_search') {
      const q = typeof input.query === 'string' ? input.query.trim() : '';
      return q ? `session_search "${q.slice(0, 60)}"` : 'session_search';
    }
    if (normalized === 'background_output') {
      const tid = summarizeBackgroundOutputInput(input);
      return tid ? `background_output ${tid}` : 'background_output';
    }
    if (normalized === 'look_at') {
      // `look_at` accepts file_path XOR image_data; surface whichever was
      // passed plus the goal, since the goal disambiguates the intent.
      const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
      const fp = typeof input.file_path === 'string' ? input.file_path : '';
      const hasImage = typeof input.image_data === 'string' && input.image_data.length > 0;
      const lhs = fp ? `look_at ${trimPath(fp)}` : hasImage ? 'look_at <image>' : 'look_at';
      return goal ? `${lhs} · "${goal.slice(0, 50)}"` : lhs;
    }
    if (normalized === 'repo_clone') {
      // P1-SCOUT: surface the repo identifier + status badge (cached /
      // cloned / refreshed) in the header so users see at a glance
      // whether scout actually did network work or reused the cache.
      const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
      const branch = typeof input.branch === 'string' ? input.branch.trim() : '';
      const refresh = input.refresh === true;
      const lhs = repository ? `repo_clone ${repository}` : 'repo_clone';
      const flags: string[] = [];
      if (branch) flags.push(`branch=${branch}`);
      if (refresh) flags.push('refresh');
      return flags.length > 0 ? `${lhs} (${flags.join(', ')})` : lhs;
    }
    if (normalized === 'repo_overview') {
      // Either repository or path is required; show whichever was used.
      const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
      const pathInput = typeof input.path === 'string' ? input.path.trim() : '';
      const depth = typeof input.depth === 'number' ? input.depth : undefined;
      const lhs = repository
        ? `repo_overview ${repository}`
        : pathInput
          ? `repo_overview ${trimPath(pathInput)}`
          : 'repo_overview';
      return depth ? `${lhs} · depth=${depth}` : lhs;
    }
    if (normalized === 'desktop_automation') {
      // Discriminated union on `action`. Show the action verb plus the most
      // salient parameter for that action (url for goto, selector for click,
      // etc.) so users can spot what the agent is doing.
      const action = typeof input.action === 'string' ? input.action.trim() : '';
      if (!action) return 'desktop_automation';
      const extra =
        typeof input.url === 'string'
          ? input.url
          : typeof input.selector === 'string'
            ? input.selector
            : typeof input.text === 'string'
              ? input.text
              : '';
      return extra
        ? `desktop_automation ${action} · ${extra.slice(0, 60)}`
        : `desktop_automation ${action}`;
    }
    if (normalized === 'skill_mcp') {
      return `skill_mcp ${summarizeSkillMcpInput(input)}`;
    }
    if (normalized === 'read_tool_output') {
      const id = typeof input.toolCallId === 'string' ? input.toolCallId.trim() : '';
      if (id) return `read_tool_output ${id}`;
      if (input.useLatestReferenced === true) return 'read_tool_output (latest)';
      return 'read_tool_output';
    }
    if (normalized === 'mcp_call') {
      // Render "mcp_call <server>.<tool> · {arg,arg}". Never dumps raw JSON.
      return `mcp_call ${summarizeMcpCallInput(input)}`;
    }
    if (normalized === 'mcp_list_tools') {
      const serverId =
        typeof input.serverId === 'string' && input.serverId.trim() ? input.serverId.trim() : '';
      return serverId ? `mcp_list_tools ${serverId}` : 'mcp_list_tools';
    }
    if (normalized.startsWith('mcp_')) {
      // Forward-compat for future MCP-prefixed tools — still no JSON dumps.
      const generic = buildGenericInputSummary(input);
      return generic ? `${toolName} ${generic}` : toolName;
    }
    if (normalized === 'batch') {
      // Reached when resolveBatchTerminalView() returns null (e.g. before
      // the streaming progress arrives). Show "batch 2 个调用 · bash, grep"
      // instead of letting the generic fallback print raw JSON.
      const batchSummary = summarizeBatchInput(input);
      return batchSummary ? `batch ${batchSummary}` : 'batch';
    }
    if (normalized === 'skill') {
      const skillId = typeof input.skillId === 'string' ? input.skillId : '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (skillId && prompt)
        return `skill ${skillId} · "${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}"`;
      if (skillId) return `skill ${skillId}`;
      const generic = buildGenericInputSummary(input);
      return generic ? `skill ${generic}` : 'skill';
    }
    // `workspace_create_directory`, `workspace_review_revert`,
    // `workspace_review_status` share the simple verb+path shape, so we
    // fold them into the existing verb table instead of adding bespoke
    // blocks. extractFilePath() already pulls the right field for each
    // (path / filePath).
    const verb =
      normalized === 'write'
        ? 'Write'
        : normalized === 'edit' || normalized === 'multi_edit'
          ? 'Edit'
          : normalized === 'apply_patch'
            ? 'Patch'
            : normalized === 'workspace_create_directory'
              ? 'Mkdir'
              : normalized === 'workspace_review_revert'
                ? 'Revert'
                : normalized === 'workspace_review_status'
                  ? 'Review status'
                  : '';
    if (verb && filePath) return `${verb} ${filePath}`;
    if (verb) return verb;
    // Generic fallback: show tool name + input summary
    const generic = buildGenericInputSummary(input);
    return generic ? `${toolName} ${generic}` : toolName;
  }, [normalized, isBashLike, input, filePath, toolName, isWebTool]);

  // Collapsed summary (shown when not expanded)
  const collapsedSummary = useMemo(() => {
    if (isBashLike && output !== undefined) {
      const outStr = typeof output === 'string' ? output : JSON.stringify(output);
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
  const webSummary = useMemo(
    () => (isWebTool && visualState === 'completed' ? extractWebSummary(output) : null),
    [isWebTool, visualState, output],
  );

  const diffSummary = displayData.diffView?.summary;

  // Surface a short red error line in the header on failure so users
  // see *what went wrong* without expanding. The full payload (stack
  // traces, stderr) is still available in the expanded body via the
  // generic / bash / diff output renderers.
  const errorSummary = useMemo(
    () => (visualState === 'failed' ? extractErrorSummary(output, isError) : null),
    [visualState, output, isError],
  );

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
        <span className="tool-call-block-title" data-tool-category={getToolCategory(toolName)}>
          {colorizeSummary(title)}
        </span>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {displayData.diffView?.files.map((file, i) => (
                    <div key={i}>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-muted)',
                          marginBottom: 2,
                        }}
                      >
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
                      ? `${webSummary.url.slice(0, 77)}…`
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
                <ToolInputPreview toolName={toolName} input={input} />
              </div>
            </details>
          )}
        </div>
      )}
      <ToolApprovalActions approvalActions={approvalActions} />
    </div>
  );
}
