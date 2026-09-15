import type { AssistantTracePayload, AssistantTraceToolCall } from '@openAwork/shared';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import { hasActivePendingPermissionRequest } from './message-coercion.js';
import { createAssistantTraceContent, readAssistantTracePayload } from './trace-codec.js';

interface CopiedToolCardSections {
  inputText?: string;
  isError?: boolean;
  kind?: AssistantTraceToolCall['kind'];
  outputText?: string;
  resumedAfterApproval?: boolean;
  status?: AssistantTraceToolCall['status'];
  toolName: string;
}

function parseCopiedToolCardJson(value: string): unknown {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return value;
  }
}

function parseCopiedToolCardInput(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = parseCopiedToolCardJson(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? { raw: normalized } : {};
}

function looksLikeWaitingStateOutput(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  const serialized =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();

  const normalized = serialized.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return (
    normalized.includes('waiting for approval') ||
    normalized.includes('requires approval') ||
    normalized.includes('permission request') ||
    normalized.includes('waiting for answer') ||
    normalized.includes('waiting for confirmation') ||
    normalized.includes('等待权限') ||
    normalized.includes('等待审批') ||
    normalized.includes('等待回答') ||
    normalized.includes('等待确认')
  );
}

function shouldPreservePausedToolState(input: {
  isError?: boolean;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: string;
}): boolean {
  if (hasActivePendingPermissionRequest(input)) {
    return true;
  }

  return (
    input.status === 'paused' &&
    input.isError !== true &&
    input.resumedAfterApproval !== true &&
    looksLikeWaitingStateOutput(input.output)
  );
}

function mapCopiedToolCardKind(value: string | undefined): AssistantTraceToolCall['kind'] {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'AGENT') return 'agent';
  if (normalized === 'MCP') return 'mcp';
  if (normalized === 'SKILL') return 'skill';
  if (normalized === 'TOOL') return 'tool';
  return undefined;
}

function mapCopiedToolCardStatus(value: string | undefined): AssistantTraceToolCall['status'] {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized === '完成' || normalized === 'completed') return 'completed';
  if (normalized === '失败' || normalized === 'failed') return 'failed';
  if (normalized === '恢复后失败') return 'failed';
  if (normalized === '执行中' || normalized === 'running') return 'running';
  if (
    normalized === '等待权限' ||
    normalized === '等待处理' ||
    normalized === '等待回答' ||
    normalized === '等待确认' ||
    normalized === 'paused'
  )
    return 'paused';
  return undefined;
}

function normalizeCopiedToolCardName(rawToolName: string): string {
  if (rawToolName === '子代理任务') {
    return 'task';
  }

  if (rawToolName === '技能') {
    return 'Skill';
  }

  if (rawToolName === '询问用户') {
    return 'AskUserQuestion';
  }

  if (rawToolName === '代理委派') {
    return 'Agent';
  }

  if (rawToolName === '进入规划模式') {
    return 'EnterPlanMode';
  }

  if (rawToolName === '退出规划模式') {
    return 'ExitPlanMode';
  }

  return rawToolName;
}

function parseCopiedToolCardSections(content: string): CopiedToolCardSections | null {
  const normalized = content.trim();
  if (!normalized.startsWith('工具：')) {
    return null;
  }

  const sections = normalized
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
  const header = sections[0];
  if (!header) {
    return null;
  }

  const headerLines = header
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const toolLine = headerLines.find((line) => line.startsWith('工具：'));
  const typeLine = headerLines.find((line) => line.startsWith('类型：'));
  const statusLine = headerLines.find((line) => line.startsWith('状态：'));
  const summaryLine = headerLines.find((line) => line.startsWith('摘要：'));
  const resumeLine = headerLines.find((line) => line.startsWith('恢复：'));
  if (!toolLine || !typeLine || !statusLine || !summaryLine) {
    return null;
  }

  let inputText: string | undefined;
  let outputText: string | undefined;
  let isError = false;
  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }

    if (section === '输入' || section.startsWith('输入\n')) {
      inputText = section === '输入' ? sections[index + 1] : section.slice('输入\n'.length);
      if (section === '输入') {
        index += 1;
      }
      continue;
    }

    if (
      section === '输出' ||
      section === '错误输出' ||
      section.startsWith('输出\n') ||
      section.startsWith('错误输出\n')
    ) {
      if (section === '输出' || section === '错误输出') {
        outputText = sections[index + 1];
        isError = section === '错误输出';
        index += 1;
        continue;
      }

      if (section.startsWith('错误输出\n')) {
        outputText = section.slice('错误输出\n'.length);
        isError = true;
        continue;
      }

      outputText = section.slice('输出\n'.length);
    }
  }

  const rawToolName = toolLine.slice('工具：'.length).trim();
  if (!rawToolName) {
    return null;
  }

  return {
    inputText,
    isError,
    kind: mapCopiedToolCardKind(typeLine.slice('类型：'.length)),
    outputText,
    resumedAfterApproval: resumeLine?.slice('恢复：'.length).trim() === '审批已通过后继续执行',
    status: mapCopiedToolCardStatus(statusLine.slice('状态：'.length)),
    toolName: normalizeCopiedToolCardName(rawToolName),
  };
}

