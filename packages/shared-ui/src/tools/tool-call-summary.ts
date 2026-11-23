import type { ToolDiffFileView } from './ToolDiffCollection.js';
import { summarizeSnapshotDiff } from './UnifiedCodeDiff.js';
import type { TaskToolMeta } from './tool-call-card-shared.js';
import { isSubagentToolName } from './subagent-tool-names.js';
import { readFileSnapshot } from './file-change-result.js';

/**
 * 工具卡片摘要层：把工具入参压成「标题后缀 + 摘要行」，以及输出体积判定。
 *
 * 全为纯函数（无 React 依赖），从 `ToolCallCard.tsx` 抽出。
 */

export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 「仅 `{ ok: true }`」的确认型输出（`desktop_control` / `lsp_touch` /
 * `session_move` 等的成功返回，可能是对象也可能是 JSON 字符串）。
 *
 * 这类输出落到右栏的字段表只有一个 `ok: true`，没有可读信息；返回 true 让调用
 * 方换成一行「✓ 成功」。带其它字段或 `ok: false`（错误）时一律返回 false，
 * 避免把失败原因藏掉。
 */
export function isBareOkOutput(value: unknown): boolean {
  let record: Record<string, unknown> | null = null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return false;
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    record = value as Record<string, unknown>;
  }

  if (!record) return false;
  const keys = Object.keys(record);
  return keys.length === 1 && record['ok'] === true;
}

export function trimFileLikePath(value: string): string {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join('/');
}

export function trimInputPath(value: string): string {
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

export function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

const TOOL_DISPLAY_NAME_MAP: Record<string, string> = {
  skill: '技能',
  askuserquestion: '询问用户',
  question: '询问用户',
  subagent: '代理委派',
  task: '代理委派',
  agent: '代理委派',
  call_omo_agent: '代理委派',
  delegate_task: '代理委派',
  enterplanmode: '进入规划模式',
  exitplanmode: '退出规划模式',
  generate_image: '生成图片',
};

export function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function resolveDisplayToolName(toolName: string, taskMeta?: TaskToolMeta): string {
  if (taskMeta) {
    return '子代理任务';
  }

  return TOOL_DISPLAY_NAME_MAP[normalizeToolName(toolName)] ?? toolName;
}

export function quoteSummaryValue(value: string): string {
  return /[\s,[\]=]/u.test(value) ? JSON.stringify(value) : value;
}

export function stringifySummaryParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? quoteSummaryValue(normalized) : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

export function buildParamSuffix(entries: Array<[label: string, value: unknown]>): string {
  const parts = entries
    .map(([label, value]) => {
      const formatted = stringifySummaryParam(value);
      return formatted ? `${label}=${formatted}` : null;
    })
    .filter((item): item is string => Boolean(item));

  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

export function summarizeSkillTool(input: Record<string, unknown>): string | undefined {
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

export function summarizeQuestionTool(input: Record<string, unknown>): string | undefined {
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

export function summarizeAgentTool(input: Record<string, unknown>): string | undefined {
  const description = readNonEmptyString(input['description']);
  const prompt = readNonEmptyString(input['prompt']);
  const agentType =
    readNonEmptyString(input['subagent_type']) ?? readNonEmptyString(input['agent']);
  const mode =
    input['run_in_background'] === true || input['background'] === true ? '后台' : undefined;
  const focus = description ?? prompt;

  const parts = [
    mode,
    agentType,
    focus ? truncateText(normalizeSummaryText(focus), 96) : undefined,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function summarizePlanModeTool(
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

export function summarizeSpecialToolInput(
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

  if (isSubagentToolName(normalizedToolName)) {
    return summarizeAgentTool(input);
  }

  if (normalizedToolName === 'enterplanmode' || normalizedToolName === 'exitplanmode') {
    return summarizePlanModeTool(toolName, input);
  }

  return undefined;
}

export function buildSnapshotSummary(
  filePath: string | undefined,
  beforeText: string,
  afterText: string,
): string {
  const summary = summarizeSnapshotDiff(beforeText, afterText);
  return `${filePath ? `${trimFileLikePath(filePath)} · ` : ''}+${summary.added} / -${summary.removed}`;
}

export function buildDiffFileView(record: Record<string, unknown>): ToolDiffFileView | undefined {
  const snapshot = readFileSnapshot(record);
  if (!snapshot) return undefined;
  const { before: beforeText, after: afterText } = snapshot;

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

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

export function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function truncateText(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isLargeOutput(output: unknown): boolean {
  const serialized = stringifyValue(output);
  return utf8ByteLength(serialized) > 8 * 1024;
}

export function buildOutputReadHints(
  toolCallId: string | undefined,
  output: unknown,
): string[] | undefined {
  if (output === undefined || !isLargeOutput(output)) {
    return undefined;
  }

  if (typeof output === 'string') {
    const lineCount = output.split(/\r?\n/).length;
    if (toolCallId) {
      const hints = [
        `read_tool_output {"toolCallId":"${toolCallId}","lineStart":1,"lineCount":200}`,
      ];
      if (lineCount > 200) {
        hints.push(
          `read_tool_output {"toolCallId":"${toolCallId}","lineStart":201,"lineCount":200}`,
        );
      }
      return hints;
    }

    const hints = ['read_tool_output {"useLatestReferenced":true,"lineStart":1,"lineCount":200}'];
    if (lineCount > 200) {
      hints.push('read_tool_output {"useLatestReferenced":true,"lineStart":201,"lineCount":200}');
    }
    return hints;
  }

  if (Array.isArray(output)) {
    if (toolCallId) {
      const hints = [
        `read_tool_output {"toolCallId":"${toolCallId}","itemStart":0,"itemCount":50}`,
      ];
      if (output.length > 50) {
        hints.push(`read_tool_output {"toolCallId":"${toolCallId}","itemStart":50,"itemCount":50}`);
      }
      return hints;
    }

    const hints = ['read_tool_output {"useLatestReferenced":true,"itemStart":0,"itemCount":50}'];
    if (output.length > 50) {
      hints.push('read_tool_output {"useLatestReferenced":true,"itemStart":50,"itemCount":50}');
    }
    return hints;
  }

  const record = asRecord(output);
  if (record) {
    const keys = Object.keys(record).slice(0, 3);
    if (toolCallId) {
      const hints = [`read_tool_output {"toolCallId":"${toolCallId}"}`];
      keys.forEach((key) => {
        hints.push(`read_tool_output {"toolCallId":"${toolCallId}","jsonPath":"${key}"}`);
      });
      return hints;
    }

    const hints = ['read_tool_output {"useLatestReferenced":true}'];
    keys.forEach((key) => {
      hints.push(`read_tool_output {"useLatestReferenced":true,"jsonPath":"${key}"}`);
    });
    return hints;
  }

  return toolCallId
    ? [`read_tool_output {"toolCallId":"${toolCallId}"}`]
    : ['read_tool_output {"useLatestReferenced":true}'];
}
