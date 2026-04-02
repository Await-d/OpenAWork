import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type {
  FileDiffContent,
  MessageContent,
  RunEvent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
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
  getSessionMessageByRequestId,
  listSessionMessagesByRequestScope,
} from '../session-message-store.js';
import { persistStreamUserMessage } from '../stream-session-title.js';
import { buildCapabilityContext } from './capabilities.js';
import { buildRequestScopedSystemPrompts } from './stream-system-prompts.js';
import {
  hasPersistedRunEvent,
  listSessionRunEventsByRequest,
  persistSessionRunEventForRequest,
  subscribeSessionRunEvents,
} from '../session-run-events.js';
import { deriveRunEventBookend } from '../run-event-envelope.js';
import {
  collectFileDiffsFromToolOutput,
  mergeFileDiffs,
  traceFileDiffs,
} from '../modified-files-summary.js';
import { persistSessionFileDiffs } from '../session-file-diff-store.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import type { SandboxExecutionContext } from '../tool-sandbox.js';
import { buildGatewayToolDefinitions } from './stream-protocol.js';
import { isEnabledToolName } from './tool-name-compat.js';
import { sanitizeSessionMetadataJson } from '../session-workspace-metadata.js';
import { extractToolSurfaceProfile } from '../session-workspace-metadata.js';
import { validateWorkspacePath } from '../workspace-paths.js';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';
import { resolveCanonicalName } from '../claude-code-tool-surface.js';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  getInFlightStreamRequest,
  registerInFlightStreamRequest,
} from './stream-cancellation.js';
import {
  isTaskParentAutoResumeClientRequestId,
  noteManualSessionInteraction,
} from '../task-parent-auto-resume.js';
import { runModelRound } from './stream-model-round.js';
import {
  clearSessionRuntimeThread,
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
  touchSessionRuntimeThread,
  upsertSessionRuntimeThread,
} from '../session-runtime-thread-store.js';
import { persistMonthlyUsageRecord } from '../usage-records-store.js';

type PersistedSessionStateStatus = 'idle' | 'running' | 'paused';

export function setPersistedSessionStateStatus(input: {
  sessionId: string;
  status: PersistedSessionStateStatus;
  userId: string;
}): void {
  sqliteRun(
    "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.status, input.sessionId, input.userId],
  );
}

