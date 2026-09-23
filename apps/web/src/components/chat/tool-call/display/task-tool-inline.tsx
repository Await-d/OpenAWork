import { Fragment, type ReactNode } from 'react';
import {
  ToolKindIcon,
  resolveSubagentSessionIdFromToolOutput,
  resolveToolCallCardDisplayData,
  tokens,
} from '@openAwork/shared-ui';
import type { ToolCallCardProps } from '@openAwork/shared-ui';
import type { TaskToolRuntimeSnapshot } from '../../../../pages/chat-page/conversation/render/task-tool-runtime.js';

interface TaskToolInlineProps {
  approvalActions?: ToolCallCardProps['approvalActions'];
  kind?: ToolCallCardProps['kind'];
  onOpenChildSession?: (sessionId: string) => void;
  pendingPermissionRequestId?: string;
  runtimeSnapshot?: TaskToolRuntimeSnapshot;
  selectedChildSessionId?: string | null;
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  status?: ToolCallCardProps['status'];
}

interface TaskInlineDetailItem {
  kind: 'footer' | 'hint' | 'summary' | 'timeout';
  text: string;
}

type TaskInlineMetaTone = 'danger' | 'info' | 'muted' | 'success' | 'warning';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readTaskTimeoutSource(
  value: unknown,
): TaskToolRuntimeSnapshot['timeoutSource'] | undefined {
  const record = asRecord(value);
  const timeoutSource = record?.['timeoutSource'];
  switch (timeoutSource) {
    case 'first_response':
      return timeoutSource;
    default:
      return undefined;
  }
}

function formatTaskTimeoutSourceLabel(
  timeoutSource: TaskToolRuntimeSnapshot['timeoutSource'],
): string {
  return timeoutSource === 'first_response' ? '首响应未到' : '执行超时';
}

function resolveTaskStatusBadge(status: string | undefined): {
  color: 'danger' | 'info' | 'muted' | 'success' | 'warning';
  label: string;
} | null {
  if (!status) return null;
  if (status === 'done' || status === 'completed') return { color: 'success', label: '子任务完成' };
  if (status === 'failed') return { color: 'danger', label: '子任务失败' };
  if (status === 'paused') return { color: 'warning', label: '等待处理' };
  if (status === 'pending') return { color: 'warning', label: '子任务待执行' };
  if (status === 'in_progress' || status === 'running') {
    return { color: 'warning', label: '子任务执行中' };
  }
  if (status === 'cancelled') return { color: 'muted', label: '子任务已取消' };
  return { color: 'muted', label: `子任务 ${status}` };
}

function resolveToolStatusBadge(
  status: ToolCallCardProps['status'],
  isError: boolean | undefined,
): {
  color: 'danger' | 'info' | 'muted' | 'success' | 'warning';
  label: string;
} | null {
  if (isError || status === 'failed') return { color: 'danger', label: '工具失败' };
  if (status === 'paused') return { color: 'warning', label: '等待权限' };
  if (status === 'running') return { color: 'info', label: '工具执行中' };
  return null;
}

const EXTRA_OUTPUT_TEXT_KEYS = [
  'message',
  'result',
  'summary',
  'error',
  'errorMessage',
  'detail',
  'content',
  'text',
] as const;

/**
 * 从 task 输出的剩余字段中提取可读提示。此前直接 `JSON.stringify` 整个对象，
 * 会让内联卡片展示 `{ "agentType": ... }` 这类原始 JSON 噪音。
 */
function summarizeExtraOutput(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? `共 ${value.length} 项` : null;
  }

  const record = value as Record<string, unknown>;
  for (const key of EXTRA_OUTPUT_TEXT_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const keys = Object.keys(record);
  return keys.length > 0 ? `字段：${keys.slice(0, 4).join('、')}` : null;
}

