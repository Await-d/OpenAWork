import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo } from 'react';
import { useToolExpandDefault } from '../../../../stores/settings/use-tool-expand-default.js';
import { useToolCallExpandState } from '../shared/use-tool-call-expand-state.js';
import { ToolIcon } from './tool-icon';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import {
  parseMaybeJsonPayload,
  resolveLspMcpToolName,
  resolveMcpLspPayload,
} from '../shared/lsp-mcp-view.js';
import { buildLspInlineSummary } from '../shared/lsp-summary.js';
import { naturalLanguageSummary } from '../shared/natural-language-summary.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import {
  extractTodosFromOutput,
  type TodoLikeItem,
  TodoListPreview,
} from '../previews/todo-list-preview.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';
import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';

/* ── InlineToolCall ── */

export function InlineToolCall({
  approvalActions,
  pendingPermissionRequestId,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
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
  /**
   * 嵌在 batch 子行展开区里渲染：外层行已提供工具名 / 摘要 / 状态，
   * 这里隐藏整行 header，只渲染输出本体（入参不展示——用户口径：入参不重要）。
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

  // LSP tools 仍以单行摘要为主（位置 + 状态，见 `shared/lsp-summary.ts`），但展开
  // 能力必须保留：摘要只说「0 个引用」「诊断 3 个问题」时，用户需要能点开看到
  // 具体位置与诊断内容，否则这条调用等于不可查证。
  //
  // 虚拟 LSP MCP（`mcp__lsp__find_references`）映射回内置名 `lsp_find_references`，
  // 这样位置描述与状态汇总直接复用同一套纯函数，不会出现两套文案口径。
  const lspMcpInner = resolveLspMcpToolName(toolName, input);
  const lspToolName = lspMcpInner ? `lsp_${lspMcpInner}` : toolName;
  const isLsp = lspToolName.trim().toLowerCase().startsWith('lsp_');

  const summary = useMemo(() => {
    if (isLsp) {
      // MCP 通道的 output 是 `{ content: [{ type: 'text', text }] }` 包装，摘要函数
      // 认的是内层载荷（`path:line:col` 文本 / 诊断 map），否则只会显示「✓ 完成」。
      const lspOutput = lspMcpInner ? parseMaybeJsonPayload(resolveMcpLspPayload(output)) : output;
      return buildLspInlineSummary({
        toolName: lspToolName,
        input,
        output: lspOutput,
        visualState,
        ...(isError !== undefined ? { isError } : {}),
      });
    }
    return naturalLanguageSummary(toolName, input, output);
  }, [isLsp, lspMcpInner, lspToolName, toolName, input, output, visualState, isError]);

  // 所有 inline 工具都可展开，保证用户总能查看原始入参与输出。LSP 也不例外：
  // 摘要里的位置与状态只是入口，真正的定义 / 引用 / 诊断内容在展开体里。
  const hasInput = Object.keys(input).length > 0;
  const hasOutput = output !== undefined;
  const canExpand = hasInput || hasOutput;
  const shouldExpandByDefault = useToolExpandDefault()(toolName);
  const [expanded, toggleExpanded] = useToolCallExpandState({
    canExpand,
    shouldAutoExpand: shouldExpandByDefault,
    shouldExpandByDefault,
  });

  // Surface a short red error line in the header on failure so users
  // see *what went wrong* without expanding. The full payload (stack
  // traces, stderr) is still available in the expanded output panel.
  const errorSummary = useMemo(
    () => (visualState === 'failed' ? extractErrorSummary(output, isError) : null),
    [visualState, output, isError],
  );

  // Todo-family tools (todowrite/subtodowrite/todoread/subtodoread) all
  // resolve to the same checklist: write echoes input back as
  // metadata.todos, read returns metadata.todos directly. Rendering
  // both `参数` (input.todos) and `输出` (metadata.todos) showed the
  // identical list twice with two heavy uppercase labels — the layout
  // the user flagged as ugly. Collapse them into a single panel here.
  // Prefer output (post-execution authoritative) and fall back to
  // input.todos so an in-flight write still renders before the output
  // streams in. Returning null lets a malformed call fall through to
  // the generic params/output render.
  const isTodoFamily =
    normalized === 'todowrite' ||
    normalized === 'subtodowrite' ||
    normalized === 'todoread' ||
    normalized === 'subtodoread';
  const todoFamilyTodos = useMemo<TodoLikeItem[] | null>(() => {
    if (!isTodoFamily) return null;
    const fromOutput = extractTodosFromOutput(output);
    if (fromOutput !== null) return fromOutput;
    if (Array.isArray(input.todos)) return input.todos as TodoLikeItem[];
    return null;
  }, [isTodoFamily, input, output]);

  // embedded：外层 batch 子行就是唯一的 disclosure，直接渲染输出面板。
  const showInlineRow = !embedded;
  const showOutputPanel = embedded || (expanded && canExpand);
  // 查看类（read）/ 提问类（question）：内容本体（文件预览 / 问答对）已经把入参
  // 表达出来，展开区不再出现「参数」等分区标签（用户口径：不要多余的分区提示）。
  // LSP 也归入「摘要已表达入参」：`file:line:char → "newName"` 就在标题里，
  // 展开区再铺一遍参数只会把输出区推得更远。
  const hideParams =
    normalized === 'read' || normalized === 'question' || normalized === 'askuserquestion' || isLsp;
  // read 展开态：路径 + 行区间已经在预览的 meta 行里（带「点击预览」），摘要不再
  // 重复展示同一个路径（用户口径：两处合成一处，且保留 meta 的点击预览）。
  const summaryText =
    normalized === 'read' && showOutputPanel
      ? naturalLanguageSummary(toolName, input, output, { omitPath: true })
      : summary;

  return (
    <div className="tool-call-inline-wrap" data-tool-status={visualState}>
      {showInlineRow && (
        <div
          className="tool-call-inline"
          data-tool-status={visualState}
          {...(canExpand
            ? {
                role: 'button',
                tabIndex: 0,
                onClick: toggleExpanded,
                style: { cursor: 'pointer' },
              }
            : {})}
        >
          <ToolIcon kind={kind} toolName={toolName} status={visualState} size={13} />
          <span className="tool-call-inline-name" data-tool-category={getToolCategory(toolName)}>
            {toolName}
          </span>
          <span className="tool-call-inline-summary">{colorizeSummary(summaryText)}</span>
          {errorSummary && (
            <span className="tool-call-error-summary" title={errorSummary}>
              {errorSummary}
            </span>
          )}
          {canExpand && <span className="tool-call-inline-chevron">{expanded ? '▾' : '▸'}</span>}
        </div>
      )}
      {showOutputPanel && (
        <ToolCardExpansionProvider>
          <div className="tool-call-inline-output" data-embedded={embedded ? 'true' : undefined}>
            {isTodoFamily && todoFamilyTodos !== null ? (
              todoFamilyTodos.length === 0 ? (
                <div className="tool-call-inline-empty">（暂无待办项）</div>
              ) : (
                <TodoListPreview todos={todoFamilyTodos} />
              )
            ) : (
              <>
                {hasInput && !embedded && !hideParams && (
                  <div className="tool-call-inline-section" data-inline-row="true">
                    <div className="tool-call-inline-section-label">参数</div>
                    <ToolInputPreview toolName={toolName} input={input} kind={kind} />
                  </div>
                )}
                {hasOutput && (
                  <div className="tool-call-inline-section">
                    <ToolOutputPreview toolName={toolName} output={output} input={input} />
                  </div>
                )}
              </>
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
