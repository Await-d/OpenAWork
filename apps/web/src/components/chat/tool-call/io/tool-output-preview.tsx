import {
  DiagnosticsPreview,
  extractDiagnosticsFromOutput,
} from '../previews/diagnostics-preview.js';
import {
  extractFileContentFromOutput,
  FileContentPreview,
} from '../previews/file-content-preview.js';
import {
  extractFilePathListFromOutput,
  FilePathListPreview,
} from '../previews/file-path-list-preview.js';
import {
  extractGrepContentHitsFromOutput,
  GrepContentHitsPreview,
} from '../previews/grep-content-hits-preview.js';
import { extractGrepCountsFromOutput, GrepCountsPreview } from '../previews/grep-counts-preview.js';
import { extractRepoCloneFromOutput, RepoClonePreview } from '../previews/repo-clone-preview.js';
import {
  extractRepoOverviewFromOutput,
  RepoOverviewPreview,
} from '../previews/repo-overview-preview.js';
import {
  extractReviewChangesFromOutput,
  ReviewStatusPreview,
} from '../previews/review-status-preview.js';
import {
  extractSearchHitsFromOutput,
  SearchResultsPreview,
} from '../previews/search-results-preview.js';
import { SuccessConfirmPreview } from '../previews/success-confirm-preview.js';
import { extractTodosFromOutput, TodoListPreview } from '../previews/todo-list-preview.js';
import { extractTreeNodesFromOutput, TreeNodesPreview } from '../previews/tree-nodes-preview.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { extractTextFromOutput } from '../shared/extract-text.js';

/**
 * Render a tool's output expansion panel. Tries domain-aware paths in order:
 *   1. todo-family → TodoListPreview from metadata.todos
 *   2. read / workspace_read_file → FileContentPreview
 *   3. grep → GrepContentHitsPreview / GrepCountsPreview / FilePathListPreview
 *   4. glob → FilePathListPreview
 *   5. workspace_search → SearchResultsPreview
 *   6. workspace_tree / list → TreeNodesPreview
 *   7. workspace_review_status → ReviewStatusPreview
 *   8. workspace_create_directory / workspace_review_revert → SuccessConfirmPreview
 *   9. envelope `{output|content|text|message|result: string}` → text
 *      + DiagnosticsPreview if `diagnostics` array is present
 *  10. fallback → pretty-printed JSON
 *
 * Replaces the previous "always JSON.stringify(output, null, 2)" code path
 * which is what produced the raw-format output the user flagged.
 */
export function ToolOutputPreview({ toolName, output }: { toolName: string; output: unknown }) {
  const normalized = toolName.trim().toLowerCase();
  const isTodoFamily =
    normalized === 'todoread' ||
    normalized === 'subtodoread' ||
    normalized === 'todowrite' ||
    normalized === 'subtodowrite';

  if (isTodoFamily) {
    const todos = extractTodosFromOutput(output);
    if (todos !== null) {
      if (todos.length === 0) {
        return <div className="tool-call-inline-empty">（暂无待办项）</div>;
      }
      return <TodoListPreview todos={todos} />;
    }
  }

  if (normalized === 'read' || normalized === 'workspace_read_file') {
    const data = extractFileContentFromOutput(output);
    if (data) return <FileContentPreview data={data} />;
  }

  if (normalized === 'grep') {
    const hits = extractGrepContentHitsFromOutput(output);
    if (hits) return <GrepContentHitsPreview hits={hits} />;
    const counts = extractGrepCountsFromOutput(output);
    if (counts) return <GrepCountsPreview entries={counts} />;
    const paths = extractFilePathListFromOutput(output);
    if (paths) return <FilePathListPreview paths={paths} />;
  }

  if (normalized === 'glob') {
    const paths = extractFilePathListFromOutput(output);
    if (paths) return <FilePathListPreview paths={paths} />;
  }

  if (normalized === 'workspace_search') {
    const data = extractSearchHitsFromOutput(output);
    if (data) return <SearchResultsPreview data={data} />;
  }

  if (normalized === 'workspace_tree' || normalized === 'list') {
    const data = extractTreeNodesFromOutput(output);
    if (data) return <TreeNodesPreview data={data} />;
  }

  if (normalized === 'workspace_review_status') {
    const data = extractReviewChangesFromOutput(output);
    if (data) return <ReviewStatusPreview data={data} />;
  }

  // P1-SCOUT: structured cards for the repo_clone / repo_overview
  // gateway tools. Both fall through to the generic envelope path
  // when the output is malformed (e.g. an error envelope), so we do
  // not need to special-case errors here.
  if (normalized === 'repo_clone') {
    const data = extractRepoCloneFromOutput(output);
    if (data) return <RepoClonePreview data={data} />;
  }
  if (normalized === 'repo_overview') {
    const data = extractRepoOverviewFromOutput(output);
    if (data) return <RepoOverviewPreview data={data} />;
  }

  if (normalized === 'workspace_create_directory' || normalized === 'workspace_review_revert') {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      return (
        <SuccessConfirmPreview toolName={toolName} output={output as Record<string, unknown>} />
      );
    }
  }

  // Text-envelope path. Even when this matches, we still want to surface a
  // trailing diagnostics list (lsp_rename, post-write tooling) because that
  // lives outside the .output/.result string field.
  const textPayload = extractTextFromOutput(output);
  const diagnostics = extractDiagnosticsFromOutput(output);
  if (textPayload && textPayload.text.length > 0) {
    const isShortOutput = textPayload.text.length < 200 && textPayload.text.split('\n').length <= 5;
    return (
      <>
        <ExpandableOutput text={textPayload.text} maxChars={500} compact={isShortOutput} />
        {diagnostics && diagnostics.length > 0 && <DiagnosticsPreview items={diagnostics} />}
      </>
    );
  }

  // True last resort: structured object we don't have a renderer for.
  // Pretty-print JSON so the user can still inspect every field.
  const fallbackText =
    typeof output === 'string' ? output : (JSON.stringify(output, null, 2) ?? '');
  const isShortFallback = fallbackText.length < 200 && fallbackText.split('\n').length <= 5;
  return <ExpandableOutput text={fallbackText} maxChars={500} compact={isShortFallback} />;
}
