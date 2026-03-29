import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { StatusPill } from './primitives/index.js';
import { tokens } from './tokens.js';
import type { ToolDiffFileView } from './ToolDiffCollection.js';
import { ToolDiffCollection } from './ToolDiffCollection.js';
import { UnifiedCodeDiff, summarizeSnapshotDiff, summarizeUnifiedDiff } from './UnifiedCodeDiff.js';

type ToolCardStatus = 'running' | 'paused' | 'completed' | 'failed';

interface TaskToolMeta {
  agentType?: string;
  command?: string;
  description?: string;
  prompt?: string;
  requestedTaskId?: string;
  outputTaskId?: string;
  outputSessionId?: string;
  outputStatus?: string;
  readonly: boolean;
  extraOutput?: unknown;
  hasAdditionalInputFields: boolean;
}

interface TaskSummaryData {
  footer?: string;
  preview?: string;
  subtitle?: string;
  title: string;
}

export interface ToolCallCardProps {
  kind?: ToolKind;
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  status?: ToolCardStatus;
  style?: CSSProperties;
}

interface StatusMeta {
  color: string;
  dot: string;
  label: string;
}

type ToolKind = 'agent' | 'mcp' | 'skill' | 'tool';
type PillTone = 'danger' | 'info' | 'muted' | 'success' | 'warning';

export interface ToolCallCardDisplayData {
  displayToolName: string;
  diffView?: {
    afterText?: string;
    beforeText?: string;
    diffText?: string;
    filePath?: string;
    files?: ToolDiffFileView[];
    summary: string;
  };
  hasDetails: boolean;
  outputPreview?: string;
  outputReadHints?: string[];
  showInputField: boolean;
  summary: string;
  taskMeta?: TaskToolMeta;
  taskSummary?: TaskSummaryData;
  toolKind: ToolKind;
}

function ToolKindIcon({ kind }: { kind: ToolKind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'mcp') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M8 8h8v8H8z" />
        <path d="M4 12h4" />
        <path d="M16 12h4" />
        <path d="M12 4v4" />
        <path d="M12 16v4" />
      </svg>
    );
  }

  if (kind === 'skill') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2Z" />
      </svg>
    );
  }

  if (kind === 'agent') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 11h.01" />
        <path d="M14 11h.01" />
        <path d="M9 15h6" />
        <path d="M12 3v4" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden="true">
      <path d="m14 7 3 3" />
      <path d="m5 19 4.5-1 8-8a2.12 2.12 0 0 0-3-3l-8 8Z" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function trimFileLikePath(value: string): string {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join('/');
}

function trimInputPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim();
  if (normalized.length === 0) {
    return '';
  }

  const projectMatch = normalized.match(/\/project\/[^/]+\/(.+)$/u);
  if (projectMatch?.[1]) {
    return projectMatch[1];
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 7 ? segments.slice(-7).join('/') : segments.join('/');
}

function quoteSummaryValue(value: string): string {
  return /[\s,[\]=]/u.test(value) ? JSON.stringify(value) : value;
}

function stringifySummaryParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? quoteSummaryValue(normalized) : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function buildParamSuffix(entries: Array<[label: string, value: unknown]>): string {
  const parts = entries
    .map(([label, value]) => {
      const formatted = stringifySummaryParam(value);
      return formatted ? `${label}=${formatted}` : null;
    })
    .filter((item): item is string => Boolean(item));

  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

function buildSnapshotSummary(
  filePath: string | undefined,
  beforeText: string,
  afterText: string,
): string {
  const summary = summarizeSnapshotDiff(beforeText, afterText);
  return `${filePath ? `${trimFileLikePath(filePath)} · ` : ''}+${summary.added} / -${summary.removed}`;
}

function buildDiffFileView(record: Record<string, unknown>): ToolDiffFileView | undefined {
  const beforeText = readNonEmptyString(record['before']) ?? '';
  const afterText = readNonEmptyString(record['after']) ?? '';
  if (beforeText.length === 0 && afterText.length === 0) {
    return undefined;
  }

  const filePath =
    readNonEmptyString(record['file']) ??
    readNonEmptyString(record['relativePath']) ??
    readNonEmptyString(record['filePath']) ??
    readNonEmptyString(record['path']) ??
    readNonEmptyString(record['filename']);
  if (!filePath) {
    return undefined;
  }

  const statusValue = readNonEmptyString(record['status']);
  const actionValue = readNonEmptyString(record['action']);
  const status =
    statusValue === 'added' || statusValue === 'deleted' || statusValue === 'modified'
      ? statusValue
      : actionValue === 'add'
        ? 'added'
        : actionValue === 'delete'
          ? 'deleted'
          : actionValue === 'update' || actionValue === 'move'
            ? 'modified'
            : undefined;

  const effectiveFilePath = readNonEmptyString(record['movePath']) ?? filePath;
  const additions = typeof record['additions'] === 'number' ? record['additions'] : undefined;
  const deletions = typeof record['deletions'] === 'number' ? record['deletions'] : undefined;
  const summary =
    additions !== undefined && deletions !== undefined
      ? `${trimFileLikePath(effectiveFilePath)} · +${additions} / -${deletions}`
      : buildSnapshotSummary(effectiveFilePath, beforeText, afterText);

  return {
    beforeText,
    afterText,
    filePath: effectiveFilePath,
    status,
    summary,
  };
}

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

function truncateText(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isLargeOutput(output: unknown): boolean {
  const serialized = stringifyValue(output);
  return utf8ByteLength(serialized) > 8 * 1024;
}

function buildOutputReadHints(
  toolCallId: string | undefined,
  output: unknown,
): string[] | undefined {
  if (output === undefined || !isLargeOutput(output)) {
    return undefined;
  }

  if (typeof output === 'string') {
    const lineCount = output.split(/\r?\n/).length;
    const hints = ['read_tool_output {"useLatestReferenced":true,"lineStart":1,"lineCount":200}'];
    if (toolCallId) {
      hints.push(`read_tool_output {"toolCallId":"${toolCallId}","lineStart":1,"lineCount":200}`);
    }
    if (lineCount > 200) {
      if (toolCallId) {
        hints.push(
          `read_tool_output {"toolCallId":"${toolCallId}","lineStart":201,"lineCount":200}`,
        );
      } else {
        hints.push('read_tool_output {"useLatestReferenced":true,"lineStart":201,"lineCount":200}');
      }
    }
    return hints;
  }

  if (Array.isArray(output)) {
    const hints = ['read_tool_output {"useLatestReferenced":true,"itemStart":0,"itemCount":50}'];
    if (toolCallId) {
      hints.push(`read_tool_output {"toolCallId":"${toolCallId}","itemStart":0,"itemCount":50}`);
    }
    if (output.length > 50) {
      if (toolCallId) {
        hints.push(`read_tool_output {"toolCallId":"${toolCallId}","itemStart":50,"itemCount":50}`);
      } else {
        hints.push('read_tool_output {"useLatestReferenced":true,"itemStart":50,"itemCount":50}');
      }
    }
    return hints;
  }

  const record = asRecord(output);
  if (record) {
    const keys = Object.keys(record).slice(0, 3);
    const hints = ['read_tool_output {"useLatestReferenced":true}'];
    if (toolCallId) {
      hints.push(`read_tool_output {"toolCallId":"${toolCallId}"}`);
    }
    keys.forEach((key) => {
      if (toolCallId) {
        hints.push(`read_tool_output {"toolCallId":"${toolCallId}","jsonPath":"${key}"}`);
      } else {
        hints.push(`read_tool_output {"useLatestReferenced":true,"jsonPath":"${key}"}`);
      }
    });
    return hints;
  }

  return toolCallId
    ? [
        'read_tool_output {"useLatestReferenced":true}',
        `read_tool_output {"toolCallId":"${toolCallId}"}`,
      ]
    : ['read_tool_output {"useLatestReferenced":true}'];
}

function isTaskTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === 'task';
}

const TASK_INPUT_KEYS = new Set(['command', 'description', 'prompt', 'subagent_type', 'task_id']);

function detectReadonlyTask(meta: {
  command?: string;
  description?: string;
  prompt?: string;
}): boolean {
  const haystack = [meta.command, meta.description, meta.prompt]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return /(只读|不修改|不要修改|read[ -]?only|do not modify|without modifying)/.test(haystack);
}

function formatTaskExecutionStatus(status: string | undefined): string | undefined {
  if (!status) {
    return undefined;
  }

  if (status === 'pending') return '待执行';
  if (status === 'in_progress' || status === 'running') return '执行中';
  if (status === 'paused') return '等待处理';
  if (status === 'completed' || status === 'done') return '已完成';
  if (status === 'cancelled') return '已取消';
  if (status === 'failed') return '失败';
  return status;
}

function resolveTaskStatusTone(status: string | undefined): PillTone {
  if (status === 'completed' || status === 'done') {
    return 'success';
  }

  if (status === 'failed') {
    return 'danger';
  }

  if (
    status === 'pending' ||
    status === 'in_progress' ||
    status === 'running' ||
    status === 'paused'
  ) {
    return 'warning';
  }

  if (status === 'cancelled') {
    return 'muted';
  }

  return 'muted';
}

function summarizeTaskTool(meta: TaskToolMeta): string {
  const title = truncateText(meta.command ?? meta.description ?? meta.prompt ?? '子代理任务');
  const prefixes = [
    meta.agentType,
    meta.readonly ? '只读' : undefined,
    formatTaskExecutionStatus(meta.outputStatus),
  ].filter((item): item is string => Boolean(item));

  if (prefixes.length === 0) {
    return title;
  }

  return `${prefixes.join(' · ')} · ${title}`;
}

function resolveTaskToolMeta(
  input: Record<string, unknown>,
  output: unknown,
): TaskToolMeta | undefined {
  const outputRecord = asRecord(output);
  const command = readNonEmptyString(input['command']);
  const description = readNonEmptyString(input['description']);
  const prompt = readNonEmptyString(input['prompt']);
  const agentType = readNonEmptyString(input['subagent_type']);
  const requestedTaskId = readNonEmptyString(input['task_id']);
  const hasAdditionalInputFields = Object.keys(input).some((key) => !TASK_INPUT_KEYS.has(key));
  const outputTaskId = readNonEmptyString(outputRecord?.['taskId']);
  const outputSessionId = readNonEmptyString(outputRecord?.['sessionId']);
  const outputStatus = readNonEmptyString(outputRecord?.['status']);
  const readonly = detectReadonlyTask({ command, description, prompt });
  const extraOutput =
    outputRecord === null
      ? output
      : Object.fromEntries(
          Object.entries(outputRecord).filter(
            ([key]) => key !== 'taskId' && key !== 'sessionId' && key !== 'status',
          ),
        );
  const normalizedExtraOutput =
    extraOutput && typeof extraOutput === 'object' && !Array.isArray(extraOutput)
      ? Object.keys(extraOutput).length > 0
        ? extraOutput
        : undefined
      : extraOutput;

  if (
    !command &&
    !description &&
    !prompt &&
    !agentType &&
    !requestedTaskId &&
    !outputTaskId &&
    !outputSessionId &&
    !outputStatus &&
    normalizedExtraOutput === undefined &&
    !readonly
  ) {
    return undefined;
  }

  return {
    agentType,
    command,
    description,
    prompt,
    requestedTaskId,
    outputTaskId,
    outputSessionId,
    outputStatus,
    readonly,
    extraOutput: normalizedExtraOutput,
    hasAdditionalInputFields,
  };
}

function formatTaskMetaDetails(meta: TaskToolMeta): string | undefined {
  const lines: string[] = [];

  if (meta.agentType) {
    lines.push(`子代理类型：${meta.agentType}`);
  }

  if (meta.outputTaskId && meta.requestedTaskId && meta.outputTaskId !== meta.requestedTaskId) {
    lines.push(`请求任务 ID：${meta.requestedTaskId}`);
    lines.push(`生成任务 ID：${meta.outputTaskId}`);
  } else {
    const taskId = meta.outputTaskId ?? meta.requestedTaskId;
    if (taskId) {
      lines.push(`任务 ID：${taskId}`);
    }
  }

  if (meta.outputSessionId) {
    lines.push(`子会话 ID：${meta.outputSessionId}`);
  }

  const outputStatus = formatTaskExecutionStatus(meta.outputStatus);
  if (outputStatus) {
    lines.push(`子任务状态：${outputStatus}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function trimTaskIdentifier(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function resolveTaskTitle(meta: TaskToolMeta): string {
  return truncateText(meta.command ?? meta.description ?? meta.prompt ?? '子代理任务', 96);
}

function resolveTaskSubtitle(meta: TaskToolMeta, title: string): string | undefined {
  if (meta.description && meta.description !== title && meta.description !== meta.command) {
    return truncateText(meta.description, 120);
  }

  if (meta.command && meta.description && meta.command !== meta.description) {
    return truncateText(meta.description, 120);
  }

  return undefined;
}

function resolveTaskPreview(
  meta: TaskToolMeta,
  title: string,
  subtitle?: string,
): string | undefined {
  if (!meta.prompt) {
    return undefined;
  }

  if (meta.prompt === title || meta.prompt === subtitle) {
    return undefined;
  }

  return truncateText(meta.prompt, 160);
}

function resolveTaskFooter(meta: TaskToolMeta): string | undefined {
  const entries = [
    meta.outputTaskId || meta.requestedTaskId
      ? `任务 ${trimTaskIdentifier(meta.outputTaskId ?? meta.requestedTaskId ?? '')}`
      : undefined,
    meta.outputSessionId ? `会话 ${trimTaskIdentifier(meta.outputSessionId)}` : undefined,
  ].filter((item): item is string => Boolean(item));

  return entries.length > 0 ? entries.join(' · ') : undefined;
}

function buildTaskSummaryData(meta: TaskToolMeta): TaskSummaryData {
  const title = resolveTaskTitle(meta);
  const subtitle = resolveTaskSubtitle(meta, title);

  return {
    title,
    subtitle,
    preview: resolveTaskPreview(meta, title, subtitle),
    footer: resolveTaskFooter(meta),
  };
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  const normalizedToolName = toolName.trim().toLowerCase();
  const fileLikePath = input['filePath'] ?? input['file_path'] ?? input['path'];
  const displayPath = typeof fileLikePath === 'string' ? trimInputPath(fileLikePath) : undefined;

  if (normalizedToolName === 'todowrite' && Array.isArray(input['todos'])) {
    return `${input['todos'].length} 项待办`;
  }

  if (normalizedToolName === 'subtodowrite' && Array.isArray(input['todos'])) {
    return `${input['todos'].length} 项临时待办`;
  }

  if (normalizedToolName === 'todoread') {
    return '读取当前待办';
  }

  if (normalizedToolName === 'subtodoread') {
    return '读取当前临时待办';
  }

  if (normalizedToolName.includes('bash') && typeof input['command'] === 'string') {
    return input['command'].slice(0, 120);
  }

  if (normalizedToolName === 'read') {
    const suffix = buildParamSuffix([
      ['offset', input['offset']],
      ['limit', input['limit']],
    ]);
    return displayPath ? `${displayPath}${suffix}` : `读取${suffix}`;
  }

  if (normalizedToolName === 'grep') {
    const suffix = buildParamSuffix([
      ['pattern', input['pattern']],
      ['include', input['include']],
      ['head_limit', input['head_limit']],
    ]);
    return displayPath ? `${displayPath}${suffix}` : `搜索${suffix}`;
  }

  if (normalizedToolName === 'glob') {
    const suffix = buildParamSuffix([['pattern', input['pattern']]]);
    return displayPath ? `${displayPath}${suffix}` : `匹配${suffix}`;
  }

  if (typeof fileLikePath === 'string' && fileLikePath.trim().length > 0) {
    return displayPath ?? trimFileLikePath(fileLikePath);
  }

  if (typeof input['pattern'] === 'string' && input['pattern'].trim().length > 0) {
    return `模式：${input['pattern']}`;
  }

  if (typeof input['query'] === 'string' && input['query'].trim().length > 0) {
    return input['query'];
  }

  if (typeof input['description'] === 'string' && input['description'].trim().length > 0) {
    return input['description'].slice(0, 120);
  }

  if (typeof input['status'] === 'string' && Object.keys(input).length === 1) {
    return input['status'];
  }

  const [firstKey] = Object.keys(input);
  if (!firstKey) {
    return '';
  }

  const firstValue = input[firstKey];
  if (typeof firstValue === 'string') {
    return `${firstKey}：${firstValue.slice(0, 120)}`;
  }

  return `${firstKey}：${stringifyValue(firstValue).slice(0, 120)}`;
}

function summarizeOutputPreview(output: unknown): string | undefined {
  const diffView = resolveDiffView(output);
  if (diffView) {
    return diffView.summary;
  }

  if (output === undefined) {
    return undefined;
  }

  if (typeof output === 'string') {
    const normalized = output.trim();
    return normalized.length > 0 ? truncateText(normalized, 120) : undefined;
  }

  const record = asRecord(output);
  if (record) {
    for (const key of ['summary', 'message', 'result', 'stdout', 'text', 'detail']) {
      const value = readNonEmptyString(record[key]);
      if (value) {
        return truncateText(value, 120);
      }
    }
  }

  const serialized = stringifyValue(output).replace(/\s+/g, ' ').trim();
  return serialized.length > 0 ? truncateText(serialized, 120) : undefined;
}

function resolveDiffView(output: unknown): ToolCallCardDisplayData['diffView'] | undefined {
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (!/(^diff --git|^@@\s+-)/m.test(trimmed)) {
      return undefined;
    }

    const summary = summarizeUnifiedDiff(trimmed);
    return {
      diffText: trimmed,
      summary: `代码变更 · +${summary.added} / -${summary.removed}`,
    };
  }

  const record = asRecord(output);
  if (!record) {
    return undefined;
  }

  const diffText = readNonEmptyString(record['diff']);

  const filePath =
    readNonEmptyString(record['filePath']) ??
    readNonEmptyString(record['path']) ??
    readNonEmptyString(record['filename']);

  const multiFileSource = Array.isArray(record['files'])
    ? record['files']
    : Array.isArray(record['diffs'])
      ? record['diffs']
      : undefined;
  const multiFiles = multiFileSource
    ?.map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => buildDiffFileView(item))
    .filter((item): item is ToolDiffFileView => Boolean(item));

  if (multiFiles && multiFiles.length > 1) {
    const added = multiFiles.reduce((count, item) => {
      const match = item.summary.match(/\+(\d+)/);
      return count + Number.parseInt(match?.[1] ?? '0', 10);
    }, 0);
    const removed = multiFiles.reduce((count, item) => {
      const match = item.summary.match(/-(\d+)/);
      return count + Number.parseInt(match?.[1] ?? '0', 10);
    }, 0);
    return {
      files: multiFiles,
      summary: `${multiFiles.length} 个文件 · +${added} / -${removed}`,
    };
  }

  if (diffText) {
    const summary = summarizeUnifiedDiff(diffText);
    return {
      diffText,
      filePath,
      summary: `${filePath ? `${trimFileLikePath(filePath)} · ` : ''}+${summary.added} / -${summary.removed}`,
    };
  }

  const fileDiffRecord = asRecord(record['filediff']);
  if (fileDiffRecord) {
    const snapshot = buildDiffFileView({
      ...fileDiffRecord,
      file: fileDiffRecord['file'] ?? filePath ?? record['path'],
    });
    if (snapshot) {
      return {
        beforeText: snapshot.beforeText,
        afterText: snapshot.afterText,
        filePath: snapshot.filePath,
        summary: snapshot.summary,
      } as ToolCallCardDisplayData['diffView'];
    }
  }

  const diffs = Array.isArray(record['diffs']) ? record['diffs'] : undefined;
  if (diffs?.length === 1) {
    const first = asRecord(diffs[0]);
    if (first) {
      const snapshot = buildDiffFileView(first);
      if (snapshot) {
        return {
          beforeText: snapshot.beforeText,
          afterText: snapshot.afterText,
          filePath: snapshot.filePath,
          summary: snapshot.summary,
        } as ToolCallCardDisplayData['diffView'];
      }
    }
  }

  const beforeText = readNonEmptyString(record['before']) ?? '';
  const afterText = readNonEmptyString(record['after']) ?? '';
  if (beforeText.length === 0 && afterText.length === 0) {
    return undefined;
  }

  const summary = summarizeSnapshotDiff(beforeText, afterText);
  return {
    beforeText,
    afterText,
    filePath,
    summary: `${filePath ? `${trimFileLikePath(filePath)} · ` : ''}+${summary.added} / -${summary.removed}`,
  } as ToolCallCardDisplayData['diffView'];
}

function resolveStatusMeta(status: ToolCardStatus): StatusMeta {
  if (status === 'paused') {
    return {
      color: '#fcd34d',
      dot: '#f59e0b',
      label: '等待权限',
    };
  }

  if (status === 'failed') {
    return {
      color: '#fca5a5',
      dot: '#ef4444',
      label: '失败',
    };
  }

  if (status === 'completed') {
    return {
      color: '#86efac',
      dot: '#10b981',
      label: '完成',
    };
  }

  return {
    color: '#93c5fd',
    dot: '#3b82f6',
    label: '执行中',
  };
}

function inferToolKind(toolName: string): ToolKind {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === 'task') {
    return 'agent';
  }
  if (normalized.includes('mcp') || normalized.includes('context7')) {
    return 'mcp';
  }
  if (normalized.includes('skill') || normalized.includes('技能')) {
    return 'skill';
  }
  if (
    normalized.includes('agent') ||
    normalized.includes('代理') ||
    normalized.includes('oracle') ||
    normalized.includes('subagent')
  ) {
    return 'agent';
  }
  return 'tool';
}

function iconForToolKind(kind: ToolKind): string {
  if (kind === 'mcp') return 'MCP';
  if (kind === 'skill') return 'SKILL';
  if (kind === 'agent') return 'AGENT';
  return 'TOOL';
}

export function resolveToolCallCardDisplayData(input: {
  includeOutputDetails?: boolean;
  input: Record<string, unknown>;
  output?: unknown;
  toolCallId?: string;
  toolName: string;
}): ToolCallCardDisplayData {
  const taskMeta = isTaskTool(input.toolName)
    ? resolveTaskToolMeta(input.input, input.output)
    : undefined;
  const diffView = taskMeta ? undefined : resolveDiffView(input.output);
  const displayToolName = taskMeta ? '子代理任务' : input.toolName;
  const summary = taskMeta
    ? summarizeTaskTool(taskMeta)
    : (diffView?.summary ?? summarizeInput(input.toolName, input.input));
  const includeOutputDetails = input.includeOutputDetails !== false;
  const outputPreview =
    taskMeta || !includeOutputDetails ? undefined : summarizeOutputPreview(input.output);
  const outputReadHints = taskMeta
    ? undefined
    : includeOutputDetails
      ? buildOutputReadHints(input.toolCallId, input.output)
      : undefined;
  const showInputField = !(
    (taskMeta && !taskMeta.hasAdditionalInputFields) ||
    (input.toolName === '—' && Object.keys(input.input).length === 1 && summary.length > 0)
  );
  const hasDetails = showInputField || input.output !== undefined || taskMeta !== undefined;

  return {
    displayToolName,
    diffView,
    summary,
    outputPreview,
    outputReadHints,
    showInputField,
    hasDetails,
    taskMeta,
    taskSummary: taskMeta ? buildTaskSummaryData(taskMeta) : undefined,
    toolKind: inferToolKind(input.toolName),
  };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        opacity: 0.55,
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 160ms ease',
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TaskMetaBadge({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | PillTone;
}) {
  const color = tone === 'default' ? 'muted' : tone;

  return <StatusPill label={label} color={color} />;
}

function TaskMetaHighlights({ meta }: { meta: TaskToolMeta }) {
  const executionStatus = formatTaskExecutionStatus(meta.outputStatus);
  const executionTone = resolveTaskStatusTone(meta.outputStatus);

  if (!meta.agentType && !meta.readonly && !executionStatus) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '8px 10px',
        borderRadius: tokens.radius.md,
        background: 'color-mix(in srgb, transparent 82%, var(--color-surface, #111827))',
        border: '1px solid color-mix(in srgb, transparent 84%, var(--color-border, #1e2d3d))',
      }}
    >
      <TaskMetaBadge label="子代理" />
      {meta.agentType && <TaskMetaBadge label={meta.agentType} />}
      {meta.readonly && <TaskMetaBadge label="只读" tone="success" />}
      {executionStatus && (
        <TaskMetaBadge label={`子任务 · ${executionStatus}`} tone={executionTone} />
      )}
    </div>
  );
}

function CopyActionButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-tool-card-copy="true"
      aria-label={copied ? '已复制工具内容' : '复制工具内容'}
      title={copied ? '已复制工具内容' : '复制工具内容'}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        appearance: 'none',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        background: copied ? 'rgba(16, 185, 129, 0.14)' : 'rgba(15, 23, 42, 0.18)',
        color: copied ? '#86efac' : 'var(--color-muted, #94a3b8)',
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.4,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function buildToolCopyText({
  displayData,
  displayToolName,
  input,
  isError,
  output,
  statusLabel,
  summary,
  toolKindLabel,
}: {
  displayData: ToolCallCardDisplayData;
  displayToolName: string;
  input: Record<string, unknown>;
  isError?: boolean;
  output?: unknown;
  statusLabel: string;
  summary: string;
  toolKindLabel: string;
}): string {
  const sections = [
    `工具：${displayToolName}`,
    `类型：${toolKindLabel}`,
    `状态：${statusLabel}`,
    `摘要：${summary || '查看详情'}`,
  ];

  if (displayData.diffView?.summary) {
    sections.push(`变更：${displayData.diffView.summary}`);
  }

  sections.push('', '输入', stringifyValue(input));

  if (output !== undefined) {
    sections.push('', isError ? '错误输出' : '输出', stringifyValue(output));
  }

  return sections.join('\n');
}

function TaskSummaryCard({
  copied,
  meta,
  onCopy,
  open,
  statusMeta,
  summary,
  summaryData,
  toggle,
  toolKindLabel,
}: {
  copied: boolean;
  meta: TaskToolMeta;
  onCopy: () => void;
  open: boolean;
  statusMeta: StatusMeta;
  summary: string;
  summaryData: TaskSummaryData;
  toggle: () => void;
  toolKindLabel: string;
}) {
  const childStatus = formatTaskExecutionStatus(meta.outputStatus);
  const childStatusTone = resolveTaskStatusTone(meta.outputStatus);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 10,
        width: '100%',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          appearance: 'none',
          border: '1px solid color-mix(in srgb, transparent 78%, var(--color-border, #1e2d3d))',
          background:
            'linear-gradient(180deg, rgba(15, 23, 42, 0.34) 0%, rgba(15, 23, 42, 0.16) 100%)',
          padding: '10px 12px',
          margin: 0,
          display: 'flex',
          alignItems: 'stretch',
          gap: 10,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          color: 'inherit',
          cursor: 'pointer',
          borderRadius: tokens.radius.lg,
          boxShadow: open ? tokens.shadow.sm : 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 10,
            minWidth: 10,
            marginTop: 5,
            height: 10,
            borderRadius: '50%',
            flexShrink: 0,
            background: statusMeta.dot,
            boxShadow:
              statusMeta.label === '执行中'
                ? `0 0 0 5px color-mix(in oklab, ${statusMeta.dot} 18%, transparent)`
                : 'none',
          }}
        />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <TaskMetaBadge label={toolKindLabel} />
                {meta.agentType && <TaskMetaBadge label={meta.agentType} />}
                {meta.readonly && <TaskMetaBadge label="只读" tone="success" />}
                {childStatus && (
                  <TaskMetaBadge label={`子任务 · ${childStatus}`} tone={childStatusTone} />
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--color-text, #f8fafc)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {summaryData.title}
              </div>
              {summaryData.subtitle && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text, #cbd5e1)',
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                  }}
                >
                  {summaryData.subtitle}
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted, #94a3b8)',
                }}
              >
                工具状态
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: statusMeta.color,
                }}
              >
                {statusMeta.label}
                <Chevron open={open} />
              </span>
            </div>
          </div>
          {summaryData.preview && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-muted, #94a3b8)',
                lineHeight: 1.55,
                wordBreak: 'break-word',
              }}
            >
              {summaryData.preview}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-muted, #94a3b8)',
                letterSpacing: '0.03em',
              }}
            >
              {summaryData.footer ?? '展开查看子代理任务详情'}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-muted, #64748b)',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={summary}
            >
              {summary}
            </span>
          </div>
        </div>
      </button>
      <CopyActionButton copied={copied} onClick={onCopy} />
    </div>
  );
}

function ToolField({
  label,
  tone = 'default',
  value,
}: {
  label: string;
  tone?: 'default' | 'danger' | 'muted';
  value: string;
}) {
  const color = tone === 'danger' ? '#fecaca' : 'var(--color-text, #e2e8f0)';
  const background =
    tone === 'danger'
      ? 'rgba(127, 29, 29, 0.18)'
      : tone === 'muted'
        ? 'rgba(15, 23, 42, 0.18)'
        : 'rgba(15, 23, 42, 0.26)';

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-muted, #94a3b8)',
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          borderRadius: 10,
          background,
          color,
          fontSize: 11,
          lineHeight: 1.55,
          fontFamily:
            'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
          maxHeight: 260,
        }}
      >
        {value}
      </pre>
    </section>
  );
}

export function ToolCallCard({
  kind,
  toolCallId,
  toolName,
  input,
  output,
  isError,
  status,
  style,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const normalizedStatus = useMemo<ToolCardStatus>(() => {
    if (status) {
      return status;
    }
    if (isError === true) {
      return 'failed';
    }
    if (output !== undefined) {
      return 'completed';
    }
    return 'running';
  }, [isError, output, status]);

  const statusMeta = useMemo(() => resolveStatusMeta(normalizedStatus), [normalizedStatus]);
  const displayData = useMemo(
    () =>
      resolveToolCallCardDisplayData({
        toolCallId,
        toolName,
        input,
        output,
        includeOutputDetails: open,
      }),
    [input, open, output, toolCallId, toolName],
  );
  const taskMetaDetails = useMemo(
    () => (displayData.taskMeta ? formatTaskMetaDetails(displayData.taskMeta) : undefined),
    [displayData.taskMeta],
  );
  const summary = displayData.summary;
  const toolKind = useMemo(() => kind ?? displayData.toolKind, [displayData.toolKind, kind]);
  const toolKindLabel = useMemo(() => iconForToolKind(toolKind), [toolKind]);
  const displayToolName = displayData.displayToolName;
  const outputReadHints = displayData.outputReadHints;
  const showInputField = displayData.showInputField;
  const hasDetails = displayData.hasDetails;
  const hasInlineDiff = displayData.taskMeta === undefined && Boolean(displayData.diffView);
  const taskSummary = displayData.taskSummary;
  const effectiveOpen = open;
  const compactSummary = useMemo(() => summary || '查看详情', [summary]);
  const copyText = useMemo(
    () =>
      buildToolCopyText({
        displayData,
        displayToolName,
        input,
        isError,
        output,
        statusLabel: statusMeta.label,
        summary,
        toolKindLabel,
      }),
    [
      displayData,
      displayToolName,
      input,
      isError,
      output,
      statusMeta.label,
      summary,
      toolKindLabel,
    ],
  );

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    if (!navigator.clipboard) {
      return;
    }

    const copyRequest = navigator.clipboard.writeText(copyText);
    void copyRequest.then(() => {
      setCopied(true);
    });
  };

  return (
    <div
      data-tool-card-root="true"
      style={{ display: 'flex', flexDirection: 'column', gap: hasDetails ? 0 : 8, ...style }}
    >
      {hasDetails && displayData.taskMeta && taskSummary ? (
        <TaskSummaryCard
          copied={copied}
          meta={displayData.taskMeta}
          onCopy={handleCopy}
          open={effectiveOpen}
          statusMeta={statusMeta}
          summary={summary}
          summaryData={taskSummary}
          toggle={() => setOpen((previous) => !previous)}
          toolKindLabel={toolKindLabel}
        />
      ) : hasDetails ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            minWidth: 0,
          }}
        >
          <button
            type="button"
            data-tool-card-toggle="true"
            onClick={() => setOpen((previous) => !previous)}
            aria-expanded={effectiveOpen}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              padding: '2px 0',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'relative',
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: statusMeta.dot,
                boxShadow:
                  normalizedStatus === 'running'
                    ? `0 0 0 4px color-mix(in oklab, ${statusMeta.dot} 22%, transparent)`
                    : 'none',
              }}
            />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 6,
                background: 'rgba(148, 163, 184, 0.12)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                color: 'var(--color-text, #f8fafc)',
                flexShrink: 0,
              }}
            >
              <ToolKindIcon kind={toolKind} />
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-text, #f8fafc)',
                flexShrink: 0,
              }}
            >
              {displayToolName}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'var(--color-muted, #94a3b8)',
              }}
            >
              {toolKindLabel}
            </span>
            <span
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: 11,
                color: 'var(--color-muted, #94a3b8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={compactSummary}
            >
              {compactSummary}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 700,
                color: statusMeta.color,
              }}
            >
              {statusMeta.label}
            </span>
            <Chevron open={effectiveOpen} />
          </button>
          <CopyActionButton copied={copied} onClick={handleCopy} />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: statusMeta.dot,
              }}
            />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 6,
                background: 'rgba(148, 163, 184, 0.12)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                color: 'var(--color-text, #f8fafc)',
                flexShrink: 0,
              }}
            >
              <ToolKindIcon kind={toolKind} />
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-text, #f8fafc)',
                flexShrink: 0,
              }}
            >
              {displayToolName}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'var(--color-muted, #94a3b8)',
              }}
            >
              {toolKindLabel}
            </span>
            <span
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: 11,
                color: 'var(--color-muted, #94a3b8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={compactSummary}
            >
              {compactSummary}
            </span>
          </div>
          <CopyActionButton copied={copied} onClick={handleCopy} />
        </div>
      )}

      {hasInlineDiff &&
        (displayData.diffView?.files && displayData.diffView.files.length > 1 ? (
          <div style={{ padding: '6px 0 0 34px' }}>
            <ToolDiffCollection files={displayData.diffView.files} maxHeight={320} />
          </div>
        ) : (
          <div style={{ padding: '6px 0 0 34px' }}>
            <UnifiedCodeDiff
              beforeText={displayData.diffView?.beforeText}
              afterText={displayData.diffView?.afterText}
              diffText={displayData.diffView?.diffText}
              filePath={displayData.diffView?.filePath}
              maxHeight={320}
            />
          </div>
        ))}

      {hasDetails && effectiveOpen && (
        <div
          style={{
            padding: '6px 0 0 34px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {displayData.taskMeta && <TaskMetaHighlights meta={displayData.taskMeta} />}
          {displayData.taskMeta?.command && (
            <ToolField label="命令" tone="muted" value={displayData.taskMeta.command} />
          )}
          {displayData.taskMeta?.description &&
            displayData.taskMeta.description !== displayData.taskMeta.command && (
              <ToolField label="说明" tone="muted" value={displayData.taskMeta.description} />
            )}
          {displayData.taskMeta?.prompt && (
            <ToolField label="提示词" tone="muted" value={displayData.taskMeta.prompt} />
          )}
          {taskMetaDetails && <ToolField label="任务信息" value={taskMetaDetails} />}
          {displayData.taskMeta !== undefined && showInputField && (
            <ToolField label="输入" tone="muted" value={stringifyValue(input)} />
          )}
          {displayData.taskMeta?.extraOutput !== undefined && (
            <ToolField
              label={isError ? '错误输出' : '输出'}
              tone={isError ? 'danger' : 'default'}
              value={stringifyValue(displayData.taskMeta.extraOutput)}
            />
          )}
          {displayData.taskMeta === undefined && displayData.diffView && showInputField && (
            <ToolField label="输入" tone="muted" value={stringifyValue(input)} />
          )}
          {displayData.taskMeta === undefined && displayData.diffView && output !== undefined && (
            <ToolField
              label={isError ? '错误输出' : '输出'}
              tone={isError ? 'danger' : 'default'}
              value={stringifyValue(output)}
            />
          )}
          {displayData.taskMeta === undefined &&
            displayData.diffView === undefined &&
            output !== undefined && (
              <ToolField
                label={isError ? '错误输出' : '输出'}
                tone={isError ? 'danger' : 'default'}
                value={stringifyValue(output)}
              />
            )}
          {displayData.taskMeta === undefined &&
            displayData.diffView === undefined &&
            outputReadHints &&
            outputReadHints.length > 0 && (
              <ToolField label="继续读取建议" tone="muted" value={outputReadHints.join('\n')} />
            )}
        </div>
      )}
    </div>
  );
}