export async function buildWorkspaceContext(metadataJson: string): Promise<string | null> {
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

export function isWebSearchEnabled(metadataJson: string): boolean {
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

export const streamRequestSchema = modelRequestSchema.extend({
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

export const stopStreamSchema = z.object({
  clientRequestId: z.string().min(1).max(128),
});

export type StreamRequest = z.infer<typeof streamRequestSchema>;

export interface ApprovedPermissionResumePayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
  observability?: ToolCallObservabilityAnnotation;
}

export function buildStreamToolObservability(input: {
  metadataJson: string;
  presentedToolName: string;
}): ToolCallObservabilityAnnotation {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(input.metadataJson) as Record<string, unknown>;
  } catch {
    metadata = {};
  }

  return {
    presentedToolName: input.presentedToolName,
    canonicalToolName: resolveCanonicalName(input.presentedToolName),
    toolSurfaceProfile: extractToolSurfaceProfile(metadata),
    adapterVersion: '1.0.0',
  };
}

export interface SessionStreamContext {
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
  toolCalls: Map<string, { toolName: string; inputText: string }>;
}

export interface TaskRuntimeGuardContext {
  lastToolSignature: string | null;
  maxConsecutiveRepeatedToolCalls: number;
  repeatedToolSignatureCount: number;
}

export function createTaskRuntimeGuardContext(
  metadataJson: string,
): TaskRuntimeGuardContext | null {
  void metadataJson;
  return null;
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

export function getEnabledTools(webSearchEnabled: boolean) {
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

export function createRunEventMeta(runId: string, sequence: { value: number }) {
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

function hasReplayableLatestBookend(events: RunEvent[]): boolean {
  const latestEvent = events.at(-1);
  if (!latestEvent) {
    return false;
  }

  return deriveRunEventBookend(latestEvent)?.replayable === true;
}

export function replayPersistedAssistantResponse(input: {
  clientRequestId: string;
  runId: string;
  sessionId: string;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
}): boolean {
  const durableEvents = listSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  if (durableEvents.length > 0 && hasReplayableLatestBookend(durableEvents)) {
    durableEvents.forEach((event) => {
      input.writeChunk(event);
    });
    return true;
  }

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
  scopedMessages.forEach((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') {
      return;
    }

    if (message.role === 'tool') {
      message.content.forEach((content) => {
        if (content.type !== 'tool_result') return;
        input.writeChunk(
          buildToolResultRunEvent({
            toolCallId: content.toolCallId,
            toolName: content.toolName ?? toolNames.get(content.toolCallId) ?? 'tool',
            clientRequestId: content.clientRequestId ?? input.clientRequestId,
            output: content.output,
            isError: content.isError,
            fileDiffs: content.fileDiffs,
            pendingPermissionRequestId: content.pendingPermissionRequestId,
            observability: content.observability,
            eventMeta: {
              eventId: `${input.runId}:replay:${sequence++}`,
              runId: input.runId,
              occurredAt: Date.now(),
            },
          }),
        );
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

export function loadSessionContext(sessionId: string, userId: string): SessionStreamContext | null {
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

export function loadSessionUser(sessionId: string, userId: string): JwtPayload | null {
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

export async function resolveStreamModelRoute(input: {
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

export function createToolResultRequestId(clientRequestId: string, toolCallId: string): string {
  return `${clientRequestId}:tool:${toolCallId}`;
}

export async function executeToolCalls(input: {
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

    const observability = buildStreamToolObservability({
      metadataJson: input.sessionContext.metadataJson,
      presentedToolName: toolCall.toolName,
    });

    const tracedFileDiffs = input.turnFileDiffs
      ? traceFileDiffs({
          clientRequestId: input.clientRequestId,
          diffs: collectFileDiffsFromToolOutput(result.output),
          observability,
          requestId: createToolResultRequestId(input.clientRequestId, toolCallId),
          toolCallId,
          toolName: toolCall.toolName,
        })
      : [];

    appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'tool',
      content: [
        buildToolResultContent({
          toolCallId,
          toolName: toolCall.toolName,
          clientRequestId: input.clientRequestId,
          output: result.output,
          isError: result.isError,
          fileDiffs: tracedFileDiffs,
          pendingPermissionRequestId: result.pendingPermissionRequestId,
          observability,
        }),
      ],
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId: createToolResultRequestId(input.clientRequestId, toolCallId),
    });

    if (input.turnFileDiffs) {
      mergeFileDiffs(input.turnFileDiffs, tracedFileDiffs);
      if (tracedFileDiffs.length > 0) {
        persistSessionFileDiffs({
          sessionId: input.sessionId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
          requestId: createToolResultRequestId(input.clientRequestId, toolCallId),
          toolName: toolCall.toolName,
          toolCallId,
          observability,
          diffs: tracedFileDiffs,
        });
      }
    }

    input.writeChunk(
      buildToolResultRunEvent({
        toolCallId,
        toolName: toolCall.toolName,
        clientRequestId: input.clientRequestId,
        output: result.output,
        isError: result.isError,
        fileDiffs: tracedFileDiffs,
        pendingPermissionRequestId: result.pendingPermissionRequestId,
        observability,
        eventMeta: createRunEventMeta(input.runId, input.eventSequence),
      }),
    );
  }
}

export function createStreamExecutionContext(
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

export { runModelRound } from './stream-model-round.js';

export async function handleStreamRequest(input: {
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
  const requestSystemPrompts = buildRequestScopedSystemPrompts(
    input.requestData.message,
    buildCapabilityContext(input.user.sub, input.sessionId),
  );
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
  const emitChunk = (chunk: RunEvent) => {
    persistSessionRunEventForRequest(input.sessionId, chunk, {
      clientRequestId: input.requestData.clientRequestId,
    });
    input.writeChunk(chunk);
  };
  const execution = (async () => {
    let shouldKeepPausedState = false;
    const runtimeThreadStartedAt = Date.now();
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'running',
      userId: input.user.sub,
    });
    upsertSessionRuntimeThread({
      clientRequestId: input.requestData.clientRequestId,
      heartbeatAtMs: runtimeThreadStartedAt,
      sessionId: input.sessionId,
      startedAtMs: runtimeThreadStartedAt,
      userId: input.user.sub,
    });
    const runtimeThreadHeartbeat = setInterval(() => {
      touchSessionRuntimeThread({
        clientRequestId: input.requestData.clientRequestId,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });
    }, SESSION_RUNTIME_THREAD_HEARTBEAT_MS);
    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      if (event.type === 'question_asked') {
        shouldKeepPausedState = true;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'paused',
          userId: input.user.sub,
        });
      }

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

      if (event.type === 'question_replied' && event.status === 'answered') {
        shouldKeepPausedState = false;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'running',
          userId: input.user.sub,
        });
      }

      if (hasPersistedRunEvent(event)) {
        input.writeChunk(event);
        return;
      }
      emitChunk(event);
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
          requestSystemPrompts,
          writeChunk: emitChunk,
        });

        if (result.usage) {
          persistMonthlyUsageRecord({
            occurredAt: result.usageOccurredAt,
            inputPricePerMillion: route.inputPricePerMillion,
            outputPricePerMillion: route.outputPricePerMillion,
            usage: result.usage,
            userId: input.user.sub,
          });
        }

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
          writeChunk: emitChunk,
        });
      }
    } finally {
      clearInterval(runtimeThreadHeartbeat);
      clearSessionRuntimeThread({
        clientRequestId: input.requestData.clientRequestId,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });
      unsubscribeSessionEvents();
    }
  })().catch((err) => {
    if (abortController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      emitChunk({
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
    emitChunk(createStreamErrorChunk('STREAM_ERROR', String(err), runId));
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

export function createStreamErrorChunk(code: string, message: string, runId: string) {
  return {
    type: 'error' as const,
    code,
    message,
    runId,
    eventId: `${runId}:error:${randomUUID()}`,
    occurredAt: Date.now(),
  };
}
