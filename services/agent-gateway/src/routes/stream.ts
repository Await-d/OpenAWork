import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type {
  DialogueMode,
  FileDiffContent,
  ManagedAgentRecord,
  MessageContent,
  RunEvent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { COMPACTION_SETTINGS_KEY, readCompactionSettings } from '../compaction-policy.js';
import { sqliteGet, sqliteRun } from '../db.js';
import { writeAuditLog } from '../audit-log.js';
import {
  modelRequestSchema,
  type ModelRouteConfig,
  resolveCompactionRoute,
  resolveModelRoute,
  resolveModelRouteFromProvider,
} from '../model-router.js';
import { getCompactionProviderConfig, getProviderConfigForSelection } from '../provider-config.js';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import {
  appendSessionMessage,
  getSessionMessageByRequestId,
  isContextOverflow,
  listSessionMessages,
  listSessionMessagesByRequestScope,
} from '../session-message-store.js';
import { executeSessionCompaction } from '../session-compaction.js';
import { persistStreamUserMessage } from '../stream-session-title.js';
import { buildCapabilityContext } from './capabilities.js';
import {
  CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  YOLO_MODE_SYSTEM_PROMPT,
} from './stream-system-prompts.js';
import { KeywordDetectorImpl } from '@openAwork/agent-core';
import {
  deleteSessionRunEventsByRequest,
  hasPersistedRunEvent,
  listSessionRunEventsByRequest,
  persistSessionRunEventForRequest,
  publishSessionRunEvent,
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
import { buildStreamUsageChunk } from './stream-usage-event.js';
import { isEnabledToolName } from './tool-name-compat.js';
import { sanitizeSessionMetadataJson } from '../session-workspace-metadata.js';
import { extractToolSurfaceProfile } from '../session-workspace-metadata.js';
import { parseSessionMetadataJson } from '../session-workspace-metadata.js';
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
import { resolveSessionInteractionStateUpdate } from '../session-runtime-state.js';
import { persistMonthlyUsageRecord } from '../usage-records-store.js';
import { listManagedAgentsForUser } from '../agent-catalog.js';
import { selectDelegatedModelForUser } from '../task-model-selection.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  readUpstreamRetrySettings,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
  UPSTREAM_RETRY_SETTINGS_KEY,
  upstreamRetryMaxRetriesSchema,
} from '../upstream-retry-policy.js';
import { autoExtractMemoriesForRequest, buildMemoryBlockForSession } from '../memory-runtime.js';
import { buildCompanionPrompt, loadCompanionSettingsForUser } from '../companion-settings.js';

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

const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);

export const streamRequestSchema = modelRequestSchema.omit({ model: true }).extend({
  agentId: z.string().trim().min(1).max(120).optional(),
  displayMessage: z.string().min(1).max(32768).optional(),
  dialogueMode: z.enum(['clarify', 'coding', 'programmer']).optional(),
  message: z.string().min(1).max(32768),
  model: z.string().min(1).max(200).optional(),
  providerId: z.string().min(1).max(200).optional(),
  clientRequestId: z.string().min(1).max(128),
  thinkingEnabled: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  webSearchEnabled: z
    .preprocess((value) => {
      if (typeof value === 'boolean') return value;
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }, z.boolean())
    .optional(),
  upstreamRetryMaxRetries: z
    .preprocess((value) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
      }

      return value;
    }, upstreamRetryMaxRetriesSchema)
    .optional(),
  yoloMode: z
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

