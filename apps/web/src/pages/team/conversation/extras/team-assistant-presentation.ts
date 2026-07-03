import type {
  AssistantTraceToolCall,
  ChatMessage,
  ChatMessagePart,
  ChatToolPart,
} from '../../../../components/conversation-runtime/messages/support.js';
import {
  parseCopiedToolCardContent,
  readAssistantTracePayload,
} from '../../../../components/conversation-runtime/messages/support.js';
import { extractFilePath } from '../../../../components/chat/tool-call/shared/input-paths.js';
import { buildGenericInputSummary } from '../../../../components/chat/tool-call/shared/input-summary.js';
import { tryFormatJson } from '../../../../utils/format-json.js';

const INLINE_REASONING_TAG_NAMES = [
  'analysis',
  'thinking',
  'think',
  'reasoning',
  'reasoning_process',
  'thought',
  'thoughts',
  'thought_process',
  'reflection',
  'scratchpad',
  'scratch_pad',
  'scratch',
  'inner_monologue',
  'monologue',
  'plan',
  'planning',
  'rationale',
  'deliberation',
] as const;

const INLINE_REASONING_TAG_GROUP = `(?:${INLINE_REASONING_TAG_NAMES.map((name) =>
  name.replace(/_/g, '[_-]'),
).join('|')})`;

const INLINE_REASONING_TAG_PROBE_RE = new RegExp(
  `<\\s*\\/?\\s*${INLINE_REASONING_TAG_GROUP}\\b`,
  'i',
);

const INLINE_REASONING_TAG_RE = new RegExp(`<\\s*\\/?\\s*${INLINE_REASONING_TAG_GROUP}\\s*>`, 'gi');

const READ_LIKE_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'list',
  'look_at',
  'repo_overview',
  'read_tool_output',
  'workspace_review_diff',
  'codesearch',
  'ast_grep_search',
  'session_read',
  'session_search',
]);

const WEB_LIKE_TOOLS = new Set(['webfetch', 'websearch', 'google_search']);

export interface TeamProcessStats {
  modifiedFileCount: number;
  readLikeToolCount: number;
  reasoningCount: number;
  toolCallCount: number;
}

export interface TeamAssistantPresentation {
  detailText: string;
  nextStep: string | null;
  processSummary: string | null;
  summaryText: string;
  toolSummaries: string[];
  modifiedFiles: string[];
  reasoningBlocks: string[];
  stats: TeamProcessStats;
}

export function buildTeamAssistantPresentation(message: ChatMessage): TeamAssistantPresentation {
  const trace = readAssistantTracePayload(message);
  const copiedToolCard = !trace ? parseCopiedToolCardContent(message.content) : null;
  const traceText = trace?.text?.trim();
  const plainTextSummary = isPlainTextSummary(message.content) ? message.content.trim() : null;
  const traceToolCalls = trace?.toolCalls ?? [];
  const reasoningBlocks = dedupeReasoningBlocks(
    trace?.reasoningBlocks?.map((item) => item.trim()).filter((item) => item.length > 0) ??
      extractReasoningBlocksFromParts(message.parts),
  );
  const toolCalls =
    traceToolCalls.length > 0
      ? traceToolCalls
      : copiedToolCard
        ? [copiedToolCard]
        : extractToolCallsFromParts(message.parts);
  const fallbackSummary =
    buildTraceFallbackSummary(toolCalls, reasoningBlocks) ??
    buildCopiedToolCardSummary(copiedToolCard) ??
    message.content;
  const rawSummaryText = normalizeSummaryText(
    traceText && traceText.length > 0 ? traceText : (plainTextSummary ?? fallbackSummary),
  );
  // 如果最终文本是 JSON 字符串，格式化后返回，避免原始 JSON 被当纯文本渲染
  const summaryText = tryFormatJson(rawSummaryText);
  const nextStep = extractNextStep(summaryText);
  const detailText = removeNextStep(summaryText);
  const toolSummaries = toolCalls.map((toolCall) => summarizeToolCall(toolCall));
  const modifiedFiles =
    trace?.modifiedFilesSummary?.files.map((file) => file.file) ??
    message.modifiedFilesSummary?.files.map((file) => file.file) ??
    [];

  const readLikeToolCount = toolCalls.filter((toolCall) =>
    READ_LIKE_TOOLS.has(toolCall.toolName.trim().toLowerCase()),
  ).length;

  const stats: TeamProcessStats = {
    modifiedFileCount: modifiedFiles.length,
    readLikeToolCount,
    reasoningCount: reasoningBlocks.length,
    toolCallCount: toolCalls.length,
  };

  return {
    detailText,
    modifiedFiles,
    nextStep,
    processSummary: buildProcessSummary(stats),
    reasoningBlocks,
    stats,
    summaryText,
    toolSummaries,
  };
}

