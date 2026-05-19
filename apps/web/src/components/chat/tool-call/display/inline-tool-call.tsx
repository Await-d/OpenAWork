import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo, useState } from 'react';
import { ToolIcon } from './tool-icon';
import { colorizeSummary, getToolCategory } from '../shared/colorize-summary.js';
import { extractErrorSummary } from '../shared/extract-error-summary.js';
import { extractFilePath } from '../shared/input-paths.js';
import {
  buildGenericInputSummary,
  summarizeBackgroundCancelInput,
  summarizeExitPlanModeInput,
  summarizeQuestionInput,
  summarizeSessionInfoInput,
  summarizeTodoWriteInput,
} from '../shared/input-summary.js';
import { buildLspInlineSummary } from '../shared/lsp-summary.js';
import { ToolApprovalActions } from '../shared/tool-approval-actions.js';
import {
  extractTodosFromOutput,
  type TodoLikeItem,
  TodoListPreview,
} from '../previews/todo-list-preview.js';
import { ToolInputPreview } from '../io/tool-input-preview.js';
import { ToolOutputPreview } from '../io/tool-output-preview.js';

/* ── InlineToolCall ── */

export function InlineToolCall({
  approvalActions,
  kind,
  toolName,
  input,
  output,
  status,
  isError,
}: {
  approvalActions?: ToolCallCardProps['approvalActions'];
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
}) {
  const filePath = extractFilePath(input);
  const normalized = toolName.trim().toLowerCase();
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });

  // LSP tools render as a single-line, non-expandable pill — outputs are
  // short structured payloads (one location, hover blurb, diagnostics map)
  // that can be summarised in ~60 chars without losing useful info. The
  // lsp_* contract is enforced by buildLspInlineSummary (`shared/lsp-summary.ts`).
  const isLsp = normalized.startsWith('lsp_');

  const summary = useMemo(() => {
    if (isLsp) {
      return buildLspInlineSummary({
        toolName,
        input,
        output,
        visualState,
        ...(isError !== undefined ? { isError } : {}),
      });
    }
    if (normalized === 'question' || normalized === 'askuserquestion') {
      // `question` / `AskUserQuestion` carry the entire prompt list inside
      // `input.questions`; the generic fallback would render "questions×N"
      // which loses the actual question text. Surface the first question's
      // header so users see *what* they're being asked.
      const qSummary = summarizeQuestionInput(input);
      if (qSummary) return qSummary;
    }
    if (normalized === 'enterplanmode') {
      // EnterPlanMode takes no input — generic returns empty. Show a friendly
      // label that mirrors what the model is doing.
      return '进入计划模式';
    }
    if (normalized === 'exitplanmode') {
      // ExitPlanMode carries the proposed plan as markdown text. Surface a
      // 60-char preview so users can decide whether to drill in.
      const planSummary = summarizeExitPlanModeInput(input);
      if (planSummary) return `退出计划模式 · ${planSummary}`;
      return '退出计划模式';
    }
    if (normalized === 'background_cancel') {
      // Output is a short success/error message, so the pill is the entire
      // useful UI. helper handles {all:true} vs {taskId|task_id|runId}.
      const s = summarizeBackgroundCancelInput(input);
      return s ?? 'background_cancel';
    }
    if (normalized === 'session_info') {
      // session_info returns metadata about a single session id — surfacing
      // the id is enough before the user drills into the output card.
      const s = summarizeSessionInfoInput(input);
      return s ?? 'session_info';
    }
    if (normalized === 'grep') {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return filePath ? `${filePath} · "${pattern}"` : `"${pattern}"`;
    }
    if (normalized === 'glob') {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return filePath ? `${filePath} · "${pattern}"` : `"${pattern}"`;
    }
    if (normalized === 'read') {
      if (filePath) {
        const offset = typeof input.offset === 'number' ? input.offset : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const suffix =
          offset != null || limit != null
            ? ` [${limit != null ? `limit=${limit}` : ''}${offset != null ? `${limit != null ? ', ' : ''}offset=${offset}` : ''}]`
            : '';
        return `${filePath}${suffix}`;
      }
      return 'reading…';
    }
    if (normalized === 'skill') {
      const skillId = typeof input.skillId === 'string' ? input.skillId : '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (skillId && prompt)
        return `${skillId} · "${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}"`;
      if (skillId) return skillId;
      if (prompt) return `"${prompt.slice(0, 50)}${prompt.length > 50 ? '…' : ''}"`;
    }
    if (normalized === 'todowrite' || normalized === 'subtodowrite') {
      // Show "5 项 · 3待办/2完成" when the todos array is present, otherwise
      // gracefully fall through to generic so a malformed call still renders.
      const todoSummary = summarizeTodoWriteInput(input);
      if (todoSummary) return todoSummary;
    }
    if (normalized === 'todoread' || normalized === 'subtodoread') {
      // Reads take no input — generic summary would be empty. Use a friendly
      // label that mirrors what the model is doing.
      return normalized === 'subtodoread' ? '读取临时待办' : '读取主待办';
    }
    if (filePath) return filePath;
    const generic = buildGenericInputSummary(input);
    return generic || '';
  }, [isLsp, normalized, input, output, filePath, toolName, visualState, isError]);

  // Every inline tool is expandable so the user can always inspect both the
  // raw input parameters and any output. Previously this was gated on a
  // tiny allow-list (`read` + `lsp_*`), which left todowrite/subtodowrite/
  // skill/question card cells with no way to drill into details — exactly
  // the problem the user flagged after the JSON-leak fix.
  //
  // LSP tools are the deliberate exception: per user request, they render
  // as a non-expandable single-line pill since the summary already encodes
  // the position + a status suffix (✓ N 个引用 / ✗ 失败 / …).
  const hasInput = Object.keys(input).length > 0;
  const hasOutput = output !== undefined;
  const canExpand = !isLsp && (hasInput || hasOutput);
  // Default expanded so users see the parameters/output of every tool
  // call without an extra click. They can still toggle via the chevron.
  //
  // Important: we use `true` (not `canExpand`) here because streaming
  // tool calls render *before* their args arrive — on the first tick
  // `input` is `{}` and `output` is undefined, so `canExpand` evaluates
  // to `false` and `useState` locks the initial value in. By the time
  // input.todos / output stream in, `canExpand` flips to `true` but the
  // `expanded` state is still `false` — the bug the user flagged where
  // todowrite cards always rendered collapsed. LSP tools (canExpand
  // never true) still hide the panel via the `expanded && canExpand`
  // render guard below, and the chevron + click handler only attach
  // when canExpand is true, so the harmless `true` default for the
  // LSP path has no visual effect.
  const [expanded, setExpanded] = useState(true);

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

  return (
    <div className="tool-call-inline-wrap" data-tool-status={visualState}>
      <div
        className="tool-call-inline"
        data-tool-status={visualState}
        {...(canExpand
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => setExpanded((p) => !p),
              style: { cursor: 'pointer' },
            }
          : {})}
      >
        <ToolIcon kind={kind} toolName={toolName} status={visualState} size={13} />
        <span className="tool-call-inline-name" data-tool-category={getToolCategory(toolName)}>
          {toolName}
        </span>
        <span className="tool-call-inline-summary">{colorizeSummary(summary)}</span>
        {errorSummary && (
          <span className="tool-call-error-summary" title={errorSummary}>
            {errorSummary}
          </span>
        )}
        {canExpand && <span className="tool-call-inline-chevron">{expanded ? '▾' : '▸'}</span>}
      </div>
      {expanded && canExpand && (
        <div className="tool-call-inline-output">
          {isTodoFamily && todoFamilyTodos !== null ? (
            todoFamilyTodos.length === 0 ? (
              <div className="tool-call-inline-empty">（暂无待办项）</div>
            ) : (
              <TodoListPreview todos={todoFamilyTodos} />
            )
          ) : (
            <>
              {hasInput && (
                <div className="tool-call-inline-section" data-inline-row="true">
                  <div className="tool-call-inline-section-label">参数</div>
                  <ToolInputPreview toolName={toolName} input={input} />
                </div>
              )}
              {hasOutput && (
                <div className="tool-call-inline-section">
                  <div className="tool-call-inline-section-label">输出</div>
                  <ToolOutputPreview toolName={toolName} output={output} />
                </div>
              )}
            </>
          )}
        </div>
      )}
      <ToolApprovalActions approvalActions={approvalActions} />
    </div>
  );
}
