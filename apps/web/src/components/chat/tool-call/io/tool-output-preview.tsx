import {
  DiagnosticsPreview,
  extractDiagnosticsFromOutput,
} from '../previews/diagnostics-preview.js';
import { BashOutputPreview, extractBashOutputFromOutput } from '../previews/bash-output-preview.js';
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
import { JsonPreview } from '../previews/json-preview.js';
import { extractRepoCloneFromOutput, RepoClonePreview } from '../previews/repo-clone-preview.js';
import {
  extractRepoOverviewFromOutput,
  RepoOverviewPreview,
} from '../previews/repo-overview-preview.js';
import {
  extractReviewChangesFromOutput,
  ReviewStatusPreview,
} from '../previews/review-status-preview.js';
import { SuccessConfirmPreview } from '../previews/success-confirm-preview.js';
import {
  TaskListPreview,
  SessionListPreview,
  extractTaskListFromOutput,
  extractSessionListFromOutput,
} from '../previews/task-session-preview.js';
import { extractTodosFromOutput, TodoListPreview } from '../previews/todo-list-preview.js';
import { extractTreeNodesFromOutput, TreeNodesPreview } from '../previews/tree-nodes-preview.js';
import { extractMcpResult, McpResultPreview } from '../previews/mcp-result-preview.js';
import { extractMcpToolList, McpToolListPreview } from '../previews/mcp-tool-list-preview.js';
import {
  BackgroundTerminalPreview,
  extractBackgroundTerminal,
} from '../previews/background-terminal-preview.js';
import {
  extractToolOutputRead,
  ToolOutputReadPreview,
} from '../previews/tool-output-read-preview.js';
import { ArrayOutputPreview } from '../previews/array-output-preview.js';
import {
  BackgroundOutputPreview,
  extractBackgroundOutput,
} from '../previews/background-output-preview.js';
import {
  CodegraphResultPreview,
  extractCodegraphResult,
} from '../previews/codegraph-result-preview.js';
import {
  extractQuestionAnswers,
  QuestionAnswerPreview,
} from '../previews/question-answer-preview.js';
import { extractSkillContent, SkillContentPreview } from '../previews/skill-content-preview.js';
import { StructuredOutputPreview } from '../previews/structured-output-preview.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { extractTextFromOutput } from '../shared/extract-text.js';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';

/**
 * Render a tool's output expansion panel. Tries domain-aware paths in order:
 *   1. todo-family → TodoListPreview from metadata.todos
 *   2. read → FileContentPreview
 *   3. grep → GrepContentHitsPreview / GrepCountsPreview / FilePathListPreview
 *   4. glob → FilePathListPreview
 *   5. list → TreeNodesPreview
 *   6. workspace_review_status → ReviewStatusPreview
 *   7. workspace_create_directory / workspace_review_revert → SuccessConfirmPreview
 *   8. mcp_list_tools → McpToolListPreview
 *   9. run_bash_in_background / bash_output / bash_kill → BackgroundTerminalPreview
 *  10. read_tool_output → ToolOutputReadPreview
 *  11. background_output → BackgroundOutputPreview
 *  12. codegraph_* → CodegraphResultPreview
 *  13. skill → SkillContentPreview (unwraps `<skill_content>`)
 *  14. question / askuserquestion → QuestionAnswerPreview
 *  15. MCP/shape-matched envelope → McpResultPreview
 *  16. envelope `{output|content|text|message|result: string}` → text
 *      + DiagnosticsPreview if `diagnostics` array is present
 *  17. fallback → StructuredOutputPreview (objects) / ArrayOutputPreview (arrays) / text
 *
 * Order matters: the shape-matched MCP and skill/question branches must run
 * before the generic text/JSON fallbacks or those envelopes get dumped raw.
 */