export function resolveStreamRequestUpstreamRetry(input: {
  metadataJson: string;
  requestData: StreamRequest;
  userId: string;
}): StreamRequest {
  const requestRetry = input.requestData.upstreamRetryMaxRetries;
  if (requestRetry !== undefined) {
    return input.requestData;
  }

  const metadata = parseSessionMetadataJson(input.metadataJson);
  const metadataRetry = metadata[UPSTREAM_RETRY_MAX_RETRIES_KEY];
  if (typeof metadataRetry === 'number') {
    return {
      ...input.requestData,
      upstreamRetryMaxRetries: metadataRetry,
    };
  }

  const row = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [input.userId, UPSTREAM_RETRY_SETTINGS_KEY],
  );
  const settings = readUpstreamRetrySettings(parseStoredJson(row?.value));

  return {
    ...input.requestData,
    upstreamRetryMaxRetries: settings.maxRetries ?? DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  };
}

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
  delegatedSystemPrompt?: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
  systemPrompt?: string;
}

interface StreamInteractionModes {
  dialogueMode?: DialogueMode;
  yoloMode: boolean;
}

type StreamAgentDowngradeReason = 'agent_disabled' | 'agent_model_unavailable' | 'agent_not_found';

interface StreamAgentSelection {
  downgradeReason?: StreamAgentDowngradeReason;
  effectiveAgentId?: string;
  modelId?: string;
  providerId?: string;
  requestedAgentId?: string;
  systemPrompt?: string;
  variant?: string;
}

type ResolvedStreamModelRoute = ModelRouteConfig & StreamAgentSelection;

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

