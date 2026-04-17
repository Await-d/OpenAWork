import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { tokens } from './tokens.js';
import type { ToolDiffFileView } from './ToolDiffCollection.js';
import { ToolDiffCollection } from './ToolDiffCollection.js';
import { UnifiedCodeDiff, summarizeSnapshotDiff, summarizeUnifiedDiff } from './UnifiedCodeDiff.js';
import {
  Chevron,
  CopyActionButton,
  TaskMetaHighlights,
  TaskSummaryCard,
  ToolField,
} from './tool-call-card-parts.js';
import {
  BashTerminalCard,
  resolveBashTerminalView,
  type BashTerminalView,
} from './tool-call-card-bash-terminal.js';
import {
  buildToolCopyText,
  iconForToolKind,
  inferToolKind,
  resolveStatusMeta,
  ToolKindIcon,
} from './tool-call-card-meta.js';
import type {
  PillTone,
  TaskSummaryData,
  TaskToolMeta,
  ToolCardStatus,
  ToolKind,
} from './tool-call-card-shared.js';

export interface ToolCallCardProps {
  approvalActions?: {
    errorMessage?: string;
    helperMessage?: string;
    items: Array<{
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      id: string;
      label: string;
      onClick: () => void;
      primary?: boolean;
    }>;
    pendingLabel?: string;
  };
  kind?: ToolKind;
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  resumedAfterApproval?: boolean;
  status?: ToolCardStatus;
  style?: CSSProperties;
}

export type { ToolKind } from './tool-call-card-shared.js';