export function ToolOutputPreview({ toolName, output }: { toolName: string; output: unknown }) {
  const normalized = toolName.trim().toLowerCase();
  const shouldExpandByDefault = useToolExpandDefault()(toolName);
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

  if (normalized === 'read') {
    const data = extractFileContentFromOutput(output);
    if (data) return <FileContentPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'bash' || normalized === 'interactive_bash') {
    const data = extractBashOutputFromOutput(output);
    if (data) return <BashOutputPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'grep') {
    const hits = extractGrepContentHitsFromOutput(output);
    if (hits) return <GrepContentHitsPreview hits={hits} />;
    const counts = extractGrepCountsFromOutput(output);
    if (counts) return <GrepCountsPreview entries={counts} />;
    const paths = extractFilePathListFromOutput(output);
    if (paths) return <FilePathListPreview paths={paths} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'glob') {
    const paths = extractFilePathListFromOutput(output);
    if (paths) return <FilePathListPreview paths={paths} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'list') {
    const data = extractTreeNodesFromOutput(output);
    if (data) return <TreeNodesPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'workspace_review_status') {
    const data = extractReviewChangesFromOutput(output);
    if (data) return <ReviewStatusPreview data={data} />;
  }

  // Task tools
  if (normalized === 'task_list' || normalized === 'task_get') {
    const tasks = extractTaskListFromOutput(output);
    if (tasks) return <TaskListPreview tasks={tasks} />;
  }

  // Session tools
  if (normalized === 'session_list' || normalized === 'session_info') {
    const sessions = extractSessionListFromOutput(output);
    if (sessions) return <SessionListPreview sessions={sessions} />;
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

  if (normalized === 'mcp_list_tools') {
    const servers = extractMcpToolList(output);
    if (servers) return <McpToolListPreview servers={servers} />;
  }

  if (
    normalized === 'run_bash_in_background' ||
    normalized === 'bash_output' ||
    normalized === 'bash_kill'
  ) {
    const terminal = extractBackgroundTerminal(output);
    if (terminal) return <BackgroundTerminalPreview view={terminal} />;
  }

  if (normalized === 'read_tool_output') {
    const readView = extractToolOutputRead(output);
    if (readView) return <ToolOutputReadPreview view={readView} />;
  }

  if (normalized === 'background_output') {
    const task = extractBackgroundOutput(output);
    if (task) return <BackgroundOutputPreview view={task} />;
  }

  if (normalized.startsWith('codegraph_')) {
    const graph = extractCodegraphResult(output);
    if (graph) return <CodegraphResultPreview view={graph} />;
  }

  if (normalized === 'skill') {
    const skillContent = extractSkillContent(output);
    if (skillContent) return <SkillContentPreview data={skillContent} />;
  }

  if (normalized === 'question' || normalized === 'askuserquestion') {
    const answers = extractQuestionAnswers(output);
    if (answers) return <QuestionAnswerPreview items={answers} />;
  }

  // MCP envelope — `skill_mcp` returns this same shape JSON-stringified.
  const mcpResult = extractMcpResult(output);
  if (mcpResult) return <McpResultPreview result={mcpResult} />;

  // Text-envelope path. Even when this matches, we still want to surface a
  // trailing diagnostics list (lsp_rename, post-write tooling) because that
  // lives outside the .output/.result string field.
  const textPayload = extractTextFromOutput(output);
  const diagnostics = extractDiagnosticsFromOutput(output);
  if (textPayload && textPayload.text.length > 0) {
    const isShortOutput = textPayload.text.length < 200 && textPayload.text.split('\n').length <= 5;
    return (
      <>
        <ExpandableOutput
          text={textPayload.text}
          maxChars={500}
          compact={isShortOutput}
          defaultExpanded={shouldExpandByDefault}
        />
        {diagnostics && diagnostics.length > 0 && <DiagnosticsPreview items={diagnostics} />}
      </>
    );
  }

  if (typeof output !== 'string' && output !== null && typeof output === 'object') {
    if (Array.isArray(output)) {
      return <ArrayOutputPreview data={output} />;
    }
    return <StructuredOutputPreview data={output as Record<string, unknown>} />;
  }

  // Plain string fallback
  const fallbackText =
    typeof output === 'string' ? output : (JSON.stringify(output, null, 2) ?? '');
  const isShortFallback = fallbackText.length < 200 && fallbackText.split('\n').length <= 5;

  if (
    typeof output === 'string' &&
    (output.trim().startsWith('{') || output.trim().startsWith('['))
  ) {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (Array.isArray(parsed)) {
        return <ArrayOutputPreview data={parsed} />;
      }
      if (parsed && typeof parsed === 'object') {
        return <StructuredOutputPreview data={parsed as Record<string, unknown>} />;
      }
      return <JsonPreview data={parsed} defaultExpanded={shouldExpandByDefault} />;
    } catch {
      // Not valid JSON, fall through to text output
    }
  }

  return (
    <ExpandableOutput
      text={fallbackText}
      maxChars={500}
      compact={isShortFallback}
      defaultExpanded={shouldExpandByDefault}
    />
  );
}