export function parseCopiedToolCardContent(content: string): AssistantTraceToolCall | null {
  const sections = parseCopiedToolCardSections(content);
  if (!sections) {
    return null;
  }

  const output = sections.outputText ? parseCopiedToolCardJson(sections.outputText) : undefined;
  const shouldStayPaused = shouldPreservePausedToolState({
    isError: sections.isError,
    output,
    resumedAfterApproval: sections.resumedAfterApproval,
    status: sections.status,
  });

  return {
    kind: sections.kind,
    toolName: sections.toolName,
    input: parseCopiedToolCardInput(sections.inputText),
    output,
    isError: sections.isError,
    ...(sections.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    status:
      sections.status === 'paused' && !shouldStayPaused
        ? sections.isError || sections.outputText
          ? 'failed'
          : 'completed'
        : sections.status,
  };
}

export function parseLegacyToolCallContent(content: string): AssistantTraceToolCall | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: Record<string, unknown>;
      type?: string;
    };

    if (parsed?.type !== 'tool_call') {
      return parseCopiedToolCardContent(content);
    }

    const payload = parsed.payload ?? {};
    const isError = payload['isError'] === true;
    const pendingPermissionRequestId =
      typeof payload['pendingPermissionRequestId'] === 'string'
        ? payload['pendingPermissionRequestId']
        : undefined;
    const resumedAfterApproval = payload['resumedAfterApproval'] === true;
    const status =
      payload['status'] === 'running' ||
      payload['status'] === 'paused' ||
      payload['status'] === 'completed' ||
      payload['status'] === 'failed'
        ? payload['status']
        : undefined;
    const shouldStayPaused = shouldPreservePausedToolState({
      isError,
      output: payload['output'],
      pendingPermissionRequestId,
      resumedAfterApproval,
      status,
    });
    return {
      kind:
        payload['kind'] === 'agent' ||
        payload['kind'] === 'mcp' ||
        payload['kind'] === 'skill' ||
        payload['kind'] === 'tool'
          ? payload['kind']
          : undefined,
      toolCallId: typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined,
      toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool',
      input:
        payload['input'] && typeof payload['input'] === 'object' && !Array.isArray(payload['input'])
          ? (payload['input'] as Record<string, unknown>)
          : {},
      output: payload['output'],
      isError,
      ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      ...(shouldStayPaused && pendingPermissionRequestId ? { pendingPermissionRequestId } : {}),
      status:
        status === 'paused' && !shouldStayPaused
          ? isError || payload['output'] !== undefined
            ? 'failed'
            : 'completed'
          : status,
    };
  } catch {
    return parseCopiedToolCardContent(content);
  }
}

export function appendToolCallToAssistantMessage(
  message: ChatMessage,
  toolCall: AssistantTraceToolCall,
): ChatMessage {
  const assistantTrace = readAssistantTracePayload(message);
  if (assistantTrace) {
    const nextToolCalls = [...assistantTrace.toolCalls, toolCall];
    const nextContent = createAssistantTraceContent({
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: assistantTrace.reasoningBlocks }
        : {}),
      text: assistantTrace.text,
      toolCalls: nextToolCalls,
    });

    // Append a new ToolPart keyed by toolCallId.
    const newToolPart: ChatToolPart = {
      id: toolCall.toolCallId ?? `${message.id}:tool:${nextToolCalls.length - 1}`,
      type: 'tool',
      toolCallId: toolCall.toolCallId ?? '',
      toolName: toolCall.toolName,
      kind: toolCall.kind,
      input: toolCall.input,
      clientRequestId: toolCall.clientRequestId,
      durationMs: toolCall.durationMs,
      fileDiffs: toolCall.fileDiffs,
      isError: toolCall.isError,
      observability: toolCall.observability,
      output: toolCall.output,
      pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
      resumedAfterApproval: toolCall.resumedAfterApproval,
      status: toolCall.status,
    };

    return {
      ...message,
      content: nextContent,
      parts: [...(message.parts ?? []), newToolPart],
      toolCallCount: (message.toolCallCount ?? assistantTrace.toolCalls.length) + 1,
    };
  }

  const newTrace: AssistantTracePayload = {
    text: message.content,
    toolCalls: [toolCall],
  };
  const newToolPart: ChatToolPart = {
    id: toolCall.toolCallId ?? `${message.id}:tool:0`,
    type: 'tool',
    toolCallId: toolCall.toolCallId ?? '',
    toolName: toolCall.toolName,
    kind: toolCall.kind,
    input: toolCall.input,
    status: toolCall.status,
  };

  return {
    ...message,
    content: createAssistantTraceContent(newTrace),
    parts: [
      ...(message.parts ?? [
        { id: `${message.id}:text`, type: 'text' as const, text: message.content },
      ]),
      newToolPart,
    ],
    toolCallCount: (message.toolCallCount ?? 0) + 1,
  };
}

export function parseToolCallInputText(inputText: string): Record<string, unknown> {
  const normalized = inputText.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }
  return { raw: normalized };
}
