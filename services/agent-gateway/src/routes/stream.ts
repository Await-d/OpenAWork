import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { FileDiffContent, MessageContent, RunEvent, StreamChunk } from '@openAwork/shared';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet, sqliteRun } from '../db.js';
import {
  modelRequestSchema,
  resolveModelRoute,
  resolveModelRouteFromProvider,
} from '../model-router.js';
import { getProviderConfigForSelection } from '../provider-config.js';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import {
  appendSessionMessage,
  buildUpstreamConversation,
  getSessionMessageByRequestId,
  hasToolOutputReference,
  listSessionMessagesByRequestScope,
  listSessionMessages,
  truncateSessionMessagesAfter,
} from '../session-message-store.js';
import { persistStreamUserMessage } from '../stream-session-title.js';
import { listSessionPermissionRunEvents } from '../session-permission-events.js';
import { publishSessionRunEvent, subscribeSessionRunEvents } from '../session-run-events.js';
import {
  buildModifiedFilesSummaryContent,
  collectFileDiffsFromToolOutput,
  mergeFileDiffs,
} from '../modified-files-summary.js';
import { createDefaultSandbox, reconcileResumedTaskChildSession } from '../tool-sandbox.js';
import type { SandboxExecutionContext } from '../tool-sandbox.js';
import {
  buildGatewayToolDefinitions,
  createStreamParseState,
  parseUpstreamFrame,
  ResponsesUpstreamEventError,
} from './stream-protocol.js';
import { isEnabledToolName } from './tool-name-compat.js';
import { resolveEofRoundDecision } from './stream-completion.js';
import { readUpstreamError } from './upstream-error.js';
import { buildUpstreamRequestBody } from './upstream-request.js';
import {
  parseSessionMetadataJson,
  sanitizeSessionMetadataJson,
} from '../session-workspace-metadata.js';
import { validateWorkspacePath } from '../workspace-paths.js';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  registerInFlightStreamRequest,
  stopInFlightStreamRequest,
} from './stream-cancellation.js';
import {
  clearPendingTaskParentAutoResumesForSession,
  isTaskParentAutoResumeClientRequestId,
  noteManualSessionInteraction,
} from '../task-parent-auto-resume.js';

type WorkflowStepHandle = ReturnType<WorkflowLogger['start']>;
type StreamStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | 'cancelled';

type PersistedSessionStateStatus = 'idle' | 'running' | 'paused';

const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。';

function setPersistedSessionStateStatus(input: {
  sessionId: string;
  status: PersistedSessionStateStatus;
  userId: string;
}): void {
  sqliteRun(
    "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.status, input.sessionId, input.userId],
  );
}

async function buildWorkspaceContext(metadataJson: string): Promise<string | null> {
  let wd: string | null = null;
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    wd = typeof meta['workingDirectory'] === 'string' ? meta['workingDirectory'] : null;
  } catch {
    return null;
  }
  if (!wd) return null;

  const safeWorkingDirectory = validateWorkspacePath(wd);
  if (!safeWorkingDirectory) return null;

  try {
    const entries = await fsp.readdir(safeWorkingDirectory, { withFileTypes: true });
    const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store']);
    const lines: string[] = [];
    for (const e of entries.slice(0, 100)) {
      if (IGNORED.has(e.name)) continue;
      lines.push((e.isDirectory() ? '📁 ' : '📄 ') + e.name);
    }
    return `<workspace path="${safeWorkingDirectory}">\n<file_tree>\n${lines.join('\n')}\n</file_tree>\n</workspace>`;
  } catch {
    return null;
  }
}

function isWebSearchEnabled(metadataJson: string): boolean {
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    if (meta['webSearchEnabled'] === true) {
      return true;
    }

    const channel = meta['channel'];
    if (typeof channel === 'object' && channel !== null) {
      const tools = (channel as Record<string, unknown>)['tools'];
      if (typeof tools === 'object' && tools !== null) {
        return (tools as Record<string, unknown>)['web_search'] === true;
      }
    }

    return meta['webSearchEnabled'] === true;
  } catch {
    return false;
  }
}

const streamRequestSchema = modelRequestSchema.extend({
  displayMessage: z.string().min(1).max(32768).optional(),
  message: z.string().min(1).max(32768),
  providerId: z.string().min(1).max(200).optional(),
  clientRequestId: z.string().min(1).max(128),
  webSearchEnabled: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
});

const stopStreamSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
});

type StreamRequest = z.infer<typeof streamRequestSchema>;

export interface ApprovedPermissionResumePayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
}

interface SessionStreamContext {
  legacyMessagesJson: string;
  metadataJson: string;
}

interface SessionUserRow {
  email: string;
}

interface SessionProviderSelection {
  modelId?: string;
  providerId?: string;
  variant?: string;
  systemPrompt?: string;
}

interface StreamAccumulationState {
  assistantThinking: string;
  assistantText: string;
  toolCalls: Map<string, { toolName: string; inputText: string }>;
}

interface TaskRuntimeGuardContext {
  lastToolSignature: string | null;
  maxConsecutiveRepeatedToolCalls: number;
  repeatedToolSignatureCount: number;
}

const DEFAULT_TASK_RUNTIME_GUARDS = {
  maxConsecutiveRepeatedToolCalls: 4,
};

function createAccumulationState(): StreamAccumulationState {
  return {
    assistantThinking: '',
    assistantText: '',
    toolCalls: new Map(),
  };
}

