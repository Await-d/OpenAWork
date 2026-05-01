/**
 * Barrel re-exports for the chat tool-call rendering subsystem.
 *
 * The single legacy entry point `tool-call-inline.tsx` re-exports from
 * here so existing consumers (`ChatPageSections`, the test file, etc.)
 * keep working without churn while internals are now cleanly split per
 * tool/preview/router.
 */

export {
  type BatchSubResultLike,
  type BatchSubVisualState,
  BatchToolCallCard,
  batchSubInputSummary,
  batchSubVisualState,
  buildPartialBashOutput,
} from './batch-tool-call-card.js';
export { BlockToolCall } from './block-tool-call.js';
export { GenerateImageToolCard } from './generate-image-tool-card.js';
export { GroupedToolCallPill } from './grouped-tool-call-pill.js';
export { InlineToolCall } from './inline-tool-call.js';
export {
  type DiagnosticItem,
  DiagnosticsPreview,
  extractDiagnosticsFromOutput,
} from './previews/diagnostics-preview.js';
// Per-tool previews + extractors
export {
  extractFileContentFromOutput,
  type FileContentLike,
  FileContentPreview,
} from './previews/file-content-preview.js';
export {
  extractFilePathListFromOutput,
  FilePathListPreview,
} from './previews/file-path-list-preview.js';
export {
  extractGrepContentHitsFromOutput,
  type GrepContentHit,
  GrepContentHitsPreview,
} from './previews/grep-content-hits-preview.js';
export {
  extractGrepCountsFromOutput,
  type GrepCountEntry,
  GrepCountsPreview,
} from './previews/grep-counts-preview.js';
export { ParameterListPreview, ParamValue } from './previews/parameter-list-preview.js';
export {
  extractReviewChangesFromOutput,
  type ReviewChange,
  type ReviewChangesBundle,
  ReviewStatusPreview,
} from './previews/review-status-preview.js';
export {
  extractSearchHitsFromOutput,
  type SearchHit,
  type SearchHitsBundle,
  SearchResultsPreview,
} from './previews/search-results-preview.js';
export { SuccessConfirmPreview } from './previews/success-confirm-preview.js';
export {
  extractTodosFromOutput,
  type TodoLikeItem,
  TodoListPreview,
} from './previews/todo-list-preview.js';
export {
  extractTreeNodesFromOutput,
  type TreeNode,
  type TreeNodesBundle,
  TreeNodesPreview,
} from './previews/tree-nodes-preview.js';
export { CopyBtn } from './shared/copy-btn.js';
export { ExpandableOutput } from './shared/expandable-output.js';
export { extractTextFromOutput } from './shared/extract-text.js';
// Shared helpers / hooks
export { formatElapsed } from './shared/format.js';
export {
  GROUP_MIN_LEN,
  GROUPABLE_TOOL_NAMES,
  type GroupOrSingle,
  groupConsecutiveTools,
} from './shared/group-consecutive-tools.js';
export { isInlineTool } from './shared/inline-tool-set.js';
export { clampString, extractFilePath, trimPath } from './shared/input-paths.js';
export {
  buildGenericInputSummary,
  summarizeArrayField,
  summarizeBackgroundCancelInput,
  summarizeBackgroundOutputInput,
  summarizeBatchInput,
  summarizeExitPlanModeInput,
  summarizeMcpCallInput,
  summarizeObjectField,
  summarizeQuestionInput,
  summarizeSessionInfoInput,
  summarizeSkillMcpInput,
  summarizeTodoWriteInput,
} from './shared/input-summary.js';
export {
  buildLspInlineSummary,
  type LspVisualState,
  lspErrorSnippet,
  lspInputDescription,
  lspSuccessSummary,
} from './shared/lsp-summary.js';
export { SearchStateBadge, type SearchVisualState } from './shared/search-state-badge.js';
export { ToolApprovalActions } from './shared/tool-approval-actions.js';
export {
  cleanWebContent,
  extractSearchResults,
  extractWebSummary,
  isMarkdownContent,
  type SearchResultItem,
  type WebSummary,
} from './shared/web-helpers.js';
// Routers
export { ToolCallDisplay } from './tool-call-display.js';
export { ToolInputPreview } from './tool-input-preview.js';
export { ToolOutputPreview } from './tool-output-preview.js';
