import { type ReactNode, useMemo } from 'react';
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
import { stripToolOutputTruncationDeep } from '@openAwork/shared';

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
/**
 * 解析「看起来像 JSON」的工具输出。
 *
 * 返回 `{ ok, value }` 而不是 `value | null`：`JSON.parse('null')` 是合法输入，用 null 当
 * 「解析失败」哨兵会把 `null` 输出误判成纯文本（原实现会渲染 `<JsonPreview data={null}>`）。
 * 必须留在模块级：try 内的 `&&` / JSX 都是值块，会让编译器报
 * "Support value blocks … within a try/catch statement" 并放弃优化整个组件（实测）。
 */
function parseJsonOutputOnce(output: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(output) as unknown };
  } catch {
    // Not valid JSON, fall through to text output
    return { ok: false, value: null };
  }
}

export function ToolOutputPreview({
  toolName,
  output: rawOutput,
}: {
  toolName: string;
  output: unknown;
}) {
  const normalized = toolName.trim().toLowerCase();
  const shouldExpandByDefault = useToolExpandDefault()(toolName);
  // 存储层会把超大工具输出序列化成 JSON 字符串（刷新后的历史消息就是这个形态）。
  // 先尝试还原成对象，让各领域预览器按结构化输出渲染；解析失败时保持原字符串。
  const output = useMemo(() => parseStoredJsonOutput(rawOutput), [rawOutput]);
  // recovery 会对 tool 输出瘦身，被裁剪处会留下 `…[truncated, N chars omitted]` 字样。
  // 这里统一剥离并按省略量渲染徽标：否则用户会在正文里看到这行英文噪音，误以为是
  // 输出内容本身；而「内容其实不完整」这个信息又确实需要告知。
  const truncation = useMemo(() => stripToolOutputTruncationDeep(output), [output]);
  const previewOutput = truncation ? truncation.value : output;
  const body = renderToolOutputBody({ normalized, previewOutput, shouldExpandByDefault });
  if (!truncation) {
    return body;
  }
  return (
    <div className="tool-output-truncation-host">
      {body}
      <div className="tool-output-truncated-badge" title="该内容来自会话快照的瘦身副本，非完整输出">
        内容已截断{truncation.omittedChars > 0 ? ` · 省略 ${truncation.omittedChars} 字符` : ''}
      </div>
    </div>
  );
}