function buildAssistantTextWithThinking(text: string, thinking: string): string {
  const normalizedThinking = thinking.trim();
  const normalizedText = text.trim();

  if (normalizedThinking.length === 0) {
    return text;
  }

  const fenceMatches = normalizedThinking.match(/`{3,}/g);
  const longestFence = fenceMatches?.reduce((max, value) => Math.max(max, value.length), 2) ?? 2;
  const fence = '`'.repeat(longestFence + 1);
  const thinkingBlock = `${fence}thinking\n${normalizedThinking}\n${fence}`;
  return normalizedText.length > 0 ? `${thinkingBlock}\n\n${text}` : thinkingBlock;
}

export function createTaskRuntimeGuardContext(
  metadataJson: string,
): TaskRuntimeGuardContext | null {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (metadata['createdByTool'] !== 'task') {
    return null;
  }

  return {
    lastToolSignature: null,
    maxConsecutiveRepeatedToolCalls: DEFAULT_TASK_RUNTIME_GUARDS.maxConsecutiveRepeatedToolCalls,
    repeatedToolSignatureCount: 0,
  };
}

export function recordTaskToolCallOrThrow(
  guardContext: TaskRuntimeGuardContext | null | undefined,
  toolName: string,
  inputText: string,
): void {
  if (!guardContext) {
    return;
  }

  const normalizedSignature = `${toolName}:${inputText.trim()}`;
  if (guardContext.lastToolSignature === normalizedSignature) {
    guardContext.repeatedToolSignatureCount += 1;
  } else {
    guardContext.lastToolSignature = normalizedSignature;
    guardContext.repeatedToolSignatureCount = 1;
  }

  if (guardContext.repeatedToolSignatureCount > guardContext.maxConsecutiveRepeatedToolCalls) {
    throw new Error(
      `子代理连续重复调用同一工具已达到上限（${guardContext.maxConsecutiveRepeatedToolCalls}）。`,
    );
  }
}

function accumulateChunk(state: StreamAccumulationState, chunk: StreamChunk): void {
  if (chunk.type === 'text_delta') {
    state.assistantText += chunk.delta;
    return;
  }

  if (chunk.type === 'thinking_delta') {
    state.assistantThinking += chunk.delta;
    return;
  }

  if (chunk.type !== 'tool_call_delta') return;
  const existing = state.toolCalls.get(chunk.toolCallId);
  state.toolCalls.set(chunk.toolCallId, {
    toolName: chunk.toolName,
    inputText: `${existing?.inputText ?? ''}${chunk.inputDelta}`,
  });
}

function buildAssistantContent(
  state: StreamAccumulationState,
  turnFileDiffs?: Map<string, FileDiffContent>,
): MessageContent[] {
  const content: MessageContent[] = [];
  const assistantText = buildAssistantTextWithThinking(
    state.assistantText,
    state.assistantThinking,
  );
  if (assistantText.trim().length > 0) {
    content.push({ type: 'text', text: assistantText });
  }

  state.toolCalls.forEach((toolCall, toolCallId) => {
    content.push({
      type: 'tool_call',
      toolCallId,
      toolName: toolCall.toolName,
      input: parseToolInput(toolCall.inputText),
    });
  });

  const summary = turnFileDiffs ? buildModifiedFilesSummaryContent(turnFileDiffs) : null;
  if (summary) {
    content.push(summary);
  }

  return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

function getEnabledTools(webSearchEnabled: boolean) {
  return buildGatewayToolDefinitions().filter((tool) => {
    if (tool.function.name !== 'websearch') return true;
    return webSearchEnabled;
  });
}

function createAbortError(): Error {
  const error = new Error('Stream cancelled');
  error.name = 'AbortError';
  return error;
}

function createRunEventMeta(runId: string, sequence: { value: number }) {
  const eventId = `${runId}:evt:${sequence.value}`;
  sequence.value += 1;
  return {
    eventId,
    runId,
    occurredAt: Date.now(),
  };
}

function buildMissingToolArgumentsMessage(toolName: string): string {
  if (toolName === 'list') {
    return 'Tool "list" was called without arguments. Retry with JSON like {"path":"/absolute/workspace/path","depth":2}.';
  }

  if (toolName === 'bash') {
    return 'Tool "bash" was called without arguments. Retry with JSON like {"command":"pwd","workdir":"/absolute/workspace/path"}.';
  }

  return `Tool "${toolName}" was called without arguments. Retry with a non-empty JSON object that matches the tool schema.`;
}

function isMissingRequiredToolArguments(
  toolName: string,
  normalizedInputText: string,
  rawInput: Record<string, unknown>,
): boolean {
  if (normalizedInputText.length === 0) {
    return true;
  }

  if (toolName !== 'list' && toolName !== 'bash') {
    return false;
  }

  return Object.keys(rawInput).length === 0;
}

function isToolUseStopReason(reason: StreamStopReason): boolean {
  return reason === 'tool_use';
}

function replayPersistedAssistantResponse(input: {
  clientRequestId: string;
  runId: string;
  sessionId: string;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
}): boolean {
  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });
  if (!stored) return false;

  const scopedMessages = listSessionMessagesByRequestScope({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
  const permissionEvents = listSessionPermissionRunEvents(input.sessionId);
  const toolNames = new Map<string, string>();
  scopedMessages.forEach((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') {
      return;
    }
    message.content.forEach((content) => {
      if (content.type === 'tool_call') {
        toolNames.set(content.toolCallId, content.toolName);
      }
    });
  });
  let sequence = 1;
  permissionEvents.forEach((event) => {
    input.writeChunk({
      ...event,
      eventId: event.eventId ?? `${input.runId}:replay:${sequence++}`,
      runId: event.runId ?? input.runId,
      occurredAt: event.occurredAt ?? Date.now(),
    });
  });
  scopedMessages.forEach((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') {
      return;
    }

    if (message.role === 'tool') {
      message.content.forEach((content) => {
        if (content.type !== 'tool_result') return;
        input.writeChunk({
          type: 'tool_result',
          toolCallId: content.toolCallId,
          toolName: toolNames.get(content.toolCallId) ?? 'tool',
          output: content.output,
          isError: content.isError,
          pendingPermissionRequestId: content.pendingPermissionRequestId,
          eventId: `${input.runId}:replay:${sequence++}`,
          runId: input.runId,
          occurredAt: Date.now(),
        });
      });
      return;
    }

    message.content.forEach((content) => {
      const meta = {
        eventId: `${input.runId}:replay:${sequence++}`,
        runId: input.runId,
        occurredAt: Date.now(),
      };

      if (content.type === 'text' && content.text.length > 0) {
        input.writeChunk({ type: 'text_delta', delta: content.text, ...meta });
        return;
      }

      if (content.type === 'tool_call') {
        input.writeChunk({
          type: 'tool_call_delta',
          toolCallId: content.toolCallId,
          toolName: content.toolName,
          inputDelta: JSON.stringify(content.input),
          ...meta,
        });
      }
    });
  });

  if (stored.status === 'error') {
    const fallbackMessage = stored.message.content[0];
    input.writeChunk(
      createStreamErrorChunk(
        'REQUEST_FAILED',
        fallbackMessage?.type === 'text' ? fallbackMessage.text : 'Request failed',
        input.runId,
      ),
    );
    return true;
  }

  input.writeChunk({
    type: 'done',
    stopReason: 'end_turn',
    eventId: `${input.runId}:replay:${sequence}`,
    runId: input.runId,
    occurredAt: Date.now(),
  });
  return true;
}