export interface ToolCallCardDisplayData {
  bashView?: BashTerminalView;
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

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

const TOOL_DISPLAY_NAME_MAP: Record<string, string> = {
  skill: '技能',
  askuserquestion: '询问用户',
  question: '询问用户',
  agent: '代理委派',
  call_omo_agent: '代理委派',
  enterplanmode: '进入规划模式',
  exitplanmode: '退出规划模式',
};

function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function resolveDisplayToolName(toolName: string, taskMeta?: TaskToolMeta): string {
  if (taskMeta) {
    return '子代理任务';
  }

  return TOOL_DISPLAY_NAME_MAP[normalizeToolName(toolName)] ?? toolName;
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

function summarizeSkillTool(input: Record<string, unknown>): string | undefined {
  const skillName = readNonEmptyString(input['skill']) ?? readNonEmptyString(input['name']);
  const args = readNonEmptyString(input['args']) ?? readNonEmptyString(input['user_message']);

  if (!skillName && !args) {
    return undefined;
  }

  const detail = args ? truncateText(normalizeSummaryText(args), 88) : undefined;
  return skillName
    ? ['加载', skillName, detail].filter((item): item is string => Boolean(item)).join(' · ')
    : detail;
}

function summarizeQuestionTool(input: Record<string, unknown>): string | undefined {
  const questions = Array.isArray(input['questions']) ? input['questions'] : undefined;
  if (!questions || questions.length === 0) {
    return undefined;
  }

  const first = asRecord(questions[0]);
  const header = readNonEmptyString(first?.['header']);
  const question = readNonEmptyString(first?.['question']);
  const options = Array.isArray(first?.['options']) ? first['options'].length : undefined;
  const multiple = first?.['multiple'] === true || first?.['multiSelect'] === true;

  const parts = [
    header,
    question ? truncateText(normalizeSummaryText(question), 88) : undefined,
    options ? `${options} 个选项` : undefined,
    questions.length > 1 ? `${questions.length} 题` : multiple ? '多选' : '单选',
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function summarizeAgentTool(input: Record<string, unknown>): string | undefined {
  const description = readNonEmptyString(input['description']);
  const prompt = readNonEmptyString(input['prompt']);
  const agentType = readNonEmptyString(input['subagent_type']);
  const mode = input['run_in_background'] === true ? '后台' : undefined;
  const focus = description ?? prompt;

  const parts = [
    mode,
    agentType,
    focus ? truncateText(normalizeSummaryText(focus), 96) : undefined,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function summarizePlanModeTool(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === 'enterplanmode') {
    return '进入只读规划阶段';
  }

  if (normalizedToolName !== 'exitplanmode') {
    return undefined;
  }

  const plan = readNonEmptyString(input['plan']);
  const allowedPrompts = Array.isArray(input['allowedPrompts'])
    ? input['allowedPrompts'].length
    : 0;

  return [
    '提交计划审批',
    plan ? truncateText(normalizeSummaryText(plan), 96) : undefined,
    allowedPrompts > 0 ? `${allowedPrompts} 条允许提示` : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join(' · ');
}

function summarizeSpecialToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const normalizedToolName = normalizeToolName(toolName);

  if (normalizedToolName === 'skill') {
    return summarizeSkillTool(input);
  }

  if (normalizedToolName === 'askuserquestion' || normalizedToolName === 'question') {
    return summarizeQuestionTool(input);
  }

  if (normalizedToolName === 'agent' || normalizedToolName === 'call_omo_agent') {
    return summarizeAgentTool(input);
  }

  if (normalizedToolName === 'enterplanmode' || normalizedToolName === 'exitplanmode') {
    return summarizePlanModeTool(toolName, input);
  }

  return undefined;
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
  const outputMessage = readNonEmptyString(outputRecord?.['message']);
  const outputResult = readNonEmptyString(outputRecord?.['result']);
  const outputErrorMessage = readNonEmptyString(outputRecord?.['errorMessage']);
  const readonly = detectReadonlyTask({ command, description, prompt });
  const extraOutput =
    outputRecord === null
      ? output
      : Object.fromEntries(
          Object.entries(outputRecord).filter(
            ([key]) =>
              key !== 'taskId' &&
              key !== 'sessionId' &&
              key !== 'status' &&
              key !== 'message' &&
              key !== 'result' &&
              key !== 'errorMessage',
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
    outputErrorMessage,
    outputMessage,
    outputResult,
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
  const semanticPreview = resolveTaskSemanticPreview(meta);
  if (semanticPreview) {
    return semanticPreview;
  }

  if (!meta.prompt) {
    return undefined;
  }

  if (meta.prompt === title || meta.prompt === subtitle) {
    return undefined;
  }

  return truncateText(meta.prompt, 160);
}

function resolveTaskSemanticPreview(meta: TaskToolMeta): string | undefined {
  const preferred = meta.outputErrorMessage ?? meta.outputMessage ?? meta.outputResult;
  if (!preferred) {
    return undefined;
  }

  const taskResultMatch = preferred.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/u);
  const normalized = (taskResultMatch?.[1] ?? preferred).trim();
  return normalized.length > 0 ? truncateText(normalized, 160) : undefined;
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
  const normalizedToolName = normalizeToolName(toolName);
  const specialSummary = summarizeSpecialToolInput(toolName, input);
  if (specialSummary) {
    return specialSummary;
  }
  const fileLikePath = input['filePath'] ?? input['file_path'] ?? input['path'];
  const displayPath = typeof fileLikePath === 'string' ? trimInputPath(fileLikePath) : undefined;

  if (normalizedToolName === 'todowrite' && Array.isArray(input['todos'])) {
    return `${input['todos'].length} 项主待办`;
  }

  if (normalizedToolName === 'subtodowrite' && Array.isArray(input['todos'])) {
    return `${input['todos'].length} 项临时待办`;
  }

  if (normalizedToolName === 'todoread') {
    return '读取当前主待办';
  }

  if (normalizedToolName === 'subtodoread') {
    return '读取当前临时待办';
  }

  if (normalizedToolName.includes('bash') && typeof input['command'] === 'string') {
    const cmd = input['command'].slice(0, 120);
    const cwd =
      typeof input['cwd'] === 'string' || typeof input['workdir'] === 'string'
        ? trimInputPath(
            (typeof input['cwd'] === 'string' ? input['cwd'] : input['workdir']) as string,
          )
        : undefined;
    return cwd ? `${cwd} $ ${cmd}` : cmd;
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
    const todoMetadata = asRecord(record['metadata']);
    if (Array.isArray(todoMetadata?.['todos'])) {
      const title = readNonEmptyString(record['title']);
      if (title) {
        return truncateText(title, 120);
      }
    }

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
  const bashView = taskMeta
    ? undefined
    : resolveBashTerminalView(input.toolName, input.input, input.output);
  const displayToolName = resolveDisplayToolName(input.toolName, taskMeta);
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
    bashView,
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

export function ToolCallCard({
  approvalActions,
  kind,
  toolCallId,
  toolName,
  input,
  output,
  isError,
  resumedAfterApproval,
  status,
  style,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
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

  const statusMeta = useMemo(
    () => resolveStatusMeta(normalizedStatus, toolName),
    [normalizedStatus, toolName],
  );
  const effectiveStatusLabel =
    resumedAfterApproval && normalizedStatus === 'failed' ? '恢复后失败' : statusMeta.label;
  const resumeContextMessage =
    resumedAfterApproval && normalizedStatus === 'failed'
      ? '已根据你的审批恢复执行；当前失败来自恢复后的工具运行结果，不是审批未生效。'
      : resumedAfterApproval
        ? '该工具调用已根据审批恢复执行。'
        : undefined;
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
  const bashView = displayData.bashView;
  const taskSummary = displayData.taskSummary;
  const effectiveOpen = open;
  const compactSummary = useMemo(() => summary || '查看详情', [summary]);
  const copyText = useMemo(
    () =>
      buildToolCopyText({
        diffSummary: displayData.diffView?.summary,
        displayToolName,
        input,
        isError,
        output,
        resumedAfterApproval,
        statusLabel: effectiveStatusLabel,
        stringifyValue,
        summary,
        toolKindLabel,
      }),
    [
      displayData,
      displayToolName,
      input,
      isError,
      output,
      resumedAfterApproval,
      effectiveStatusLabel,
      summary,
      toolKindLabel,
    ],
  );

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timer = window.setTimeout(
      () => setCopyState('idle'),
      copyState === 'failed' ? 1800 : 1200,
    );
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = () => {
    if (!navigator.clipboard) {
      setCopyState('failed');
      return;
    }

    const copyRequest = navigator.clipboard.writeText(copyText);
    void copyRequest
      .then(() => {
        setCopyState('copied');
      })
      .catch(() => {
        setCopyState('failed');
      });
  };

  return (
    <div
      data-tool-card-root="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: hasDetails ? 4 : 2,
        padding: 0,
        ...style,
      }}
    >
      {hasDetails && displayData.taskMeta && taskSummary ? (
        <TaskSummaryCard
          copyState={copyState}
          onCopy={handleCopy}
          open={effectiveOpen}
          statusMeta={statusMeta}
          summary={summary}
          summaryData={taskSummary}
          toggle={() => setOpen((previous) => !previous)}
          toolKindLabel={toolKindLabel}
          agentType={displayData.taskMeta.agentType}
          readonly={displayData.taskMeta.readonly}
          childStatus={formatTaskExecutionStatus(displayData.taskMeta.outputStatus)}
          childStatusTone={resolveTaskStatusTone(displayData.taskMeta.outputStatus)}
        />
      ) : hasDetails ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
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
              borderRadius: 0,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              width: '100%',
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
                width: 7,
                height: 7,
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
                width: 16,
                height: 16,
                borderRadius: 5,
                background: 'transparent',
                border: 'none',
                color: tokens.color.text,
                flexShrink: 0,
              }}
            >
              <ToolKindIcon kind={toolKind} />
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: tokens.color.text,
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
                color: tokens.color.muted,
              }}
            >
              {toolKindLabel}
            </span>
            {resumedAfterApproval && (
              <span
                style={{
                  flexShrink: 0,
                  padding: '2px 6px',
                  borderRadius: 999,
                  border: `1px solid ${
                    normalizedStatus === 'failed' ? tokens.color.danger : tokens.color.borderSubtle
                  }`,
                  background:
                    normalizedStatus === 'failed'
                      ? `color-mix(in srgb, ${tokens.color.danger} 12%, transparent)`
                      : `color-mix(in srgb, ${tokens.color.surface2} 82%, transparent)`,
                  color: normalizedStatus === 'failed' ? tokens.color.danger : tokens.color.muted,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                审批后恢复
              </span>
            )}
            <span
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: 11,
                color: tokens.color.muted,
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
              {effectiveStatusLabel}
            </span>
            <Chevron open={effectiveOpen} />
          </button>
          {!bashView && <CopyActionButton state={copyState} onClick={handleCopy} />}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            width: '100%',
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
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
                width: 16,
                height: 16,
                borderRadius: 5,
                background: 'transparent',
                border: 'none',
                color: tokens.color.text,
                flexShrink: 0,
              }}
            >
              <ToolKindIcon kind={toolKind} />
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: tokens.color.text,
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
                color: tokens.color.muted,
              }}
            >
              {toolKindLabel}
            </span>
            {resumedAfterApproval && (
              <span
                style={{
                  flexShrink: 0,
                  padding: '2px 6px',
                  borderRadius: 999,
                  border: `1px solid ${
                    normalizedStatus === 'failed' ? tokens.color.danger : tokens.color.borderSubtle
                  }`,
                  background:
                    normalizedStatus === 'failed'
                      ? `color-mix(in srgb, ${tokens.color.danger} 12%, transparent)`
                      : `color-mix(in srgb, ${tokens.color.surface2} 82%, transparent)`,
                  color: normalizedStatus === 'failed' ? tokens.color.danger : tokens.color.muted,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                审批后恢复
              </span>
            )}
            <span
              style={{
                minWidth: 0,
                flex: 1,
                fontSize: 11,
                color: tokens.color.muted,
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
              {effectiveStatusLabel}
            </span>
          </div>
          {!bashView && <CopyActionButton state={copyState} onClick={handleCopy} />}
        </div>
      )}

      {approvalActions && approvalActions.items.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: hasDetails ? '2px 0 0 22px' : '0 0 0 22px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            {approvalActions.items.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.hint}
                style={{
                  appearance: 'none',
                  borderRadius: 999,
                  border: `1px solid ${
                    action.primary
                      ? `color-mix(in srgb, ${tokens.color.accent} 58%, ${tokens.color.borderSubtle})`
                      : action.danger
                        ? `color-mix(in srgb, ${tokens.color.danger} 46%, ${tokens.color.borderSubtle})`
                        : `color-mix(in srgb, ${tokens.color.accent} 42%, ${tokens.color.borderSubtle})`
                  }`,
                  background: action.disabled
                    ? `color-mix(in srgb, ${tokens.color.surface2} 78%, transparent)`
                    : action.primary
                      ? `linear-gradient(180deg, color-mix(in srgb, ${tokens.color.accent} 30%, transparent), color-mix(in srgb, ${tokens.color.accent} 18%, transparent))`
                      : action.danger
                        ? `color-mix(in srgb, ${tokens.color.danger} 12%, transparent)`
                        : `color-mix(in srgb, ${tokens.color.accent} 14%, transparent)`,
                  color: action.primary
                    ? tokens.color.text
                    : action.danger
                      ? tokens.color.danger
                      : tokens.color.text,
                  boxShadow: action.primary
                    ? `0 6px 18px color-mix(in srgb, ${tokens.color.accent} 22%, transparent)`
                    : 'none',
                  padding: action.primary ? '5px 12px' : '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: action.primary ? '0.02em' : '0.03em',
                  cursor: action.disabled ? 'not-allowed' : 'pointer',
                  opacity: action.disabled ? 0.62 : 1,
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
          {(approvalActions.pendingLabel ||
            approvalActions.helperMessage ||
            approvalActions.errorMessage) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {approvalActions.pendingLabel && (
                <span
                  style={{
                    fontSize: 10,
                    color: tokens.color.muted,
                    fontWeight: 600,
                  }}
                >
                  {approvalActions.pendingLabel}
                </span>
              )}
              {approvalActions.helperMessage && (
                <span
                  style={{
                    fontSize: 10,
                    color: tokens.color.muted,
                    opacity: 0.92,
                    lineHeight: 1.45,
                  }}
                >
                  {approvalActions.helperMessage}
                </span>
              )}
              {approvalActions.errorMessage && (
                <span
                  style={{
                    fontSize: 10,
                    color: tokens.color.danger,
                    fontWeight: 600,
                  }}
                >
                  {approvalActions.errorMessage}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {hasInlineDiff &&
        (displayData.diffView?.files && displayData.diffView.files.length > 1 ? (
          <div
            style={{
              padding: '8px 0 0 22px',
              borderTop: `1px dashed color-mix(in oklch, ${tokens.color.borderSubtle} 72%, transparent)`,
              marginTop: 4,
            }}
          >
            <ToolDiffCollection
              chrome="minimal"
              files={displayData.diffView.files}
              maxHeight={320}
            />
          </div>
        ) : (
          <div
            style={{
              padding: '8px 0 0 22px',
              borderTop: `1px dashed color-mix(in oklch, ${tokens.color.borderSubtle} 72%, transparent)`,
              marginTop: 4,
            }}
          >
            <UnifiedCodeDiff
              beforeText={displayData.diffView?.beforeText}
              afterText={displayData.diffView?.afterText}
              chrome="minimal"
              diffText={displayData.diffView?.diffText}
              filePath={displayData.diffView?.filePath}
              maxHeight={320}
            />
          </div>
        ))}

      {!hasInlineDiff && !displayData.taskMeta && bashView && (
        <div
          style={{
            padding: hasDetails ? '8px 0 0 22px' : '2px 0 0 22px',
            marginTop: hasDetails ? 4 : 0,
          }}
        >
          <BashTerminalCard compact={!effectiveOpen} view={bashView} />
        </div>
      )}

      {hasDetails && effectiveOpen && (
        <div
          style={{
            padding: '8px 0 2px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            borderTop: `1px solid color-mix(in oklch, ${tokens.color.borderSubtle} 72%, transparent)`,
            marginTop: 4,
          }}
        >
          {displayData.taskMeta && (
            <TaskMetaHighlights
              agentType={displayData.taskMeta.agentType}
              readonly={displayData.taskMeta.readonly}
              executionStatus={formatTaskExecutionStatus(displayData.taskMeta.outputStatus)}
              executionTone={resolveTaskStatusTone(displayData.taskMeta.outputStatus)}
            />
          )}
          {resumeContextMessage && (
            <ToolField
              label="恢复说明"
              tone={normalizedStatus === 'failed' ? 'danger' : 'muted'}
              value={resumeContextMessage}
            />
          )}
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
          {displayData.taskMeta?.outputMessage && (
            <ToolField
              label={isError ? '语义错误' : '语义输出'}
              tone={isError ? 'danger' : 'default'}
              value={displayData.taskMeta.outputMessage}
            />
          )}
          {displayData.taskMeta?.outputErrorMessage && !displayData.taskMeta.outputMessage && (
            <ToolField
              label="错误摘要"
              tone="danger"
              value={displayData.taskMeta.outputErrorMessage}
            />
          )}
          {displayData.taskMeta?.outputResult && !displayData.taskMeta.outputMessage && (
            <ToolField label="结果摘要" value={displayData.taskMeta.outputResult} />
          )}
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
            !bashView &&
            showInputField && <ToolField label="输入" tone="muted" value={stringifyValue(input)} />}
          {displayData.taskMeta === undefined &&
            displayData.diffView === undefined &&
            !bashView &&
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