function buildMissingToolArgumentsMessage(toolName: string, workingDirectory?: string): string {
  const examplePath = workingDirectory ?? '/absolute/workspace/path';

  if (toolName === 'list') {
    return `Tool "list" was called without arguments. Retry with JSON like {"path":"${examplePath}","depth":2}.`;
  }

  if (toolName === 'bash') {
    return `Tool "bash" was called without arguments. Retry with JSON like {"command":"pwd","workdir":"${examplePath}"}.`;
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
    return false;
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

function clearRetryableFailedRequestArtifacts(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): void {
  const durableEvents = listSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  const latestEvent = durableEvents.at(-1);
  const latestBookend = latestEvent ? deriveRunEventBookend(latestEvent) : undefined;
  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });

  const shouldClearRunEvents = latestBookend?.kind === 'run_failed';
  const shouldAllowRetry = shouldClearRunEvents || stored?.status === 'error';
  if (!shouldAllowRetry) {
    return;
  }

  if (shouldClearRunEvents) {
    deleteSessionRunEventsByRequest({
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
    });
  }
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
      delegatedSystemPrompt:
        typeof parsed['delegatedSystemPrompt'] === 'string'
          ? parsed['delegatedSystemPrompt']
          : undefined,
      systemPrompt: typeof parsed['systemPrompt'] === 'string' ? parsed['systemPrompt'] : undefined,
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

function normalizeRequestedAgentId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeManagedAgentIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function findManagedStreamAgent(
  agents: ManagedAgentRecord[],
  requestedAgentId: string,
): ManagedAgentRecord | undefined {
  const normalizedRequestedAgentId = normalizeManagedAgentIdentifier(requestedAgentId);
  return agents.find((agent) => {
    if (normalizeManagedAgentIdentifier(agent.id) === normalizedRequestedAgentId) {
      return true;
    }

    if (normalizeManagedAgentIdentifier(agent.label) === normalizedRequestedAgentId) {
      return true;
    }

    return agent.aliases.some(
      (alias) => normalizeManagedAgentIdentifier(alias) === normalizedRequestedAgentId,
    );
  });
}

function normalizeAgentModelCandidate(modelId: string): string {
  const normalized = modelId.trim();
  return normalized.includes('/') ? (normalized.split('/').at(-1) ?? normalized) : normalized;
}

function getManagedAgentModelCandidates(agent: ManagedAgentRecord): string[] {
  return Array.from(
    new Set(
      [agent.model, ...(agent.fallbackModels ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => normalizeAgentModelCandidate(value)),
    ),
  );
}

function resolveStreamAgentSelection(input: {
  requestedAgentId: string | undefined;
  userId: string;
}): StreamAgentSelection {
  const requestedAgentId = normalizeRequestedAgentId(input.requestedAgentId);
  if (!requestedAgentId) {
    return {};
  }

  const agents = listManagedAgentsForUser(input.userId);
  const matchedAgent = findManagedStreamAgent(agents, requestedAgentId);
  if (!matchedAgent) {
    return {
      downgradeReason: 'agent_not_found',
      requestedAgentId,
    };
  }

  if (!matchedAgent.enabled) {
    return {
      downgradeReason: 'agent_disabled',
      requestedAgentId,
    };
  }

  const modelCandidates = getManagedAgentModelCandidates(matchedAgent);
  const delegatedModel =
    modelCandidates.length > 0
      ? selectDelegatedModelForUser(input.userId, modelCandidates)
      : undefined;

  return {
    ...(modelCandidates.length > 0 && !delegatedModel?.providerId
      ? { downgradeReason: 'agent_model_unavailable' as const }
      : {}),
    effectiveAgentId: matchedAgent.id,
    modelId: delegatedModel?.modelId,
    providerId: delegatedModel?.providerId,
    requestedAgentId,
    systemPrompt: matchedAgent.systemPrompt,
    variant: delegatedModel?.variant ?? matchedAgent.variant,
  };
}

function normalizeRequestedModelId(modelId: string | undefined): string | undefined {
  if (!modelId || modelId === 'default') {
    return undefined;
  }

  return modelId;
}

function isDialogueMode(value: unknown): value is DialogueMode {
  return value === 'clarify' || value === 'coding' || value === 'programmer';
}

function resolveStreamInteractionModes(input: {
  metadataJson: string;
  requestData: StreamRequest;
}): StreamInteractionModes {
  const metadata = parseSessionMetadataJson(input.metadataJson);
  const metadataDialogueMode = isDialogueMode(metadata['dialogueMode'])
    ? metadata['dialogueMode']
    : undefined;

  return {
    dialogueMode: input.requestData.dialogueMode ?? metadataDialogueMode,
    yoloMode: input.requestData.yoloMode ?? metadata['yoloMode'] === true,
  };
}

export async function resolveStreamModelRoute(input: {
  metadataJson: string;
  requestData: StreamRequest;
  userId: string;
}): Promise<ResolvedStreamModelRoute> {
  const providerRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [input.userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [input.userId],
  );
  const sessionSelection = parseSessionProviderSelection(input.metadataJson);
  const agentSelection = resolveStreamAgentSelection({
    requestedAgentId: input.requestData.agentId,
    userId: input.userId,
  });
  const requestedModelId = normalizeRequestedModelId(input.requestData.model);
  const resolvedRequestData: StreamRequest = {
    ...input.requestData,
    model:
      requestedModelId ??
      agentSelection.modelId ??
      sessionSelection.modelId ??
      input.requestData.model,
    providerId:
      input.requestData.providerId ?? agentSelection.providerId ?? sessionSelection.providerId,
    variant: input.requestData.variant ?? agentSelection.variant ?? sessionSelection.variant,
    systemPrompt:
      sessionSelection.delegatedSystemPrompt ??
      input.requestData.systemPrompt ??
      agentSelection.systemPrompt ??
      sessionSelection.systemPrompt,
  };
  const providerConfig = await getProviderConfigForSelection(
    parseStoredJson(providerRow?.value),
    parseStoredJson(selectionRow?.value),
    {
      providerId: resolvedRequestData.providerId,
      modelId: resolvedRequestData.model,
    },
  );

  if (providerConfig) {
    return {
      ...agentSelection,
      ...resolveModelRouteFromProvider(
        providerConfig.provider,
        providerConfig.modelId,
        resolvedRequestData,
      ),
    };
  }

  return {
    ...agentSelection,
    ...resolveModelRoute({
      ...resolvedRequestData,
      model: resolvedRequestData.model ?? 'default',
    }),
  };
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
}): Promise<{ hasPendingPermission: boolean }> {
  const sandbox = createDefaultSandbox();
  const sessionMetadata = parseSessionMetadataJson(input.sessionContext.metadataJson);
  const workingDirectory =
    typeof sessionMetadata['workingDirectory'] === 'string'
      ? sessionMetadata['workingDirectory']
      : undefined;
  let hasPendingPermission = false;

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
          output: buildMissingToolArgumentsMessage(toolCall.toolName, workingDirectory),
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

    if (result.pendingPermissionRequestId) {
      console.log(
        '[PERMISSION_PAUSE] pending permission detected for tool',
        toolCall.toolName,
        'requestId=',
        result.pendingPermissionRequestId,
        'breaking tool call loop',
      );
      hasPendingPermission = true;
      break;
    }
  }

  return { hasPendingPermission };
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
  const requestData = resolveStreamRequestUpstreamRetry({
    metadataJson: input.sessionContext.metadataJson,
    requestData: input.requestData,
    userId: input.user.sub,
  });
  const runId = randomUUID();
  const wl = new WorkflowLogger();
  const ctx = createRequestContext(input.method, input.path, input.headers, input.ip);
  if (!isTaskParentAutoResumeClientRequestId(requestData.clientRequestId)) {
    noteManualSessionInteraction({ sessionId: input.sessionId, userId: input.user.sub });
  }
  const stepRoute = wl.start('stream.model-resolve');
  let route: ResolvedStreamModelRoute;
  try {
    route = await resolveStreamModelRoute({
      metadataJson: input.sessionContext.metadataJson,
      requestData,
      userId: input.user.sub,
    });
    wl.succeed(stepRoute, undefined, {
      downgradeReason: route.downgradeReason ?? 'none',
      effectiveAgentId: route.effectiveAgentId ?? 'none',
      model: route.model,
      requestedAgentId: route.requestedAgentId ?? 'none',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    wl.fail(stepRoute, message);
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'MODEL_RESOLVE',
      requestId: requestData.clientRequestId,
      input: { agentId: requestData.agentId },
      output: { message, code: 'MODEL_RESOLVE' },
    });
    wl.flush(ctx, 500);
    throw error;
  }

  const workspaceCtx = await buildWorkspaceContext(input.sessionContext.metadataJson);
  const interactionModes = resolveStreamInteractionModes({
    metadataJson: input.sessionContext.metadataJson,
    requestData,
  });
  const companionPrompt = buildCompanionPrompt(
    loadCompanionSettingsForUser(input.user.sub, input.user.email, requestData.agentId),
    requestData.message,
  );
  const capabilityContext = buildCapabilityContext(input.user.sub, input.sessionId);
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(requestData.message);
  const injectedPrompt = detection.injectedPrompt ?? null;
  const lspGuidance =
    interactionModes.dialogueMode === 'clarify'
      ? CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
      : LSP_TOOL_GUIDANCE_SYSTEM_PROMPT;
  const dialogueModePrompt =
    interactionModes.dialogueMode !== undefined
      ? DIALOGUE_MODE_SYSTEM_PROMPTS[interactionModes.dialogueMode]
      : null;
  const yoloModePrompt = interactionModes.yoloMode === true ? YOLO_MODE_SYSTEM_PROMPT : null;
  const webSearchEnabled =
    requestData.webSearchEnabled ?? isWebSearchEnabled(input.sessionContext.metadataJson);

  clearRetryableFailedRequestArtifacts({
    clientRequestId: requestData.clientRequestId,
    sessionId: input.sessionId,
    userId: input.user.sub,
  });

  if (
    replayPersistedAssistantResponse({
      clientRequestId: requestData.clientRequestId,
      runId,
      sessionId: input.sessionId,
      userId: input.user.sub,
      writeChunk: input.writeChunk,
    })
  ) {
    wl.flush(ctx, 200);
    return { statusCode: 200 };
  }

  const inFlight = getInFlightStreamRequest(input.sessionId, requestData.clientRequestId);
  if (inFlight) {
    await inFlight.execution.catch(() => undefined);
    if (
      replayPersistedAssistantResponse({
        clientRequestId: requestData.clientRequestId,
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
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'REPLAY_FAILED',
      requestId: requestData.clientRequestId,
      output: { message: 'Request replay failed', code: 'REQUEST_REPLAY_FAILED' },
    });
    input.writeChunk(
      createStreamErrorChunk('REQUEST_REPLAY_FAILED', 'Request replay failed', runId),
    );
    return { statusCode: 409 };
  }

  if (
    getAnyInFlightStreamRequestForSession({
      excludeClientRequestId: requestData.clientRequestId,
      sessionId: input.sessionId,
      userId: input.user.sub,
    })
  ) {
    wl.flush(ctx, 409);
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'route',
      sourceName: 'SESSION_CONFLICT',
      requestId: requestData.clientRequestId,
      output: {
        message: 'Another request is already running for this session.',
        code: 'SESSION_ALREADY_RUNNING',
      },
    });
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
      clientRequestId: requestData.clientRequestId,
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
      clientRequestId: requestData.clientRequestId,
      heartbeatAtMs: runtimeThreadStartedAt,
      sessionId: input.sessionId,
      startedAtMs: runtimeThreadStartedAt,
      userId: input.user.sub,
    });
    const runtimeThreadHeartbeat = setInterval(() => {
      touchSessionRuntimeThread({
        clientRequestId: requestData.clientRequestId,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });
    }, SESSION_RUNTIME_THREAD_HEARTBEAT_MS);
    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      if (
        event.type === 'question_asked' ||
        event.type === 'permission_asked' ||
        event.type === 'permission_replied' ||
        event.type === 'question_replied'
      ) {
        const stateUpdate = resolveSessionInteractionStateUpdate(event);
        shouldKeepPausedState = stateUpdate.shouldKeepPausedState;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: stateUpdate.status,
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
        clientRequestId: requestData.clientRequestId,
        displayMessage: requestData.displayMessage,
        legacyMessagesJson: input.sessionContext.legacyMessagesJson,
        message: requestData.message,
        sessionId: input.sessionId,
        userId: input.user.sub,
      });

      const enabledTools = filterEnabledGatewayToolsForSession(
        getEnabledTools(webSearchEnabled),
        input.sessionContext.metadataJson,
      );
      const enabledToolNames = new Set(enabledTools.map((tool) => tool.function.name));
      const turnFileDiffs = new Map<string, FileDiffContent>();
      const memoryBlock = buildMemoryBlockForSession(
        input.user.sub,
        input.sessionContext.metadataJson,
      );
      const compactionSettingsRow = sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
        [input.user.sub, COMPACTION_SETTINGS_KEY],
      );
      const compactionSettings = readCompactionSettings(
        parseStoredJson(compactionSettingsRow?.value),
      );
      let syntheticContinuationPrompt: string | undefined;

      for (let round = 1; ; round += 1) {
        const result = await runModelRound({
          clientRequestId: requestData.clientRequestId,
          enabledTools,
          eventSequence,
          requestData,
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
          compactionAutoEnabled: compactionSettings.auto,
          compactionReservedTokens: compactionSettings.reserved,
          workspaceCtx,
          injectedPrompt,
          capabilityContext,
          lspGuidance,
          dialogueModePrompt,
          yoloModePrompt,
          companionPrompt,
          syntheticContinuationPrompt,
          memoryBlock,
          writeChunk: emitChunk,
        });
        syntheticContinuationPrompt = undefined;

        if (result.usage) {
          emitChunk(
            buildStreamUsageChunk({
              eventSequence,
              round,
              runId,
              usage: result.usage,
            }),
          );
          persistMonthlyUsageRecord({
            occurredAt: result.usageOccurredAt,
            inputPricePerMillion: route.inputPricePerMillion,
            outputPricePerMillion: route.outputPricePerMillion,
            usage: result.usage,
            userId: input.user.sub,
          });
        }

        let recoveredFromOverflowError = false;
        const shouldAutoCompact =
          compactionSettings.auto &&
          result.overflow === true &&
          ((result.usage &&
            typeof route.contextWindow === 'number' &&
            isContextOverflow(result.usage, route.contextWindow, compactionSettings.reserved)) ||
            (!result.usage && result.stopReason === 'error'));

        if (shouldAutoCompact) {
          try {
            const providerRow = sqliteGet<{ value: string }>(
              `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
              [input.user.sub],
            );
            const selectionRow = sqliteGet<{ value: string }>(
              `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
              [input.user.sub],
            );
            const compactionProviderConfig = await getCompactionProviderConfig(
              parseStoredJson(providerRow?.value),
              parseStoredJson(selectionRow?.value),
            );
            const compactionRoute = compactionProviderConfig
              ? resolveCompactionRoute(
                  compactionProviderConfig.provider,
                  compactionProviderConfig.modelId,
                )
              : route;

            const allMessages = listSessionMessages({
              sessionId: input.sessionId,
              userId: input.user.sub,
              legacyMessagesJson: input.sessionContext.legacyMessagesJson,
              statuses: ['final'],
            });
            const latestFinalMessage = allMessages.at(-1);
            const replayMessage =
              !result.usage && result.stopReason === 'error' && latestFinalMessage?.role === 'user'
                ? latestFinalMessage
                : null;
            const cause = result.usage ? 'usage_overflow' : 'provider_overflow';
            const strategy = replayMessage
              ? ('replay' as const)
              : !result.usage && result.stopReason === 'error'
                ? ('synthetic_continue' as const)
                : ('summary_only' as const);
            const messagesForCompaction = replayMessage ? allMessages.slice(0, -1) : allMessages;
            if (messagesForCompaction.length === 0) {
              throw new Error('no earlier history available for overflow compaction recovery');
            }
            const startedAt = Date.now();
            publishSessionRunEvent(
              input.sessionId,
              {
                type: 'compaction',
                summary: '正在压缩会话上下文。',
                trigger: 'automatic',
                phase: 'started',
                cause,
                strategy,
                eventId: `${requestData.clientRequestId}:auto-compact:${round}:started`,
                runId,
                occurredAt: startedAt,
              },
              { clientRequestId: requestData.clientRequestId },
            );
            const compactionResult = await executeSessionCompaction({
              legacyMessagesJson: input.sessionContext.legacyMessagesJson,
              metadataJson: input.sessionContext.metadataJson,
              messages: messagesForCompaction,
              prune: compactionSettings.prune,
              route: compactionRoute,
              sessionId: input.sessionId,
              signal: abortController.signal,
              trigger: 'automatic',
              userId: input.user.sub,
            });
            input.sessionContext.metadataJson = compactionResult.metadataJson;

            const signature = compactionResult.durableSummary?.signature ?? String(Date.now());
            const compactedCount =
              compactionResult.durableSummary?.newlySummarizedMessages ??
              messagesForCompaction.length;
            const representedCount =
              compactionResult.durableSummary?.totalRepresentedMessages ??
              messagesForCompaction.length;
            if (compactionResult.llmErrorMessage) {
              publishSessionRunEvent(
                input.sessionId,
                {
                  type: 'compaction',
                  summary: `压缩 LLM 失败，已回退到结构化摘要：${compactionResult.llmErrorMessage}`,
                  trigger: 'automatic',
                  phase: 'failed',
                  cause,
                  strategy: 'summary_only',
                  eventId: `${requestData.clientRequestId}:auto-compact:${round}:${signature}:llm-failed`,
                  runId,
                  occurredAt: Date.now(),
                },
                { clientRequestId: requestData.clientRequestId },
              );
            }
            publishSessionRunEvent(
              input.sessionId,
              {
                type: 'compaction',
                summary: replayMessage
                  ? `已在上下文溢出后压缩 ${compactedCount} 条较早消息，并保留当前用户请求继续执行。`
                  : `已在上下文溢出后压缩 ${compactedCount} 条较早消息，并注入继续执行提示。`,
                trigger: 'automatic',
                phase: 'completed',
                cause,
                strategy,
                compactedMessages: compactedCount,
                representedMessages: representedCount,
                eventId: `${requestData.clientRequestId}:auto-compact:${round}:${signature}:completed`,
                runId,
                occurredAt: Date.now(),
              },
              { clientRequestId: requestData.clientRequestId },
            );
            recoveredFromOverflowError = replayMessage !== null;
            if (!replayMessage) {
              syntheticContinuationPrompt =
                'The conversation was compacted after a context overflow. Continue if you have clear next steps, or ask for clarification if additional user input is required.';
            }
          } catch (error: unknown) {
            publishSessionRunEvent(
              input.sessionId,
              {
                type: 'compaction',
                summary:
                  error instanceof Error ? error.message : '自动压缩失败，保留当前上下文状态。',
                trigger: 'automatic',
                phase: 'failed',
                cause: result.usage ? 'usage_overflow' : 'provider_overflow',
                strategy: 'summary_only',
                eventId: `${requestData.clientRequestId}:auto-compact:${round}:failed`,
                runId,
                occurredAt: Date.now(),
              },
              { clientRequestId: requestData.clientRequestId },
            );
            console.warn('automatic llm compaction failed', error);
          }
        }

        if (
          result.stopReason === 'error' &&
          result.overflow === true &&
          recoveredFromOverflowError
        ) {
          continue;
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
          try {
            autoExtractMemoriesForRequest({
              userId: input.user.sub,
              sessionId: input.sessionId,
              clientRequestId: requestData.clientRequestId,
              metadataJson: input.sessionContext.metadataJson,
            });
          } catch (error: unknown) {
            console.warn('memory auto extraction failed after stream completion', error);
          }
          return { statusCode: result.statusCode };
        }

        const toolCallsResult = await executeToolCalls({
          clientRequestId: requestData.clientRequestId,
          executionContext: createStreamExecutionContext(
            requestData.clientRequestId,
            round + 1,
            requestData,
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

        if (toolCallsResult.hasPendingPermission) {
          console.log(
            '[PERMISSION_PAUSE] emitting done with tool_permission, sessionId=',
            input.sessionId,
            'runId=',
            runId,
          );
          emitChunk({
            type: 'done',
            stopReason: 'tool_permission',
            ...createRunEventMeta(runId, eventSequence),
          });
          setPersistedSessionStateStatus({
            sessionId: input.sessionId,
            status: 'paused',
            userId: input.user.sub,
          });
          wl.flush(ctx, 200);
          return { statusCode: 200 };
        }
      }
    } finally {
      clearInterval(runtimeThreadHeartbeat);
      clearSessionRuntimeThread({
        clientRequestId: requestData.clientRequestId,
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
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'STREAM_ERROR',
      requestId: requestData.clientRequestId,
      output: { message: String(err), code: 'STREAM_ERROR' },
    });
    appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.user.sub,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', String(err)),
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId: requestData.clientRequestId,
      status: 'error',
    });
    emitChunk(createStreamErrorChunk('STREAM_ERROR', String(err), runId));
    wl.flush(ctx, 500);
    throw err;
  });

  registerInFlightStreamRequest({
    abortController,
    clientRequestId: requestData.clientRequestId,
    execution,
    sessionId: input.sessionId,
    userId: input.user.sub,
  });
  try {
    return await execution;
  } finally {
    clearInFlightStreamRequest({
      clientRequestId: requestData.clientRequestId,
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