function parseToolInput(raw: string): Record<string, unknown> {
  const normalized = raw.trim();
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

function buildErrorContent(code: string, message: string): MessageContent[] {
  return [{ type: 'text', text: `[错误: ${code}] ${message}`.trim() }];
}

function loadSessionContext(sessionId: string, userId: string): SessionStreamContext | null {
  const session = sqliteGet<{ metadata_json: string; messages_json: string }>(
    'SELECT metadata_json, messages_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!session) return null;
  return {
    metadataJson: sanitizeSessionMetadataJson(session.metadata_json),
    legacyMessagesJson: session.messages_json,
  };
}

function loadSessionUser(sessionId: string, userId: string): JwtPayload | null {
  const user = sqliteGet<SessionUserRow>(
    `SELECT u.email
     FROM users u
     JOIN sessions s ON s.user_id = u.id
     WHERE s.id = ? AND u.id = ?
     LIMIT 1`,
    [sessionId, userId],
  );

  if (!user) {
    return null;
  }

  return {
    sub: userId,
    email: user.email,
  };
}

function parseSessionProviderSelection(metadataJson: string): SessionProviderSelection {
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const channel = parsed['channel'];
    const channelRecord =
      typeof channel === 'object' && channel !== null ? (channel as Record<string, unknown>) : null;
    return {
      providerId:
        typeof parsed['providerId'] === 'string'
          ? parsed['providerId']
          : typeof channelRecord?.['providerId'] === 'string'
            ? channelRecord['providerId']
            : undefined,
      modelId:
        typeof parsed['modelId'] === 'string'
          ? parsed['modelId']
          : typeof channelRecord?.['model'] === 'string'
            ? channelRecord['model']
            : undefined,
      variant:
        typeof parsed['variant'] === 'string'
          ? parsed['variant']
          : typeof channelRecord?.['variant'] === 'string'
            ? channelRecord['variant']
            : undefined,
      systemPrompt:
        typeof parsed['delegatedSystemPrompt'] === 'string'
          ? parsed['delegatedSystemPrompt']
          : typeof parsed['systemPrompt'] === 'string'
            ? parsed['systemPrompt']
            : undefined,
    };
  } catch {
    return {};
  }
}

function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function resolveStreamModelRoute(input: {
  metadataJson: string;
  requestData: StreamRequest;
  userId: string;
}) {
  const providerRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [input.userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [input.userId],
  );
  const sessionSelection = parseSessionProviderSelection(input.metadataJson);
  const resolvedRequestData: StreamRequest = {
    ...input.requestData,
    variant: input.requestData.variant ?? sessionSelection.variant,
    systemPrompt: input.requestData.systemPrompt ?? sessionSelection.systemPrompt,
  };
  const providerConfig = await getProviderConfigForSelection(
    parseStoredJson(providerRow?.value),
    parseStoredJson(selectionRow?.value),
    {
      providerId: resolvedRequestData.providerId ?? sessionSelection.providerId,
      modelId: resolvedRequestData.model ?? sessionSelection.modelId,
    },
  );

  if (providerConfig) {
    return resolveModelRouteFromProvider(
      providerConfig.provider,
      providerConfig.modelId,
      resolvedRequestData,
    );
  }

  return resolveModelRoute(resolvedRequestData);
}

function createIntermediateAssistantRequestId(clientRequestId: string, round: number): string {
  return `${clientRequestId}:assistant:${round}`;
}

function createToolResultRequestId(clientRequestId: string, toolCallId: string): string {
  return `${clientRequestId}:tool:${toolCallId}`;
}

async function executeToolCalls(input: {
  clientRequestId: string;
  executionContext?: SandboxExecutionContext;
  enabledToolNames: Set<string>;
  eventSequence: { value: number };
  runId: string;
  signal: AbortSignal;
  sessionContext: SessionStreamContext;
  sessionId: string;
  state: StreamAccumulationState;
  taskRuntimeGuardContext?: TaskRuntimeGuardContext | null;
  turnFileDiffs?: Map<string, FileDiffContent>;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
}): Promise<void> {
  const sandbox = createDefaultSandbox();

  for (const [toolCallId, toolCall] of input.state.toolCalls.entries()) {
    if (input.signal.aborted) {
      throw createAbortError();
    }

    const normalizedInputText = toolCall.inputText.trim();
    recordTaskToolCallOrThrow(
      input.taskRuntimeGuardContext,
      toolCall.toolName,
      normalizedInputText,
    );
    const parsedInput = parseToolInput(toolCall.inputText);
    const request = {
      toolCallId,
      toolName: toolCall.toolName,
      rawInput: parsedInput,
    };

    const result = isMissingRequiredToolArguments(
      toolCall.toolName,
      normalizedInputText,
      parsedInput,
    )
      ? {
          toolCallId,
          toolName: toolCall.toolName,
          output: buildMissingToolArgumentsMessage(toolCall.toolName),
          isError: true,
          durationMs: 0,
        }
      : isEnabledToolName(toolCall.toolName, input.enabledToolNames)
        ? await sandbox.execute(request, input.signal, input.sessionId, input.executionContext)
        : {
            toolCallId,
            toolName: toolCall.toolName,
            output: `Tool "${toolCall.toolName}" is not enabled for this request`,
            isError: true,
            durationMs: 0,
          };

    appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId,
          output: result.output,
          isError: result.isError,
          pendingPermissionRequestId: result.pendingPermissionRequestId,
        },
      ],
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId: createToolResultRequestId(input.clientRequestId, toolCallId),
    });

    if (input.turnFileDiffs) {
      mergeFileDiffs(input.turnFileDiffs, collectFileDiffsFromToolOutput(result.output));
    }

    input.writeChunk({
      type: 'tool_result',
      toolCallId,
      toolName: toolCall.toolName,
      output: result.output,
      isError: result.isError,
      pendingPermissionRequestId: result.pendingPermissionRequestId,
      ...createRunEventMeta(input.runId, input.eventSequence),
    });
  }
}

function createStreamExecutionContext(
  clientRequestId: string,
  nextRound: number,
  requestData: StreamRequest,
): SandboxExecutionContext {
  return {
    clientRequestId,
    nextRound,
    requestData,
  };
}