function compactIdentifier(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function summarizeRuntimeState(
  runtimeSnapshot: TaskToolRuntimeSnapshot | undefined,
): string | null {
  if (!runtimeSnapshot) {
    return null;
  }

  const source = runtimeSnapshot.errorMessage ?? runtimeSnapshot.result;
  if (!source) {
    return null;
  }

  const normalized = source.trim();
  if (normalized.length === 0) {
    return null;
  }

  const prefix = runtimeSnapshot.errorMessage ? '✗' : '✓';
  return normalized.length <= 140
    ? `${prefix} ${normalized}`
    : `${prefix} ${normalized.slice(0, 139).trimEnd()}…`;
}

function readTaskAgentType(input: Record<string, unknown>): string | undefined {
  // `agent` 是上游 `subagent` 工具的 `subagent_type` 别名。
  return readNonEmptyString(input['subagent_type']) ?? readNonEmptyString(input['agent']);
}

function readTaskFallbackTitle(input: Record<string, unknown>): string {
  const candidates = [input['description'], input['command'], input['prompt']];
  for (const candidate of candidates) {
    const value = readNonEmptyString(candidate);
    if (value) {
      return value;
    }
  }

  return '子代理任务';
}

/**
 * 子代理输出可能是对象（`task` / `subagent`）或文本（`call_omo_agent` 的
 * `<subagent sessionID="…">` 包裹 / 「会话 ID：…」行）：以对象字段优先，
 * 文本形态由 shared-ui 的提取函数兜底。
 */
function resolveTaskChildSessionId(input: {
  input: Record<string, unknown>;
  output: unknown;
  taskMetaOutputSessionId?: string;
  taskMetaRequestedSessionId?: string;
  runtimeSnapshot?: TaskToolRuntimeSnapshot;
}): string | null {
  const candidates: Array<string | undefined> = [
    input.runtimeSnapshot?.sessionId,
    input.taskMetaOutputSessionId,
    input.taskMetaRequestedSessionId,
    readNonEmptyString(asRecord(input.output)?.['sessionId']),
    resolveSubagentSessionIdFromToolOutput(input.output),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function readTaskFallbackFooter(input: {
  childSessionId: string | null;
  output: unknown;
}): string | null {
  if (input.childSessionId) {
    return `会话 ${compactIdentifier(input.childSessionId)}`;
  }

  const record = asRecord(input.output);
  const taskId = readNonEmptyString(record?.['taskId']);
  return taskId ? `任务 ${compactIdentifier(taskId)}` : null;
}

function buildDetailItems(input: {
  hintText: string | null;
  metaText: string | null;
  runtimeSummary: string | null;
  timeoutText: string | null;
}): TaskInlineDetailItem[] {
  const items: TaskInlineDetailItem[] = [];

  if (input.metaText) {
    items.push({ kind: 'footer', text: input.metaText });
  }

  if (input.runtimeSummary) {
    items.push({ kind: 'summary', text: input.runtimeSummary });
  }

  if (input.timeoutText) {
    items.push({ kind: 'timeout', text: input.timeoutText });
  }

  if (input.hintText) {
    items.push({ kind: 'hint', text: input.hintText });
  }

  return items;
}

function renderDetailItems(items: TaskInlineDetailItem[]) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="chat-task-inline-detail"
      data-chat-task-inline-detail="true"
      title={items.map((item) => item.text).join(' · ')}
    >
      {items.map((item, index) => (
        <Fragment key={`${item.kind}-${item.text}-${index}`}>
          {index > 0 ? (
            <span className="chat-task-inline-detail-separator" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span className={`chat-task-inline-${item.kind}`}>{item.text}</span>
        </Fragment>
      ))}
    </div>
  );
}

function resolveMetaLabelColor(tone: TaskInlineMetaTone): string {
  if (tone === 'danger') return tokens.color.danger;
  if (tone === 'info') return tokens.color.info;
  if (tone === 'success') return tokens.color.success;
  if (tone === 'warning') return tokens.color.warning;
  return tokens.color.muted;
}

function TaskInlineMetaLabel({ label, tone }: { label: string; tone: TaskInlineMetaTone }) {
  return (
    <span
      className="chat-task-inline-meta-label"
      data-chat-task-inline-meta-label={tone}
      style={{ color: resolveMetaLabelColor(tone) }}
    >
      {label}
    </span>
  );
}

function TaskToolKindBadge() {
  return (
    <span
      className="chat-task-inline-kind-icon"
      data-chat-task-inline-kind-icon="agent"
      role="img"
      aria-label="子代理工具"
      title="子代理工具"
    >
      <ToolKindIcon kind="agent" />
    </span>
  );
}

/**
 * 子代理卡片的容器骨架：`button`（可点击，携带 hover / focus / selected 语义）
 * 或 `div`（纯展示）。富信息分支与精简分支共用，避免两条渲染路径的可点击性
 * 与选中态各自漂移——历史缺陷：精简分支（输出缺失 / 工具名不在旧名单内）
 * 永远 `data-clickable="false"`，点击没有任何反馈。
 */
function TaskInlineShell({
  childSessionId,
  children,
  onOpenChildSession,
  selectedChildSessionId,
}: {
  childSessionId: string | null;
  children: ReactNode;
  onOpenChildSession?: (sessionId: string) => void;
  selectedChildSessionId?: string | null;
}) {
  const isClickable = Boolean(childSessionId && onOpenChildSession);
  const isSelected = childSessionId !== null && childSessionId === selectedChildSessionId;
  const ContainerTag = isClickable ? 'button' : 'div';

  return (
    <ContainerTag
      className="chat-task-inline"
      data-chat-task-inline="true"
      data-clickable={isClickable ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      {...(isClickable
        ? {
            onClick: () => {
              if (childSessionId && onOpenChildSession) {
                onOpenChildSession(childSessionId);
              }
            },
            type: 'button' as const,
          }
        : {})}
    >
      <div className="chat-task-inline-rail" aria-hidden="true" />
      <div className="chat-task-inline-main">{children}</div>
    </ContainerTag>
  );
}

export function TaskToolInline(props: TaskToolInlineProps) {
  const displayData = resolveToolCallCardDisplayData({
    toolCallId: props.toolCallId,
    toolName: props.toolName,
    input: props.input,
    output: props.output,
  });

  const childSessionId = resolveTaskChildSessionId({
    input: props.input,
    output: props.output,
    taskMetaOutputSessionId: displayData.taskMeta?.outputSessionId,
    taskMetaRequestedSessionId: displayData.taskMeta?.requestedSessionId,
    runtimeSnapshot: props.runtimeSnapshot,
  });
  const isClickable = Boolean(childSessionId && props.onOpenChildSession);
  const isSelected = childSessionId !== null && childSessionId === props.selectedChildSessionId;
  const hintText = isClickable ? (isSelected ? '正在查看' : '点击查看') : null;

  if (!displayData.taskMeta || !displayData.taskSummary) {
    const fallbackTitle = readTaskFallbackTitle(props.input);
    const agentType = readTaskAgentType(props.input);
    const fallbackDetailItems = buildDetailItems({
      metaText: readTaskFallbackFooter({ childSessionId, output: props.output }),
      runtimeSummary: null,
      hintText,
      timeoutText: null,
    });

    return (
      <TaskInlineShell
        childSessionId={childSessionId}
        onOpenChildSession={props.onOpenChildSession}
        selectedChildSessionId={props.selectedChildSessionId}
      >
        <div className="chat-task-inline-meta">
          <TaskToolKindBadge />
          {agentType ? <TaskInlineMetaLabel label={agentType} tone="muted" /> : null}
        </div>
        <div className="chat-task-inline-title" title={fallbackTitle}>
          {fallbackTitle}
        </div>
        {renderDetailItems(fallbackDetailItems)}
      </TaskInlineShell>
    );
  }

  const effectiveTaskStatus = props.runtimeSnapshot?.status ?? displayData.taskMeta.outputStatus;
  const taskStatusBadge = resolveTaskStatusBadge(effectiveTaskStatus);
  const toolStatusBadge = resolveToolStatusBadge(props.status, props.isError);
  const extraOutputText = summarizeExtraOutput(displayData.taskMeta.extraOutput);
  const titleText = displayData.taskSummary.subtitle ?? displayData.taskSummary.title;
  const runtimeSummary = summarizeRuntimeState(props.runtimeSnapshot);
  const runtimeTerminalReason = props.runtimeSnapshot?.terminalReason;
  const outputReason = (() => {
    const record = asRecord(props.output);
    return typeof record?.['reason'] === 'string' ? record['reason'] : undefined;
  })();
  const timeoutSource =
    props.runtimeSnapshot?.timeoutSource ??
    readTaskTimeoutSource(props.output) ??
    readTaskTimeoutSource(displayData.taskMeta.extraOutput);
  const metaText = childSessionId
    ? `会话 ${compactIdentifier(childSessionId)}`
    : (extraOutputText ?? displayData.summary);
  const timeoutText =
    runtimeTerminalReason === 'timeout' || outputReason === 'timeout'
      ? timeoutSource
        ? `超时原因：${formatTaskTimeoutSourceLabel(timeoutSource)}`
        : '超时原因：执行超时'
      : null;
  const detailItems = buildDetailItems({
    metaText,
    runtimeSummary,
    hintText,
    timeoutText,
  });

  return (
    <TaskInlineShell
      childSessionId={childSessionId}
      onOpenChildSession={props.onOpenChildSession}
      selectedChildSessionId={props.selectedChildSessionId}
    >
      <div className="chat-task-inline-meta">
        <TaskToolKindBadge />
        {displayData.taskMeta.agentType && (
          <TaskInlineMetaLabel label={displayData.taskMeta.agentType} tone="muted" />
        )}
        {displayData.taskMeta.readonly && <TaskInlineMetaLabel label="只读" tone="muted" />}
        {toolStatusBadge && (
          <TaskInlineMetaLabel label={toolStatusBadge.label} tone={toolStatusBadge.color} />
        )}
        {taskStatusBadge && (
          <TaskInlineMetaLabel label={taskStatusBadge.label} tone={taskStatusBadge.color} />
        )}
      </div>
      <div className="chat-task-inline-title" title={titleText}>
        {titleText}
      </div>
      {renderDetailItems(detailItems)}
    </TaskInlineShell>
  );
}