/** 把内部先前的 if 链抽成独立函数，便于外层统一追加截断徽标。 */
function renderToolOutputBody({
  normalized,
  previewOutput,
  shouldExpandByDefault,
}: {
  normalized: string;
  previewOutput: unknown;
  shouldExpandByDefault: boolean;
}): ReactNode {
  const toolName = normalized;
  const isTodoFamily =
    normalized === 'todoread' ||
    normalized === 'subtodoread' ||
    normalized === 'todowrite' ||
    normalized === 'subtodowrite';

  if (isTodoFamily) {
    const todos = extractTodosFromOutput(previewOutput);
    if (todos !== null) {
      if (todos.length === 0) {
        return <div className="tool-call-inline-empty">（暂无待办项）</div>;
      }
      return <TodoListPreview todos={todos} />;
    }
  }

  if (normalized === 'read') {
    const data = extractFileContentFromOutput(previewOutput);
    if (data) return <FileContentPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'bash' || normalized === 'interactive_bash') {
    const data = extractBashOutputFromOutput(previewOutput);
    if (data) return <BashOutputPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'grep') {
    const hits = extractGrepContentHitsFromOutput(previewOutput);
    if (hits) return <GrepContentHitsPreview hits={hits} />;
    const counts = extractGrepCountsFromOutput(previewOutput);
    if (counts) return <GrepCountsPreview entries={counts} />;
    const paths = extractFilePathListFromOutput(previewOutput);
    if (paths) return <FilePathListPreview paths={paths} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'glob') {
    const paths = extractFilePathListFromOutput(previewOutput);
    if (paths) return <FilePathListPreview paths={paths} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'list') {
    const data = extractTreeNodesFromOutput(previewOutput);
    if (data) return <TreeNodesPreview data={data} defaultExpanded={shouldExpandByDefault} />;
  }

  if (normalized === 'workspace_review_status') {
    const data = extractReviewChangesFromOutput(previewOutput);
    if (data) return <ReviewStatusPreview data={data} />;
  }

  // Task tools
  if (normalized === 'task_list' || normalized === 'task_get') {
    const tasks = extractTaskListFromOutput(previewOutput);
    if (tasks) return <TaskListPreview tasks={tasks} />;
  }

  // Session tools
  if (normalized === 'session_list' || normalized === 'session_info') {
    const sessions = extractSessionListFromOutput(previewOutput);
    if (sessions) return <SessionListPreview sessions={sessions} />;
  }

  // P1-SCOUT: structured cards for the repo_clone / repo_overview
  // gateway tools. Both fall through to the generic envelope path
  // when the previewOutput is malformed (e.g. an error envelope), so we do
  // not need to special-case errors here.
  if (normalized === 'repo_clone') {
    const data = extractRepoCloneFromOutput(previewOutput);
    if (data) return <RepoClonePreview data={data} />;
  }
  if (normalized === 'repo_overview') {
    const data = extractRepoOverviewFromOutput(previewOutput);
    if (data) return <RepoOverviewPreview data={data} />;
  }

  if (normalized === 'workspace_create_directory' || normalized === 'workspace_review_revert') {
    if (previewOutput && typeof previewOutput === 'object' && !Array.isArray(previewOutput)) {
      const record = previewOutput as Record<string, unknown>;
      // 失败信封也带 filePath/path，直接渲染会显示「✓ 成功」。判定口径与
      // repo_clone 预览保持一致：出现 error 文本或 ok/success 为 false 都不算成功。
      const errorText = record['error'];
      const failed =
        (typeof errorText === 'string' && errorText.trim().length > 0) ||
        record['ok'] === false ||
        record['success'] === false;
      if (!failed) {
        return <SuccessConfirmPreview toolName={toolName} output={record} />;
      }
    }
  }

  if (normalized === 'mcp_list_tools') {
    const servers = extractMcpToolList(previewOutput);
    if (servers) return <McpToolListPreview servers={servers} />;
  }

  if (
    normalized === 'run_bash_in_background' ||
    normalized === 'bash_output' ||
    normalized === 'bash_kill'
  ) {
    const terminal = extractBackgroundTerminal(previewOutput);
    if (terminal) return <BackgroundTerminalPreview view={terminal} />;
  }

  if (normalized === 'read_tool_output') {
    const readView = extractToolOutputRead(previewOutput);
    if (readView) return <ToolOutputReadPreview view={readView} />;
  }

  if (normalized === 'background_output') {
    const task = extractBackgroundOutput(previewOutput);
    if (task) return <BackgroundOutputPreview view={task} />;
  }

  if (normalized.startsWith('codegraph_')) {
    const graph = extractCodegraphResult(previewOutput);
    if (graph) return <CodegraphResultPreview view={graph} />;
  }

  if (normalized === 'skill') {
    const skillContent = extractSkillContent(previewOutput);
    if (skillContent) return <SkillContentPreview data={skillContent} />;
  }

  if (normalized === 'question' || normalized === 'askuserquestion') {
    const answers = extractQuestionAnswers(previewOutput);
    if (answers) return <QuestionAnswerPreview items={answers} />;
  }

  // MCP envelope — `skill_mcp` returns this same shape JSON-stringified.
  const mcpResult = extractMcpResult(previewOutput);
  if (mcpResult) return <McpResultPreview result={mcpResult} />;

  // Text-envelope path. Even when this matches, we still want to surface a
  // trailing diagnostics list (lsp_rename, post-write tooling) because that
  // lives outside the .output/.result string field.
  const textPayload = extractTextFromOutput(previewOutput);
  const diagnostics = extractDiagnosticsFromOutput(previewOutput);
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

  if (
    typeof previewOutput !== 'string' &&
    previewOutput !== null &&
    typeof previewOutput === 'object'
  ) {
    if (Array.isArray(previewOutput)) {
      return <ArrayOutputPreview data={previewOutput} />;
    }
    return <StructuredOutputPreview data={previewOutput as Record<string, unknown>} />;
  }

  // Plain string fallback
  const fallbackText =
    typeof previewOutput === 'string'
      ? previewOutput
      : (JSON.stringify(previewOutput, null, 2) ?? '');
  const isShortFallback = fallbackText.length < 200 && fallbackText.split('\n').length <= 5;

  if (
    typeof previewOutput === 'string' &&
    (previewOutput.trim().startsWith('{') || previewOutput.trim().startsWith('['))
  ) {
    // 解析（含 try/catch 与值块）下沉到模块级 `parseJsonOutputOnce`；判定与 JSX 留在
    // try 之外，避免值块让编译器放弃优化整个组件。
    const parsedResult = parseJsonOutputOnce(previewOutput);
    if (parsedResult.ok) {
      const parsed = parsedResult.value;
      if (Array.isArray(parsed)) {
        return <ArrayOutputPreview data={parsed} />;
      }
      if (parsed && typeof parsed === 'object') {
        return <StructuredOutputPreview data={parsed as Record<string, unknown>} />;
      }
      return <JsonPreview data={parsed} defaultExpanded={shouldExpandByDefault} />;
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

/**
 * 存储层（`normalizeToolResultOutputForStorage`）会把超过体积上限的工具输出
 * 序列化成 JSON 字符串——刷新历史消息时前端拿到的就是这种形态。
 * 这里把「看起来像 JSON 对象/数组」的字符串还原成对象，避免结构化预览
 * （目录树 / 文件内容 / 诊断……）退化成一段 JSON 文本。
 */
function parseStoredJsonOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  const trimmed = output.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return output;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return output;
  }
}
