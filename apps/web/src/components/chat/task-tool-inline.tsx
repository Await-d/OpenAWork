import { Fragment } from 'react';
import { ToolKindIcon, resolveToolCallCardDisplayData, tokens } from '@openAwork/shared-ui';
import type { ToolCallCardProps } from '@openAwork/shared-ui';
import type { TaskToolRuntimeSnapshot } from '../../pages/chat-page/task-tool-runtime.js';

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
  kind: 'footer' | 'hint' | 'summary';
  text: string;
}

type TaskInlineMetaTone = 'danger' | 'info' | 'muted' | 'success' | 'warning';

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

function summarizeExtraOutput(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 0 ? serialized : null;
  } catch {
    return null;
  }
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

function readTaskFallbackTitle(input: Record<string, unknown>): string {
  const candidates = [input['description'], input['command'], input['prompt']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return '子代理任务';
}

function readTaskFallbackFooter(output: unknown): string | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }

  const record = output as Record<string, unknown>;

  const sessionId =
    typeof record['sessionId'] === 'string' && record['sessionId'].trim().length > 0
      ? record['sessionId'].trim()
      : null;
  const taskId =
    typeof record['taskId'] === 'string' && record['taskId'].trim().length > 0
      ? record['taskId'].trim()
      : null;

  if (sessionId) {
    return `会话 ${compactIdentifier(sessionId)}`;
  }

  if (taskId) {
    return `任务 ${compactIdentifier(taskId)}`;
  }

  return null;
}

function buildDetailItems(input: {
  hintText: string | null;
  metaText: string | null;
  runtimeSummary: string | null;
}): TaskInlineDetailItem[] {
  const items: TaskInlineDetailItem[] = [];

  if (input.metaText) {
    items.push({ kind: 'footer', text: input.metaText });
  }

  if (input.runtimeSummary) {
    items.push({ kind: 'summary', text: input.runtimeSummary });
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

export function TaskToolInline(props: TaskToolInlineProps) {
  const displayData = resolveToolCallCardDisplayData({
    toolCallId: props.toolCallId,
    toolName: props.toolName,
    input: props.input,
    output: props.output,
  });

  if (!displayData.taskMeta || !displayData.taskSummary) {
    const fallbackTitle = readTaskFallbackTitle(props.input);
    const fallbackDetailItems = buildDetailItems({
      metaText: readTaskFallbackFooter(props.output),
      runtimeSummary: null,
      hintText: null,
    });

    return (
      <div className="chat-task-inline" data-chat-task-inline="true" data-clickable="false">
        <div className="chat-task-inline-rail" aria-hidden="true" />
        <div className="chat-task-inline-main">
          <div className="chat-task-inline-meta">
            <TaskToolKindBadge />
            {typeof props.input['subagent_type'] === 'string' &&
            props.input['subagent_type'].trim() ? (
              <TaskInlineMetaLabel label={props.input['subagent_type'].trim()} tone="info" />
            ) : null}
          </div>
          <div className="chat-task-inline-title" title={fallbackTitle}>
            {fallbackTitle}
          </div>
          {renderDetailItems(fallbackDetailItems)}
        </div>
      </div>
    );
  }

  const effectiveTaskStatus = props.runtimeSnapshot?.status ?? displayData.taskMeta.outputStatus;
  const taskStatusBadge = resolveTaskStatusBadge(effectiveTaskStatus);
  const toolStatusBadge = resolveToolStatusBadge(props.status, props.isError);
  const extraOutputText = summarizeExtraOutput(displayData.taskMeta.extraOutput);
  const childSessionId =
    props.runtimeSnapshot?.sessionId ?? displayData.taskMeta.outputSessionId ?? null;
  const isClickable = Boolean(childSessionId && props.onOpenChildSession);
  const isSelected = childSessionId !== null && childSessionId === props.selectedChildSessionId;
  const ContainerTag = isClickable ? 'button' : 'div';
  const titleText = displayData.taskSummary.subtitle ?? displayData.taskSummary.title;
  const runtimeSummary = summarizeRuntimeState(props.runtimeSnapshot);
  const metaText = childSessionId
    ? `会话 ${compactIdentifier(childSessionId)}`
    : (extraOutputText ?? displayData.summary);
  const hintText = isClickable ? (isSelected ? '正在查看' : '点击查看') : null;
  const detailItems = buildDetailItems({
    metaText,
    runtimeSummary,
    hintText,
  });

  return (
    <ContainerTag
      className="chat-task-inline"
      data-chat-task-inline="true"
      data-clickable={isClickable ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      {...(isClickable
        ? {
            onClick: () => {
              if (childSessionId && props.onOpenChildSession) {
                props.onOpenChildSession(childSessionId);
              }
            },
            type: 'button' as const,
          }
        : {})}
    >
      <div className="chat-task-inline-rail" aria-hidden="true" />
      <div className="chat-task-inline-main">
        <div className="chat-task-inline-meta">
          <TaskToolKindBadge />
          {displayData.taskMeta.agentType && (
            <TaskInlineMetaLabel label={displayData.taskMeta.agentType} tone="info" />
          )}
          {displayData.taskMeta.readonly && <TaskInlineMetaLabel label="只读" tone="success" />}
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
      </div>
    </ContainerTag>
  );
}