async function runModelRound(input: {
  clientRequestId: string;
  enabledTools: ReturnType<typeof getEnabledTools>;
  eventSequence: { value: number };
  requestData: StreamRequest;
  round: number;
  route: ReturnType<typeof resolveModelRoute>;
  runId: string;
  signal: AbortSignal;
  sessionContext: SessionStreamContext;
  sessionId: string;
  transport: 'SSE' | 'WS';
  turnFileDiffs?: Map<string, FileDiffContent>;
  userId: string;
  wl: WorkflowLogger;
  ctx: ReturnType<typeof createRequestContext>;
  workspaceCtx: string | null;
  writeChunk: (chunk: RunEvent) => void;
}): Promise<{
  shouldContinue: boolean;
  shouldStop: boolean;
  stopReason: StreamStopReason;
  statusCode: number;
  state: StreamAccumulationState;
}> {
  const conversation = buildUpstreamConversation(
    listSessionMessages({
      sessionId: input.sessionId,
      userId: input.userId,
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      statuses: ['final'],
    }),
  );
  const shouldGuideToolOutputReadback = hasToolOutputReference(conversation);
  const upstreamMessages = [
    ...(input.workspaceCtx ? [{ role: 'system' as const, content: input.workspaceCtx }] : []),
    ...(input.route.systemPrompt
      ? [{ role: 'system' as const, content: input.route.systemPrompt }]
      : []),
    ...(shouldGuideToolOutputReadback
      ? [{ role: 'system' as const, content: TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT }]
      : []),
    ...conversation,
  ];
  const upstreamPath =
    input.route.upstreamProtocol === 'responses' ? '/responses' : '/chat/completions';
  const upstreamBody = buildUpstreamRequestBody({
    protocol: input.route.upstreamProtocol,
    model: input.route.model,
    variant: input.route.variant,
    maxTokens: input.route.maxTokens,
    temperature: input.route.temperature,
    messages: upstreamMessages,
    tools: input.enabledTools,
    requestOverrides: input.route.requestOverrides,
  });

  const stepUpstream = input.wl.start(`upstream.fetch.${input.round}`, undefined, {
    model: input.route.model,
    upstreamProtocol: input.route.upstreamProtocol,
    round: input.round,
    stream: true,
  });
  const state = createAccumulationState();
  let stepStream: WorkflowStepHandle | undefined;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(input.route.apiKey ? { Authorization: `Bearer ${input.route.apiKey}` } : {}),
      ...(input.route.requestOverrides.headers ?? {}),
    };

    const response = await fetch(`${input.route.apiBaseUrl}${upstreamPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: input.signal,
    });

    if (!response.ok || !response.body) {
      const upstreamError = await readUpstreamError(response);
      input.wl.fail(stepUpstream, undefined, { status: response.status });
      appendSessionMessage({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent(upstreamError.code, upstreamError.message),
        legacyMessagesJson: input.sessionContext.legacyMessagesJson,
        clientRequestId: input.clientRequestId,
        status: 'error',
      });
      input.writeChunk({
        ...createStreamErrorChunk(upstreamError.code, upstreamError.message, input.runId),
        status: response.status,
      } as RunEvent);
      input.wl.flush(input.ctx, response.status);
      return {
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: response.status,
        state,
      };
    }
    input.wl.succeed(stepUpstream, undefined, { status: response.status });

    stepStream = input.wl.start('upstream.stream', undefined, {
      protocol: input.transport,
      upstreamProtocol: input.route.upstreamProtocol,
      round: input.round,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const streamState = createStreamParseState(input.runId);
    streamState.nextEventSequence = input.eventSequence.value;
    let buffer = '';
    let stopReason: StreamStopReason = 'end_turn';

    const finalizeAssistant = (reason: StreamStopReason) => {
      if (
        reason === 'cancelled' &&
        state.assistantThinking.trim().length === 0 &&
        state.assistantText.trim().length === 0 &&
        state.toolCalls.size === 0
      ) {
        return;
      }
      appendSessionMessage({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildAssistantContent(
          state,
          reason === 'tool_use' ? undefined : input.turnFileDiffs,
        ),
        legacyMessagesJson: input.sessionContext.legacyMessagesJson,
        clientRequestId:
          reason === 'tool_use'
            ? createIntermediateAssistantRequestId(input.clientRequestId, input.round)
            : input.clientRequestId,
      });
    };

    const completeRound = (
      reason: StreamStopReason,
      doneChunk?: {
        type: 'done';
        stopReason: StreamStopReason;
        eventId?: string;
        runId?: string;
        occurredAt?: number;
      },
    ) => {
      stopReason = reason;
      finalizeAssistant(stopReason);
      if (stopReason !== 'tool_use' || state.toolCalls.size === 0) {
        input.writeChunk(
          doneChunk ?? {
            type: 'done',
            stopReason,
            ...createRunEventMeta(input.runId, input.eventSequence),
          },
        );
      }
      if (stepStream) {
        input.wl.succeed(stepStream, undefined, { round: input.round, stopReason });
      }

      const shouldContinue = isToolUseStopReason(stopReason) ? state.toolCalls.size > 0 : false;
      return {
        shouldContinue,
        shouldStop: !shouldContinue,
        stopReason,
        statusCode: 200,
        state,
      };
    };

    const applyParsedChunks = (parsedChunks: StreamChunk[]) => {
      for (const parsedChunk of parsedChunks) {
        input.eventSequence.value = streamState.nextEventSequence;
        if (parsedChunk.type === 'done') {
          return completeRound(parsedChunk.stopReason, parsedChunk);
        }

        accumulateChunk(state, parsedChunk);
        input.writeChunk(parsedChunk);
      }

      return null;
    };

    const processBuffer = () => {
      let normalized = buffer.replace(/\r\n/g, '\n');
      let boundary = normalized.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = normalized.slice(0, boundary);
        buffer = normalized.slice(boundary + 2);
        normalized = buffer.replace(/\r\n/g, '\n');
        boundary = normalized.indexOf('\n\n');

        const parsedChunks = parseUpstreamFrame(frame, input.route.upstreamProtocol, streamState);
        const result = applyParsedChunks(parsedChunks);
        if (result) {
          return result;
        }
      }

      input.eventSequence.value = streamState.nextEventSequence;
      return null;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      try {
        const result = processBuffer();
        if (result) {
          return result;
        }
      } catch (error) {
        const errorCode = error instanceof ResponsesUpstreamEventError ? error.code : 'PARSE_ERROR';
        const errorMessage =
          error instanceof ResponsesUpstreamEventError
            ? error.message
            : 'Failed to parse upstream stream chunk';
        if (stepStream.status === 'pending') {
          input.wl.fail(stepStream, errorMessage, {
            round: input.round,
          });
        }
        appendSessionMessage({
          sessionId: input.sessionId,
          userId: input.userId,
          role: 'assistant',
          content: buildErrorContent(errorCode, errorMessage),
          legacyMessagesJson: input.sessionContext.legacyMessagesJson,
          clientRequestId: input.clientRequestId,
          status: 'error',
        });
        input.writeChunk(createStreamErrorChunk(errorCode, errorMessage, input.runId));
        input.wl.flush(input.ctx, 502);
        return {
          shouldContinue: false,
          shouldStop: true,
          stopReason: 'error',
          statusCode: 502,
          state,
        };
      }

      if (done) break;
    }

    try {
      const trailingFrame = buffer.replace(/\r\n/g, '\n').trim();
      if (trailingFrame.length > 0) {
        const trailingResult = applyParsedChunks(
          parseUpstreamFrame(trailingFrame, input.route.upstreamProtocol, streamState),
        );
        if (trailingResult) {
          return trailingResult;
        }
      }
    } catch (error) {
      const errorCode = error instanceof ResponsesUpstreamEventError ? error.code : 'PARSE_ERROR';
      const errorMessage =
        error instanceof ResponsesUpstreamEventError
          ? error.message
          : 'Failed to parse upstream stream chunk';
      if (stepStream.status === 'pending') {
        input.wl.fail(stepStream, errorMessage, {
          round: input.round,
        });
      }
      appendSessionMessage({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent(errorCode, errorMessage),
        legacyMessagesJson: input.sessionContext.legacyMessagesJson,
        clientRequestId: input.clientRequestId,
        status: 'error',
      });
      input.writeChunk(createStreamErrorChunk(errorCode, errorMessage, input.runId));
      input.wl.flush(input.ctx, 502);
      return {
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: 502,
        state,
      };
    }

    const eofResolution = resolveEofRoundDecision({
      sawFinishReason: streamState.sawFinishReason,
      stopReason: streamState.stopReason,
      toolCallCount: state.toolCalls.size,
    });
    return completeRound(eofResolution.stopReason);
  } catch (err) {
    if (input.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      input.writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(input.runId, input.eventSequence),
      });
      return {
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'cancelled',
        statusCode: 200,
        state,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (stepStream && stepStream.status === 'pending') {
      input.wl.fail(stepStream, message, { round: input.round });
    }
    if (stepUpstream.status === 'pending') {
      input.wl.fail(stepUpstream, message);
    }
    appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', message),
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId: input.clientRequestId,
      status: 'error',
    });
    input.writeChunk(createStreamErrorChunk('STREAM_ERROR', message, input.runId));
    input.wl.flush(input.ctx, 500);
    return { shouldContinue: false, shouldStop: true, stopReason: 'error', statusCode: 500, state };
  }
}

async function handleStreamRequest(input: {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method: string;
  path: string;
  requestData: StreamRequest;
  sessionContext: SessionStreamContext;
  sessionId: string;
  transport: 'SSE' | 'WS';
  user: JwtPayload;
  writeChunk: (chunk: RunEvent) => void;
}): Promise<{ statusCode: number }> {
  const runId = randomUUID();
  const wl = new WorkflowLogger();
  const ctx = createRequestContext(input.method, input.path, input.headers, input.ip);
  if (!isTaskParentAutoResumeClientRequestId(input.requestData.clientRequestId)) {
    noteManualSessionInteraction({ sessionId: input.sessionId, userId: input.user.sub });
  }
  const stepRoute = wl.start('stream.model-resolve');
  let route: ReturnType<typeof resolveModelRoute>;
  try {
    route = await resolveStreamModelRoute({
      metadataJson: input.sessionContext.metadataJson,
      requestData: input.requestData,
      userId: input.user.sub,
    });
    wl.succeed(stepRoute, undefined, { model: route.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    wl.fail(stepRoute, message);
    wl.flush(ctx, 500);
    throw error;
  }

  const workspaceCtx = await buildWorkspaceContext(input.sessionContext.metadataJson);
  const webSearchEnabled =
    input.requestData.webSearchEnabled ?? isWebSearchEnabled(input.sessionContext.metadataJson);

  if (
    replayPersistedAssistantResponse({
      clientRequestId: input.requestData.clientRequestId,
      runId,
      sessionId: input.sessionId,
      userId: input.user.sub,
      writeChunk: input.writeChunk,
    })
  ) {
    wl.flush(ctx, 200);
    return { statusCode: 200 };
  }

  const inFlight = getInFlightStreamRequest(input.sessionId, input.requestData.clientRequestId);
  if (inFlight) {
    await inFlight.execution.catch(() => undefined);
    if (
      replayPersistedAssistantResponse({
        clientRequestId: input.requestData.clientRequestId,
        runId,
        sessionId: input.sessionId,
        userId: input.user.sub,
        writeChunk: input.writeChunk,
      })
    ) {
      wl.flush(ctx, 200);
      return { statusCode: 200 };
    }

    wl.flush(ctx, 409);
    input.writeChunk(
      createStreamErrorChunk('REQUEST_REPLAY_FAILED', 'Request replay failed', runId),
    );
    return { statusCode: 409 };
  }

  if (
    getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: input.requestData.clientRequestId,
      sessionId: input.sessionId,
      userId: input.user.sub,
    })
  ) {
    wl.flush(ctx, 409);
    input.writeChunk(
      createStreamErrorChunk(
        'SESSION_ALREADY_RUNNING',
        'Another request is already running for this session.',
        runId,
      ),
    );
    return { statusCode: 409 };
  }

  const abortController = new AbortController();
  const eventSequence = { value: 1 };
  const taskRuntimeGuardContext = createTaskRuntimeGuardContext(input.sessionContext.metadataJson);
  const execution = (async () => {
    let shouldKeepPausedState = false;
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'running',
      userId: input.user.sub,
    });
    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      if (event.type === 'permission_asked') {
        shouldKeepPausedState = true;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'paused',
          userId: input.user.sub,
        });
      }

      if (event.type === 'permission_replied' && event.decision !== 'reject') {
        shouldKeepPausedState = false;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'running',
          userId: input.user.sub,
        });
      }

      input.writeChunk(event);
    });

    try {
      if (abortController.signal.aborted) {
        throw createAbortError();
      }

      persistStreamUserMessage({
        clientRequestId: input.requestData.clientRequestId,
        displayMessage: input.requestData.displayMessage,
        legacyMessagesJson: input.sessionContext.legacyMessagesJson,
        message: input.requestData.message,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });

      const enabledTools = filterEnabledGatewayToolsForSession(
        getEnabledTools(webSearchEnabled),
        input.sessionContext.metadataJson,
      );
      const enabledToolNames = new Set(enabledTools.map((tool) => tool.function.name));
      const turnFileDiffs = new Map<string, FileDiffContent>();

      for (let round = 1; ; round += 1) {
        const result = await runModelRound({
          clientRequestId: input.requestData.clientRequestId,
          enabledTools,
          eventSequence,
          requestData: input.requestData,
          round,
          route,
          runId,
          signal: abortController.signal,
          sessionContext: input.sessionContext,
          sessionId: input.sessionId,
          transport: input.transport,
          turnFileDiffs,
          userId: input.user.sub,
          wl,
          ctx,
          workspaceCtx,
          writeChunk: input.writeChunk,
        });

        if (result.stopReason === 'error' || result.shouldStop) {
          if (result.stopReason !== 'error') {
            wl.flush(ctx, 200);
          }
          if (!shouldKeepPausedState) {
            setPersistedSessionStateStatus({
              sessionId: input.sessionId,
              status: 'idle',
              userId: input.user.sub,
            });
          }
          return { statusCode: result.statusCode };
        }

        await executeToolCalls({
          clientRequestId: input.requestData.clientRequestId,
          executionContext: createStreamExecutionContext(
            input.requestData.clientRequestId,
            round + 1,
            input.requestData,
          ),
          enabledToolNames,
          eventSequence,
          runId,
          signal: abortController.signal,
          sessionContext: input.sessionContext,
          sessionId: input.sessionId,
          state: result.state,
          taskRuntimeGuardContext,
          turnFileDiffs,
          userId: input.user.sub,
          writeChunk: input.writeChunk,
        });
      }
    } finally {
      unsubscribeSessionEvents();
    }
  })().catch((err) => {
    if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      input.writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(runId, eventSequence),
      });
      wl.flush(ctx, 200);
      setPersistedSessionStateStatus({
        sessionId: input.sessionId,
        status: 'idle',
        userId: input.user.sub,
      });
      return { statusCode: 200 };
    }

    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.user.sub,
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.user.sub,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', String(err)),
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId: input.requestData.clientRequestId,
      status: 'error',
    });
    input.writeChunk(createStreamErrorChunk('STREAM_ERROR', String(err), runId));
    wl.flush(ctx, 500);
    throw err;
  });

  registerInFlightStreamRequest({
    abortController,
    clientRequestId: input.requestData.clientRequestId,
    execution,
    sessionId: input.sessionId,
    userId: input.user.sub,
  });
  try {
    return await execution;
  } finally {
    clearInFlightStreamRequest({
      clientRequestId: input.requestData.clientRequestId,
      execution,
      sessionId: input.sessionId,
    });
  }
}

export async function resumeApprovedPermissionRequest(input: {
  payload: ApprovedPermissionResumePayload;
  sessionId: string;
  userId: string;
}): Promise<void> {
  let resumeResult: { pendingInteraction: boolean; statusCode: number };
  try {
    const sandbox = createDefaultSandbox();
    const toolResult = await sandbox.execute(
      {
        toolCallId: input.payload.toolCallId,
        toolName: input.payload.toolName,
        rawInput: input.payload.rawInput,
      },
      new AbortController().signal,
      input.sessionId,
      createStreamExecutionContext(
        input.payload.clientRequestId,
        input.payload.nextRound,
        streamRequestSchema.parse(input.payload.requestData),
      ),
    );

    resumeResult = await continueFromApprovedToolResult({
      initialToolResult: {
        isError: toolResult.isError,
        output: toolResult.output,
        toolCallId: input.payload.toolCallId,
        toolName: input.payload.toolName,
      },
      payload: input.payload,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    await reconcileResumedTaskChildSession({
      childSessionId: input.sessionId,
      pendingInteraction: resumeResult.pendingInteraction,
      statusCode: resumeResult.statusCode,
      userId: input.userId,
    });
  } catch (error) {
    await reconcileResumedTaskChildSession({
      childSessionId: input.sessionId,
      pendingInteraction: false,
      statusCode: 500,
      userId: input.userId,
    });
    throw error;
  }
}

export async function runSessionInBackground(input: {
  requestData: Record<string, unknown>;
  sessionId: string;
  userId: string;
  writeChunk?: (chunk: RunEvent) => void;
}): Promise<{ statusCode: number }> {
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }

  const user = loadSessionUser(input.sessionId, input.userId);
  if (!user) {
    throw new Error(`Session user not found: ${input.userId}`);
  }

  return handleStreamRequest({
    headers: {},
    ip: 'internal',
    method: 'INTERNAL',
    path: `/sessions/${input.sessionId}/stream/background`,
    requestData: streamRequestSchema.parse(input.requestData),
    sessionContext,
    sessionId: input.sessionId,
    transport: 'SSE',
    user,
    writeChunk: input.writeChunk ?? (() => undefined),
  });
}

async function continueFromApprovedToolResult(input: {
  initialToolResult: {
    isError: boolean;
    output: unknown;
    toolCallId: string;
    toolName: string;
  };
  payload: ApprovedPermissionResumePayload;
  sessionId: string;
  userId: string;
}): Promise<{ pendingInteraction: boolean; statusCode: number }> {
  const requestData = streamRequestSchema.parse(input.payload.requestData);
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error('Session not found');
  }

  const runId = randomUUID();
  const eventSequence = { value: 1 };
  const writeChunk = (chunk: RunEvent) => {
    publishSessionRunEvent(input.sessionId, chunk);
  };
  const route = await resolveStreamModelRoute({
    metadataJson: sessionContext.metadataJson,
    requestData,
    userId: input.userId,
  });
  const workspaceCtx = await buildWorkspaceContext(sessionContext.metadataJson);
  const webSearchEnabled =
    requestData.webSearchEnabled ?? isWebSearchEnabled(sessionContext.metadataJson);
  const enabledTools = filterEnabledGatewayToolsForSession(
    getEnabledTools(webSearchEnabled),
    sessionContext.metadataJson,
  );
  const enabledToolNames = new Set(enabledTools.map((tool) => tool.function.name));
  const turnFileDiffs = new Map<string, FileDiffContent>();
  const abortController = new AbortController();
  const taskRuntimeGuardContext = createTaskRuntimeGuardContext(sessionContext.metadataJson);
  const wl = new WorkflowLogger();
  const ctx = createRequestContext(
    'INTERNAL',
    `/sessions/${input.sessionId}/stream/resume`,
    {},
    'local',
  );

  const execution = (async (): Promise<{ pendingInteraction: boolean; statusCode: number }> => {
    let shouldKeepPausedState = false;
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'running',
      userId: input.userId,
    });

    if (
      getAnyInFlightStreamRequestForSession({
        excludeClientRequestId: input.payload.clientRequestId,
        sessionId: input.sessionId,
        userId: input.userId,
      })
    ) {
      throw new Error('Another request is already running for this session.');
    }

    const toolResultMessage = appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId: input.initialToolResult.toolCallId,
          output: input.initialToolResult.output,
          isError: input.initialToolResult.isError,
          pendingPermissionRequestId: undefined,
        },
      ],
      legacyMessagesJson: sessionContext.legacyMessagesJson,
      clientRequestId: createToolResultRequestId(
        input.payload.clientRequestId,
        input.initialToolResult.toolCallId,
      ),
      replaceExisting: true,
    });

    truncateSessionMessagesAfter({
      sessionId: input.sessionId,
      userId: input.userId,
      messageId: toolResultMessage.id,
      legacyMessagesJson: sessionContext.legacyMessagesJson,
      inclusive: false,
    });

    writeChunk({
      type: 'tool_result',
      toolCallId: input.initialToolResult.toolCallId,
      toolName: input.initialToolResult.toolName,
      output: input.initialToolResult.output,
      isError: input.initialToolResult.isError,
      ...createRunEventMeta(runId, eventSequence),
    });
    mergeFileDiffs(turnFileDiffs, collectFileDiffsFromToolOutput(input.initialToolResult.output));

    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      if (event.type === 'permission_asked') {
        shouldKeepPausedState = true;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'paused',
          userId: input.userId,
        });
      }

      if (event.type === 'permission_replied' && event.decision !== 'reject') {
        shouldKeepPausedState = false;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'running',
          userId: input.userId,
        });
      }
    });

    try {
      for (let round = input.payload.nextRound; ; round += 1) {
        const result = await runModelRound({
          clientRequestId: input.payload.clientRequestId,
          enabledTools,
          eventSequence,
          requestData,
          round,
          route,
          runId,
          signal: abortController.signal,
          sessionContext,
          sessionId: input.sessionId,
          transport: 'SSE',
          turnFileDiffs,
          userId: input.userId,
          wl,
          ctx,
          workspaceCtx,
          writeChunk,
        });

        if (result.stopReason === 'error' || result.shouldStop) {
          if (result.stopReason !== 'error') {
            wl.flush(ctx, 200);
          }
          if (!shouldKeepPausedState) {
            setPersistedSessionStateStatus({
              sessionId: input.sessionId,
              status: 'idle',
              userId: input.userId,
            });
          }
          return { pendingInteraction: shouldKeepPausedState, statusCode: result.statusCode };
        }

        await executeToolCalls({
          clientRequestId: input.payload.clientRequestId,
          executionContext: createStreamExecutionContext(
            input.payload.clientRequestId,
            round + 1,
            requestData,
          ),
          enabledToolNames,
          eventSequence,
          runId,
          signal: abortController.signal,
          sessionContext,
          sessionId: input.sessionId,
          state: result.state,
          taskRuntimeGuardContext,
          turnFileDiffs,
          userId: input.userId,
          writeChunk,
        });
      }
    } finally {
      unsubscribeSessionEvents();
    }
  })().catch((err) => {
    if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(runId, eventSequence),
      });
      wl.flush(ctx, 200);
      setPersistedSessionStateStatus({
        sessionId: input.sessionId,
        status: 'idle',
        userId: input.userId,
      });
      return { pendingInteraction: false, statusCode: 200 };
    }

    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.userId,
    });
    throw err;
  });

  registerInFlightStreamRequest({
    abortController,
    clientRequestId: input.payload.clientRequestId,
    execution,
    sessionId: input.sessionId,
    userId: input.userId,
  });
  try {
    return await execution;
  } finally {
    clearInFlightStreamRequest({
      clientRequestId: input.payload.clientRequestId,
      execution,
      sessionId: input.sessionId,
    });
  }
}

export async function resumeAnsweredQuestionRequest(input: {
  payload: ApprovedPermissionResumePayload;
  answerOutput: string;
  sessionId: string;
  userId: string;
}): Promise<void> {
  let resumeResult: { pendingInteraction: boolean; statusCode: number };
  try {
    resumeResult = await continueFromApprovedToolResult({
      initialToolResult: {
        isError: false,
        output: input.answerOutput,
        toolCallId: input.payload.toolCallId,
        toolName: input.payload.toolName,
      },
      payload: input.payload,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  } catch (error) {
    await reconcileResumedTaskChildSession({
      childSessionId: input.sessionId,
      pendingInteraction: false,
      statusCode: 500,
      userId: input.userId,
    });
    throw error;
  }
  await reconcileResumedTaskChildSession({
    childSessionId: input.sessionId,
    pendingInteraction: resumeResult.pendingInteraction,
    statusCode: resumeResult.statusCode,
    userId: input.userId,
  });
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions/:id/stream/stop',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const body = stopStreamSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sessionId = (request.params as { id: string }).id;
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const stopped = await stopInFlightStreamRequest({
        clientRequestId: body.data.clientRequestId,
        sessionId,
        userId: user.sub,
      });
      if (stopped) {
        clearPendingTaskParentAutoResumesForSession({ sessionId, userId: user.sub });
      }
      return reply.status(200).send({ stopped });
    },
  );

  app.get(
    '/sessions/:id/stream',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const connectionLogger = new WorkflowLogger();
      const connectionContext = createRequestContext(
        'WS',
        `/sessions/${(request.params as { id: string }).id}/stream`,
        request.headers as Record<string, string | string[] | undefined>,
        request.ip,
      );
      const connectionStep = connectionLogger.start('stream.socket.connect');
      const authStep = connectionLogger.startChild(connectionStep, 'stream.socket.auth');
      const queryToken = (request.query as Record<string, string>)['token'];
      let user: JwtPayload | null = null;
      if (queryToken) {
        try {
          user = request.server.jwt.verify<JwtPayload>(queryToken);
        } catch {
          connectionLogger.fail(authStep, 'unauthorized');
          connectionLogger.fail(connectionStep, 'unauthorized');
          connectionLogger.flush(connectionContext, 401);
          socket.send(
            JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' }),
          );
          socket.close(1008);
          return;
        }
      } else {
        connectionLogger.fail(authStep, 'unauthorized');
        connectionLogger.fail(connectionStep, 'unauthorized');
        connectionLogger.flush(connectionContext, 401);
        socket.send(
          JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' }),
        );
        socket.close(1008);
        return;
      }
      connectionLogger.succeed(authStep);
      const { id: sessionId } = request.params as { id: string };

      const sessionStep = connectionLogger.startChild(
        connectionStep,
        'stream.socket.session-check',
        undefined,
        { sessionId },
      );
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        connectionLogger.fail(sessionStep, 'session not found');
        connectionLogger.fail(connectionStep, 'session not found');
        connectionLogger.flush(connectionContext, 404);
        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
          }),
        );
        socket.close(1008);
        return;
      }
      connectionLogger.succeed(sessionStep);
      connectionLogger.succeed(connectionStep, undefined, { sessionId });
      connectionLogger.flush(connectionContext, 101);

      socket.on('message', (raw: Buffer | string) => {
        void (async () => {
          const requestRunId = randomUUID();
          const wl = new WorkflowLogger();
          const ctx = createRequestContext(
            'WS',
            `/sessions/${sessionId}/stream`,
            request.headers as Record<string, string | string[] | undefined>,
            request.ip,
          );

          const text = raw.toString();
          let parsed: unknown;
          const stepRoute = wl.start('stream.message.handle', undefined, { sessionId });
          const stepParse = wl.startChild(stepRoute, 'stream.parse');
          try {
            parsed = JSON.parse(text);
          } catch {
            wl.fail(stepParse, 'invalid JSON');
            wl.fail(stepRoute, 'invalid JSON');
            wl.flush(ctx, 400);
            socket.send(
              JSON.stringify(createStreamErrorChunk('INVALID_JSON', 'Invalid JSON', requestRunId)),
            );
            return;
          }

          const body = streamRequestSchema.safeParse(parsed);
          if (!body.success) {
            wl.fail(stepParse, 'invalid request schema');
            wl.fail(stepRoute, 'invalid request schema');
            wl.flush(ctx, 400);
            socket.send(
              JSON.stringify({
                ...createStreamErrorChunk('INVALID_REQUEST', 'Invalid request', requestRunId),
                issues: body.error.issues,
              }),
            );
            return;
          }
          wl.succeed(stepParse);

          const stepSession = wl.startChild(stepRoute, 'stream.session-check', undefined, {
            sessionId,
          });

          const sessionContext = loadSessionContext(sessionId, user.sub);
          if (!sessionContext) {
            wl.fail(stepSession, 'session not found');
            wl.fail(stepRoute, 'session not found');
            wl.flush(ctx, 404);
            socket.send(
              JSON.stringify({
                type: 'error',
                code: 'SESSION_NOT_FOUND',
                message: 'Session not found',
              }),
            );
            return;
          }
          wl.succeed(stepSession);

          try {
            const streamResult = await handleStreamRequest({
              method: 'WS',
              path: `/sessions/${sessionId}/stream`,
              headers: request.headers as Record<string, string | string[] | undefined>,
              ip: request.ip,
              requestData: body.data,
              sessionContext,
              sessionId,
              transport: 'WS',
              user,
              writeChunk: (chunk) => {
                socket.send(JSON.stringify(chunk));
              },
            });
            if (streamResult.statusCode >= 400) {
              wl.fail(stepRoute, 'stream request completed with error status', {
                sessionId,
                clientRequestId: body.data.clientRequestId,
                statusCode: streamResult.statusCode,
              });
              wl.flush(ctx, streamResult.statusCode);
            } else {
              wl.succeed(stepRoute, undefined, {
                sessionId,
                clientRequestId: body.data.clientRequestId,
              });
              wl.flush(ctx, streamResult.statusCode);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            wl.fail(stepRoute, message, {
              sessionId,
              clientRequestId: body.data.clientRequestId,
            });
            wl.flush(ctx, 500);
          }
        })();
      });
    },
  );

  app.get('/sessions/:id/stream/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    const wl = new WorkflowLogger();
    const ctx = createRequestContext(
      request.method,
      request.url,
      request.headers as Record<string, string | string[] | undefined>,
      request.ip,
    );
    const routeStep = wl.start('stream.sse.connect');
    const authStep = wl.startChild(routeStep, 'stream.sse.auth');
    const rawQuery = request.query as Record<string, string>;
    const sseToken = rawQuery['token'];
    let user: JwtPayload;
    try {
      user = request.server.jwt.verify<JwtPayload>(sseToken ?? '');
    } catch {
      wl.fail(authStep, 'unauthorized');
      wl.fail(routeStep, 'unauthorized');
      wl.flush(ctx, 401);
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    wl.succeed(authStep);
    const { id: sessionId } = request.params as { id: string };
    const parseStep = wl.startChild(routeStep, 'stream.sse.parse-query', undefined, { sessionId });
    const query = streamRequestSchema.safeParse(request.query);

    if (!query.success) {
      wl.fail(parseStep, 'invalid query');
      wl.fail(routeStep, 'invalid query');
      wl.flush(ctx, 400);
      return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
    }
    wl.succeed(parseStep);

    const stepSession = wl.startChild(routeStep, 'stream.sse.session-check', undefined, {
      sessionId,
    });
    const sessionContext = loadSessionContext(sessionId, user.sub);
    if (!sessionContext) {
      wl.fail(stepSession, 'session not found');
      wl.fail(routeStep, 'session not found');
      wl.flush(ctx, 404);
      return reply.status(404).send({ error: 'Session not found' });
    }
    wl.succeed(stepSession);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try {
      const streamResult = await handleStreamRequest({
        method: request.method,
        path: request.url,
        headers: request.headers as Record<string, string | string[] | undefined>,
        ip: request.ip,
        requestData: query.data,
        sessionContext,
        sessionId,
        transport: 'SSE',
        user,
        writeChunk: (chunk) => {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      });
      if (streamResult.statusCode >= 400) {
        wl.fail(routeStep, 'stream request completed with error status', {
          sessionId,
          statusCode: streamResult.statusCode,
        });
        wl.flush(ctx, streamResult.statusCode);
      } else {
        wl.succeed(routeStep, undefined, { sessionId });
        wl.flush(ctx, streamResult.statusCode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      wl.fail(routeStep, message);
      wl.flush(ctx, 500);
      throw error;
    } finally {
      reply.raw.end();
    }
  });
}

function createStreamErrorChunk(code: string, message: string, runId: string) {
  return {
    type: 'error' as const,
    code,
    message,
    runId,
    eventId: `${runId}:error:${randomUUID()}`,
    occurredAt: Date.now(),
  };
}
