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
import { FileChangeResultPreview } from '../previews/file-change-result-preview.js';
import { parseFileChangeResult } from '../shared/file-change-result.js';
import { buildFileSnapshotChangeResult } from '../shared/file-snapshot-result.js';
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
import {
  extractLspDiagnostics,
  LspDiagnosticsPreview,
} from '../previews/lsp-diagnostics-preview.js';
import { LspCallHierarchyPreview } from '../previews/lsp-call-hierarchy-preview.js';
import { LspHoverPreview } from '../previews/lsp-hover-preview.js';
import { LspLocationPreview } from '../previews/lsp-location-preview.js';
import { LspPrepareRenamePreview } from '../previews/lsp-prepare-rename-preview.js';
import { SessionSearchPreview } from '../previews/session-search-preview.js';
import { MarkdownTextPreview } from '../previews/markdown-text-preview.js';
import { MediaInfoPreview } from '../previews/media-info-preview.js';
import { extractMediaInfo } from '../shared/media-info-view.js';
import { LspSymbolPreview } from '../previews/lsp-symbol-preview.js';
import { parseLspCallHierarchy } from '../shared/lsp-call-hierarchy-view.js';
import { parseLspLocations } from '../shared/lsp-location-view.js';
import { parseLspPrepareRename } from '../shared/lsp-prepare-rename-view.js';
import { parseSessionSearchHits } from '../shared/session-search-view.js';
import { resolveMcpBuiltinBridge } from '../shared/mcp-builtin-alias.js';
import { parseLspSymbols } from '../shared/lsp-symbol-view.js';
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
import { extractGitBashStatus, GitBashStatusPreview } from '../previews/git-bash-status-preview.js';
import { ResultViewPreview } from '../previews/result-view-preview.js';
import { SessionReadPreview } from '../previews/session-read-preview.js';
import { buildAdminResultView, extractAdminEnvelope } from '../shared/admin-result-view.js';
import { buildChannelResultView, extractChannelAck } from '../shared/channel-result-view.js';
import { buildLspStatusView } from '../shared/lsp-status-view.js';
import { buildModelsResultViews } from '../shared/models-result-view.js';
import { parseSessionReadOutput } from '../shared/session-read-view.js';
import {
  extractQuestionAnswers,
  QuestionAnswerPreview,
} from '../previews/question-answer-preview.js';
import { AstGrepPreview } from '../previews/ast-grep-preview.js';
import { SessionInfoPreview } from '../previews/session-info-preview.js';
import { parseAstGrepMatches } from '../shared/ast-grep-view.js';
import { extractSkillContent, SkillContentPreview } from '../previews/skill-content-preview.js';
import { parseSessionInfoText, parseSessionListTable } from '../shared/session-text-view.js';
import { StructuredOutputPreview } from '../previews/structured-output-preview.js';
import { ToolFailurePreview } from '../previews/tool-failure-preview.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { extractTextFromOutput } from '../shared/extract-text.js';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { stripToolOutputTruncationDeep } from '@openAwork/shared';

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
  input,
  isError,
  sessionId,
}: {
  toolName: string;
  output: unknown;
  /** 部分预览需要入参补全上下文（如 `lsp_symbols` 的 document 模式没有逐行路径）。 */
  input?: Record<string, unknown>;
  /**
   * 失败标记。为真时**优先**渲染结构化失败卡（见 `renderToolOutputBody` 开头），
   * 各业务预览不再抢屏；调用方（block / inline 工具卡）在 `visualState === 'failed'`
   * 时传入，未传即视为成功调用，行为与改造前完全一致。
   */
  isError?: boolean;
  /**
   * 当前消息所属会话 id。只被文件变更预览用于「按需加载完整快照」——
   * 缺省时那类预览整体隐藏加载入口，其余分支完全不受影响。
   */
  sessionId?: string | undefined;
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
  /*
   * 文件变更卡**自带更精确**的截断说明（「快照被截断 · 省略 N 字符，以下仅对比已保留的
   * 前段内容」），位置就在 diff 旁边。再叠一个通用徽标只是把同一件事说两遍，
   * 而且它离 diff 很远，看起来像是另一个问题。
   */
  const rendersFileChangeCard = useMemo(
    () =>
      parseFileChangeResult(output) !== null ||
      buildFileSnapshotChangeResult(output, output) !== null,
    [output],
  );
  const body = renderToolOutputBody({
    normalized,
    previewOutput,
    shouldExpandByDefault,
    input,
    originalOutput: rawOutput,
    isError: isError === true,
    sessionId,
  });
  if (!truncation || rendersFileChangeCard) {
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

/**
 * 输出体的分发链。**顺序即优先级**，几条硬约束：
 *
 * 1. 开头先跑 MCP 归一化桥（`resolveMcpBuiltinBridge`）：`mcp__<server>__<tool>` 与
 *    legacy `mcp_call` 先换成内置工具名、并把 MCP 信封剥成内层载荷。下游所有内置
 *    分支因此对 MCP 通道天然生效，不必为每个 server 再写一段「剥壳 + 派发」。
 * 2. 中段是**按工具名**分派的专用视图（todo / lsp_* / read / bash / grep / glob /
 *    list / workspace_* / session_* / repo_* / task_* / mcp_list_tools / codegraph_* /
 *    git_bash_status / lsp_status / read_tool_output / background_* …）。
 * 3. 再往下一组是**按输出形状**匹配的通用分支：管理类信封 `{ ok, action, … }`、
 *    `models` 的 provider 分组、渠道发送回执 `{ messageId }`、渠道读取的
 *    消息 / 记录 / 群组 / 成员，以及 `skill` / `question`。
 * 4. 最后才是通用兜底：MCP 信封 → 文本信封（带 `diagnostics` 时叠加诊断预览）→
 *    对象 `StructuredOutputPreview` / 数组 `ArrayOutputPreview` / JSON / 纯文本。
 *
 * 两条不能破的规矩：
 * - **形状匹配必须排在通用兜底之前**，否则 `{ ok, action, … }` 这类信封会被当 JSON
 *   整个铺开，`{ messageId }` 这种小对象也会被铺成字段表。
 * - **判定要用归一化后的 `normalized`**，不要用原始 `rawToolName`，否则 MCP 通道会
 *   绕过内置视图、重新退化成一坨 JSON。
 *
 * 这里刻意不再逐条罗列编号清单——上一版的固定号码表在新增五个分支之后就过期了，
 * 而没人会去同步一份号码表。要确切顺序，直接读下面的 `if` 链。
 *
 * （抽成独立函数是为了让外层统一追加截断徽标。）
 */
function renderToolOutputBody({
  normalized: rawToolName,
  previewOutput: rawOutput,
  shouldExpandByDefault,
  input,
  originalOutput,
  isError,
  sessionId,
}: {
  normalized: string;
  previewOutput: unknown;
  shouldExpandByDefault: boolean;
  input?: Record<string, unknown>;
  originalOutput: unknown;
  isError: boolean;
  sessionId?: string | undefined;
}): ReactNode {
  // 失败态优先：结构化失败卡**早于**所有业务预览——失败时业务预览要么渲染不出
  // （形状对不上），要么把「为什么失败」埋进一坨 JSON。放行规则见 `shouldRenderFailureCard`。
  if (shouldRenderFailureCard(rawOutput, isError, rawToolName)) {
    return <ToolFailurePreview output={rawOutput} isError />;
  }
  // MCP 通道（扁平 `mcp__<server>__<tool>` / legacy `mcp_call`）先归一化成内置工具名，
  // 并把信封剥成内层载荷：下游所有内置分支就此天然生效，不必为每个 server 再写一段
  // 「剥壳 + 派发」。认不出对应关系时保持原样，继续走 McpResultPreview。
  const bridge = resolveMcpBuiltinBridge(rawToolName, rawOutput, input);
  const normalized = bridge?.toolName ?? rawToolName;
  const previewOutput = bridge?.output ?? rawOutput;
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

  if (normalized === 'lsp_diagnostics') {
    const entries = extractLspDiagnostics(previewOutput);
    if (entries) return <LspDiagnosticsPreview entries={entries} />;
  }

  // 位置类（定义 / 实现 / 引用）：网关输出是每行一条 `path:line:col`，解析成
  // 可点击列表；认不出形状时（`No references found` 等提示）回退文本。
  if (
    normalized === 'lsp_goto_definition' ||
    normalized === 'lsp_goto_implementation' ||
    normalized === 'lsp_find_references'
  ) {
    const locations = parseLspLocations(previewOutput);
    if (locations) return <LspLocationPreview entries={locations} />;
  }

  if (normalized === 'lsp_symbols') {
    const symbols = parseLspSymbols(previewOutput);
    if (symbols) {
      const filePath = resolveSymbolsFilePath(input);
      return <LspSymbolPreview entries={symbols} {...(filePath ? { filePath } : {})} />;
    }
  }

  if (normalized === 'lsp_hover') {
    const hoverText = extractTextFromOutput(previewOutput)?.text;
    if (hoverText && hoverText.trim().length > 0) return <LspHoverPreview text={hoverText} />;
  }

  if (normalized === 'lsp_call_hierarchy') {
    const view = parseLspCallHierarchy(previewOutput);
    if (view) return <LspCallHierarchyPreview view={view} />;
  }

  if (normalized === 'lsp_prepare_rename') {
    const view = parseLspPrepareRename(previewOutput);
    if (view) return <LspPrepareRenamePreview view={view} />;
  }

  // 媒体信息：网关返回 JSON（`{type, mimeType, duration, width, height, codec…}`），
  // 字段表会把「时长 / 分辨率 / 编码」摊成原始键值。
  if (normalized === 'extract_media_info') {
    const data = extractMediaInfo(previewOutput);
    if (data) return <MediaInfoPreview data={data} />;
  }

  // 代码搜索：Exa 返回的是 Markdown 片段（代码围栏 + 说明），按 Markdown 渲染。
  if (normalized === 'codesearch') {
    const text = extractTextFromOutput(previewOutput)?.text;
    if (text && text.trim().length > 0) return <MarkdownTextPreview text={text} />;
  }

  // AST 搜索 / 替换：网关输出是 `path:line:column` + 代码片段文本，按位置还原成
  // 「文件 + 行号 + 片段」列表；替换的空结果保留原文（「无任何替换被应用」比
  // 「未找到匹配」更准确）。
  if (normalized === 'ast_grep_search' || normalized === 'ast_grep_replace') {
    const matches = parseAstGrepMatches(previewOutput);
    if (matches && (matches.length > 0 || normalized === 'ast_grep_search')) {
      return <AstGrepPreview matches={matches} />;
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
    if (typeof previewOutput === 'string' && previewOutput.trim().startsWith('{')) {
      return (
        <div>
          <div className="tool-call-search-meta">
            目录输出格式不完整或无法识别，以下保留原始内容。
          </div>
          <ExpandableOutput text={previewOutput} defaultExpanded={shouldExpandByDefault} />
        </div>
      );
    }
  }

  if (normalized === 'workspace_review_status') {
    const data = extractReviewChangesFromOutput(previewOutput);
    if (data) return <ReviewStatusPreview data={data} />;
  }

  // Task tools：create / update 也返回 `{ task }`，与 list / get 共用任务卡，
  // 避免同一族工具里「列表是卡片、单条是字段表」的割裂。
  if (
    normalized === 'task_list' ||
    normalized === 'task_get' ||
    normalized === 'task_create' ||
    normalized === 'task_update'
  ) {
    const tasks = extractTaskListFromOutput(previewOutput);
    if (tasks) return <TaskListPreview tasks={tasks} />;
  }

  // Session tools：网关返回的是 Markdown 表格 / `Key: Value` 文本（对模型友好，
  // 对人是满屏管道符）。先按文本解析成结构化视图，解析失败再走对象兜底。
  if (normalized === 'session_list') {
    const tableSessions = parseSessionListTable(previewOutput);
    if (tableSessions) return <SessionListPreview sessions={tableSessions} />;
    const sessions = extractSessionListFromOutput(previewOutput);
    if (sessions) return <SessionListPreview sessions={sessions} />;
  }

  if (normalized === 'session_info') {
    const info = parseSessionInfoText(previewOutput);
    if (info) return <SessionInfoPreview data={info} />;
    const sessions = extractSessionListFromOutput(previewOutput);
    if (sessions) return <SessionListPreview sessions={sessions} />;
  }

  if (normalized === 'session_search') {
    const hits = parseSessionSearchHits(previewOutput);
    if (hits) return <SessionSearchPreview hits={hits} />;
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

  // 会话重命名 / 移动 / LSP touch：成功只给一行确认；失败（带 error / ok:false）
  // 回退字段表，避免把失败原因藏进「✓ 成功」。
  if (
    normalized === 'session_rename' ||
    normalized === 'session_move' ||
    normalized === 'lsp_touch'
  ) {
    if (previewOutput && typeof previewOutput === 'object' && !Array.isArray(previewOutput)) {
      const record = previewOutput as Record<string, unknown>;
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

  // git_bash 的状态类工具（`which_bash` / `diagnose`）归一化到这里。
  if (normalized === 'git_bash_status') {
    const view = extractGitBashStatus(previewOutput);
    if (view) return <GitBashStatusPreview view={view} />;
  }

  // LSP 服务状态：`servers`（在跑的）+ `missing`（可安装的，带 installCommand）。
  if (normalized === 'lsp_status') {
    const view = buildLspStatusView(previewOutput);
    if (view) return <ResultViewPreview view={view} />;
  }

  // 管理类信封（`{ ok, action, … }`）：七个管理工具的列表 / 单实体 / 待确认提议。
  // 按形状识别而非按工具名枚举，新增同族管理工具自动受益。
  const adminEnvelope = extractAdminEnvelope(previewOutput);
  if (adminEnvelope) {
    const adminView = buildAdminResultView(adminEnvelope);
    if (adminView) return <ResultViewPreview view={adminView} />;
  }

  // 模型检索：行卡与表格两种排版互斥，交给渲染器提供切换。
  if (normalized === 'models') {
    const models = buildModelsResultViews(previewOutput);
    if (models) return <ResultViewPreview view={models.primary} alternate={models.alternate} />;
  }

  // 会话转录：把纯文本还原成紧凑日志。
  if (normalized === 'session_read') {
    const sessionView = parseSessionReadOutput(previewOutput);
    if (sessionView) return <SessionReadPreview view={sessionView} />;
  }

  // 渠道发送类：接口约定就是 `Promise<{ messageId }>`，剥掉信封后只剩一个技术 id。
  // 渲染成一枚确认行（「✓ 已发送了消息 · om_xxx」），比铺 `messageId | om_xxx` 的
  // 字段表更贴合「这条消息发出去了」这个事实。
  const channelAck = extractChannelAck(previewOutput);
  if (channelAck) return <SuccessConfirmPreview toolName={normalized} output={channelAck} />;

  // 渠道读取类：按**输出形状**识别（消息 / 记录 / 群组 / 成员），不枚举工具名——
  // Plugin* / Feishu* / Weixin* 各家族的读取工具因此都能命中。
  const channelView = buildChannelResultView(previewOutput);
  if (channelView) return <ResultViewPreview view={channelView} />;

  if (normalized === 'skill') {
    const skillContent = extractSkillContent(previewOutput);
    if (skillContent) return <SkillContentPreview data={skillContent} />;
  }

  if (normalized === 'question' || normalized === 'askuserquestion') {
    const answers = extractQuestionAnswers(previewOutput);
    if (answers) return <QuestionAnswerPreview items={answers} />;
  }

  // 从未经截断标记剥离的载荷判定完整性，保留完整信封供原始结果复制。
  const originalBridge = resolveMcpBuiltinBridge(
    rawToolName,
    parseStoredJsonOutput(originalOutput),
    input,
  );
  const fileChanges = parseFileChangeResult(originalBridge?.output ?? originalOutput);
  if (fileChanges)
    return (
      <FileChangeResultPreview
        result={{ ...fileChanges, raw: originalOutput }}
        sessionId={sessionId}
      />
    );

  // 写入类工具（`write` / `edit` / `multi_edit` / ssh 同族）的输出是一个
  // 「整文件信封」：`{ before, after, filediff, success, path, … }`。它不符合
  // `parseFileChangeResult` 的 `{ success, files[] }` 约定，因此此前落到
  // `StructuredOutputPreview`，把 before/after 摊成两行字段预览——用户看不到任何
  // 代码差异。这里改用专用的差异预览：文件头 + 增删行高亮，并按需展开。
  const fileSnapshot = buildFileSnapshotChangeResult(
    originalBridge?.output ?? originalOutput,
    originalOutput,
  );
  if (fileSnapshot) return <FileChangeResultPreview result={fileSnapshot} sessionId={sessionId} />;

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
 * 失败态是否交给结构化失败卡（`ToolFailurePreview`）。
 *
 * 失败时业务预览基本都渲染不出有用信息：形状对不上，或者把「为什么失败」埋进一坨
 * JSON。但两类输出必须**放行给原预览**，否则就是功能倒退：
 *
 * 1. **bash 信封**（`{command, cwd, exitCode, output, …}`）——它已有 `BashTerminalCard`
 *    （实时 stdout + 退出码），失败卡只会把终端画面换成一段 JSON；
 * 2. **能解析出文件变更 / 整文件快照的**——diff 卡自带成功 / 失败结论与 before/after，
 *    信息量高于失败卡（失败卡会把 diff 折叠进「原始输出」）。
 */
function shouldRenderFailureCard(output: unknown, isError: boolean, toolName: string): boolean {
  if (!isError) return false;
  // `question` 族的 `is_error` 语义不是失败：`Question request … has been created. Ask the
  // user to answer it…` 是正常流程提示，渲染成红色失败卡会让用户以为提问失败了。
  if (toolName === 'question' || toolName === 'askuserquestion') return false;
  if (isBashFailureEnvelope(output)) return false;
  if (parseFileChangeResult(output)) return false;
  if (buildFileSnapshotChangeResult(output, output)) return false;
  return true;
}

/**
 * bash 工具的失败信封：`{ command, cwd, exitCode, output, truncated, terminalId }`。
 */
function isBashFailureEnvelope(output: unknown): boolean {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  if (typeof record['command'] !== 'string') return false;
  return (
    typeof record['exitCode'] === 'number' ||
    typeof record['terminalId'] === 'string' ||
    typeof record['output'] === 'string'
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

/**
 * `lsp_symbols` 的文件路径。扁平 MCP 工具的参数是平平的 `input.filePath`，legacy
 * `mcp_call` 则把真实参数放在 `input.arguments` 里——两者都认，document 模式才不会
 * 因为走了 MCP 通道就丢掉路径（归一化后这条路只剩一个分支，必须自己覆盖两种形状）。
 */
function resolveSymbolsFilePath(input?: Record<string, unknown>): string | undefined {
  const flat = input?.['filePath'];
  const args = input?.['arguments'];
  const nested =
    args !== null && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)['filePath']
      : undefined;
  const candidate = typeof flat === 'string' ? flat : nested;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}