function normalizeSummaryText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (!INLINE_REASONING_TAG_PROBE_RE.test(trimmed)) {
    return trimmed;
  }

  const blocks = trimmed
    .replace(/\r\n?/g, '\n')
    .replace(INLINE_REASONING_TAG_RE, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const dedupedBlocks: string[] = [];
  let lastKey: string | null = null;
  for (const block of blocks) {
    const key = normalizeBlockForComparison(block);
    if (!key || key === lastKey) {
      continue;
    }
    dedupedBlocks.push(block);
    lastKey = key;
  }

  return dedupedBlocks.join('\n\n').trim();
}

function isPlainTextSummary(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (trimmed.startsWith('工具：')) return false;
  return true;
}

function extractReasoningBlocksFromParts(parts: ChatMessagePart[] | undefined): string[] {
  if (!parts || parts.length === 0) {
    return [];
  }

  return parts
    .filter(
      (part): part is Extract<ChatMessagePart, { type: 'reasoning' }> => part.type === 'reasoning',
    )
    .map((part) => normalizeSummaryText(part.text))
    .filter((item) => item.length > 0);
}

function dedupeReasoningBlocks(blocks: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const normalized = normalizeSummaryText(block);
    const key = normalizeBlockForComparison(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

function normalizeBlockForComparison(block: string): string {
  return block
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function extractToolCallsFromParts(parts: ChatMessagePart[] | undefined): AssistantTraceToolCall[] {
  if (!parts || parts.length === 0) {
    return [];
  }

  return parts
    .filter((part): part is ChatToolPart => part.type === 'tool')
    .map((part) => ({
      ...(part.kind ? { kind: part.kind } : {}),
      ...(part.toolCallId ? { toolCallId: part.toolCallId } : {}),
      ...(part.output !== undefined ? { output: part.output } : {}),
      ...(part.isError ? { isError: true } : {}),
      ...(part.pendingPermissionRequestId
        ? { pendingPermissionRequestId: part.pendingPermissionRequestId }
        : {}),
      ...(part.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      ...(part.clientRequestId ? { clientRequestId: part.clientRequestId } : {}),
      ...(part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
      ...(part.fileDiffs ? { fileDiffs: part.fileDiffs } : {}),
      ...(part.observability ? { observability: part.observability } : {}),
      ...(part.status ? { status: part.status } : {}),
      input: part.input,
      toolName: part.toolName,
    }));
}

function extractNextStep(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const normalized = line.replace(/\*\*/g, '').trim();
    if (normalized.startsWith('下一步：')) {
      const value = normalized.slice('下一步：'.length).trim();
      return value.length > 0 ? value : null;
    }
    if (normalized.startsWith('下一步:')) {
      const value = normalized.slice('下一步:'.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function removeNextStep(text: string): string {
  const filtered = text
    .split('\n')
    .filter((line) => {
      const normalized = line.replace(/\*\*/g, '').trim();
      return !normalized.startsWith('下一步：') && !normalized.startsWith('下一步:');
    })
    .join('\n')
    .trim();
  return filtered.length > 0 ? filtered : text;
}

function buildProcessSummary(stats: TeamProcessStats): string | null {
  const parts: string[] = [];
  if (stats.reasoningCount > 0) {
    parts.push(`思考 ${stats.reasoningCount} 段`);
  }
  if (stats.readLikeToolCount > 0) {
    parts.push(`读取上下文 ${stats.readLikeToolCount} 次`);
  }
  if (stats.toolCallCount > 0) {
    parts.push(`工具调用 ${stats.toolCallCount} 次`);
  }
  if (stats.modifiedFileCount > 0) {
    parts.push(`涉及 ${stats.modifiedFileCount} 个文件`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function summarizeToolCall(toolCall: AssistantTraceToolCall): string {
  const normalizedName = toolCall.toolName.trim().toLowerCase();
  const path = extractFilePath(toolCall.input);

  if (READ_LIKE_TOOLS.has(normalizedName)) {
    if (path) {
      return `读取 ${path}`;
    }
    return `读取上下文 · ${toolCall.toolName}`;
  }

  if (WEB_LIKE_TOOLS.has(normalizedName)) {
    const summary = buildGenericInputSummary(toolCall.input);
    return summary ? `检索信息 · ${summary}` : '检索信息';
  }

  if (normalizedName === 'bash' || normalizedName === 'interactive_bash') {
    const command = typeof toolCall.input.command === 'string' ? toolCall.input.command.trim() : '';
    return command ? `执行命令 · ${command}` : '执行命令';
  }

  if (normalizedName === 'write' || normalizedName === 'edit' || normalizedName === 'multi_edit') {
    if (path) {
      return `修改 ${path}`;
    }
    return `修改内容 · ${toolCall.toolName}`;
  }

  const generic = buildGenericInputSummary(toolCall.input);
  if (generic) {
    return `${toolCall.toolName} · ${generic}`;
  }

  return toolCall.toolName;
}

function buildCopiedToolCardSummary(toolCall: AssistantTraceToolCall | null): string | null {
  if (!toolCall) {
    return null;
  }

  const action = summarizeHighLevelToolAction(toolCall);
  if (toolCall.isError) {
    return `该步骤执行失败：${action}。`;
  }
  if (toolCall.status === 'paused') {
    return `该步骤等待继续处理：${action}。`;
  }
  if (toolCall.status === 'completed') {
    return `已完成处理步骤：${action}。`;
  }
  return `正在处理：${action}。`;
}

function buildTraceFallbackSummary(
  toolCalls: AssistantTraceToolCall[],
  reasoningBlocks: string[],
): string | null {
  if (toolCalls.length > 0) {
    const first = buildCopiedToolCardSummary(toolCalls[0] ?? null);
    if (!first) {
      return null;
    }
    return toolCalls.length > 1
      ? `${first} 另外还有 ${toolCalls.length - 1} 个处理步骤已省略。`
      : first;
  }

  if (reasoningBlocks.length > 0) {
    return '团队正在分析处理中，技术推理细节已默认折叠。';
  }

  return null;
}

function summarizeHighLevelToolAction(toolCall: AssistantTraceToolCall): string {
  const normalizedName = toolCall.toolName.trim().toLowerCase();

  if (READ_LIKE_TOOLS.has(normalizedName)) {
    return '读取相关上下文';
  }

  if (WEB_LIKE_TOOLS.has(normalizedName)) {
    return '检索外部资料';
  }

  if (normalizedName === 'bash' || normalizedName === 'interactive_bash') {
    return '执行环境检查';
  }

  if (normalizedName === 'write' || normalizedName === 'edit' || normalizedName === 'multi_edit') {
    return '生成或调整变更内容';
  }

  if (
    normalizedName === 'task' ||
    normalizedName === 'agent' ||
    normalizedName === 'delegate_task'
  ) {
    return '派发子任务';
  }

  return '执行内部处理步骤';
}
