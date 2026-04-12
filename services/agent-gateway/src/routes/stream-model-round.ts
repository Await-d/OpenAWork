import type { FileDiffContent, MessageContent, RunEvent, StreamChunk } from '@openAwork/shared';
import type { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import {
  readLastCompactionLlmSummary,
  readPersistedCompactionMemory,
} from '../compaction-metadata.js';
import {
  appendSessionMessage,
  buildPreparedUpstreamConversation,
  hasCompactionMarker,
  isContextOverflow,
  listSessionMessages,
  type PreparedUpstreamConversationReport,
  updateSessionMessagesStatusByRequestScope,
} from '../session-message-store.js';
import { buildModifiedFilesSummaryContent } from '../modified-files-summary.js';
import { persistSessionSnapshot, createRequestSnapshotRef } from '../session-snapshot-store.js';
import { appendSnapshotPart, appendPatchPart } from '../message-v2-adapter.js';
import type { MessageID } from '../message-v2-schema.js';
import { upsertArtifactsFromAssistantMessage } from '../assistant-content-artifacts.js';
import { resolveEofRoundDecision } from './stream-completion.js';
import { isUpstreamContextOverflowError, readUpstreamError } from './upstream-error.js';
import { buildUpstreamRequestBody } from './upstream-request.js';
import {
  createStreamParseState,
  parseUpstreamFrame,
  ResponsesUpstreamEventError,
  type StreamUsageSummary,
} from './stream-protocol.js';
import { buildRoundSystemMessages } from './stream-system-prompts.js';
import type { resolveModelRoute } from '../model-router.js';
import type { SessionStreamContext } from './stream.js';
import { createRunEventMeta, createStreamErrorChunk } from './stream.js';
import type { getEnabledTools } from './stream.js';
import { fetchUpstreamStreamWithRetry } from './upstream-stream-retry.js';
import { writeAuditLog } from '../audit-log.js';

type WorkflowStepHandle = ReturnType<WorkflowLogger['start']>;
type StreamStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'error'
  | 'cancelled'
  | 'tool_permission';

interface StreamAccumulationState {
  assistantThinking: string;
  assistantText: string;
  toolCalls: Map<string, { toolName: string; inputText: string }>;
}

function createAccumulationState(): StreamAccumulationState {
  return {
    assistantThinking: '',
    assistantText: '',
    toolCalls: new Map(),
  };
}

function buildUpstreamTransformationReport(input: {
  compactionSummary?: string | null;
  memoryBlock?: string | null;
  outboundBody: Record<string, unknown>;
  outboundMessageCount: number;
  preparedReport?: PreparedUpstreamConversationReport;
  injectedPrompt?: string | null;
  capabilityContext?: string | null;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  companionPrompt?: string | null;
  requestOverrides: { body?: Record<string, unknown>; omitBodyKeys?: string[] };
  routeSystemPrompt?: string;
  syntheticContinuationPrompt?: string;
  thinkingApplied: boolean;
  toolOutputReadbackGuidanceInjected: boolean;
  upstreamProtocol: string;
  workspaceCtx: string | null;
}): Record<string, unknown> {
  return {
    prepared: input.preparedReport ?? null,
    protocol: input.upstreamProtocol,
    workspaceContextInjected: true,
    routeSystemPromptInjected: true,
    injectedPromptActive: !!input.injectedPrompt,
    capabilityContextActive: !!input.capabilityContext,
    lspGuidanceActive: !!input.lspGuidance,
    dialogueModeActive: !!input.dialogueModePrompt,
    yoloModeActive: !!input.yoloModePrompt,
    companionPromptActive: !!input.companionPrompt,
    memoryBlockInjected: true,
    compactionSummaryInjected: !!input.compactionSummary,
    toolOutputReadbackGuidanceInjected: true,
    syntheticContinuationInjected: !!input.syntheticContinuationPrompt,
    outboundMessageCount: input.outboundMessageCount,
    requestOverrideBodyKeys: Object.keys(input.requestOverrides.body ?? {}),
    omittedBodyKeys: input.requestOverrides.omitBodyKeys ?? [],
    thinkingConfigApplied: input.thinkingApplied,
    requestBodyKeys: Object.keys(input.outboundBody),
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
    const inputText = toolCall.inputText.trim();
    content.push({
      type: 'tool_call',
      toolCallId,
      toolName: toolCall.toolName,
      input: parseToolInput(inputText),
      ...(inputText.length > 0 ? { rawArguments: inputText } : {}),
    });
  });

  const summary = turnFileDiffs ? buildModifiedFilesSummaryContent(turnFileDiffs) : null;
  if (summary) {
    content.push(summary);
  }

  return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

function buildErrorContent(code: string, message: string): MessageContent[] {
  return [{ type: 'text', text: `[错误: ${code}] ${message}`.trim() }];
}

function isToolUseStopReason(reason: StreamStopReason): boolean {
  return reason === 'tool_use';
}

import type { StreamRequest } from './stream.js';

function createIntermediateAssistantRequestId(clientRequestId: string, round: number): string {
  return `${clientRequestId}:assistant:${round}`;
}

export async function runModelRound(input: {
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
  compactionAutoEnabled?: boolean;
  compactionReservedTokens?: number;
  workspaceCtx: string | null;
  injectedPrompt?: string | null;
  capabilityContext?: string | null;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  companionPrompt?: string | null;
  syntheticContinuationPrompt?: string;
  memoryBlock?: string | null;
  writeChunk: (chunk: RunEvent) => void;
}): Promise<{
  overflow: boolean;
  shouldContinue: boolean;
  shouldStop: boolean;
  stopReason: StreamStopReason;
  statusCode: number;
  state: StreamAccumulationState;
  usage?: StreamUsageSummary;
  usageOccurredAt?: number;
}> {
  const compactionAutoEnabled = input.compactionAutoEnabled ?? true;
  const finalMessages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.sessionContext.legacyMessagesJson,
    statuses: ['final'],
  });
  const markerPresent = hasCompactionMarker(finalMessages);
  const preparedConversation = buildPreparedUpstreamConversation(finalMessages, {
    contextWindow: input.route.contextWindow,
    ...(markerPresent
      ? {}
      : {
          llmCompactionSummary: readLastCompactionLlmSummary(input.sessionContext.metadataJson),
          persistedMemory: readPersistedCompactionMemory(input.sessionContext.metadataJson),
        }),
  });
  const conversation = preparedConversation.messages;
  const upstreamMessages = [
    ...buildRoundSystemMessages({
      workspaceCtx: input.workspaceCtx,
      routeSystemPrompt: input.route.systemPrompt,
      injectedPrompt: input.injectedPrompt,
      capabilityContext: input.capabilityContext,
      lspGuidance: input.lspGuidance,
      dialogueModePrompt: input.dialogueModePrompt,
      yoloModePrompt: input.yoloModePrompt,
      companionPrompt: input.companionPrompt,
      memoryBlock: input.memoryBlock,
      compactionSummary: preparedConversation.compactionSummary,
    }),
    ...conversation,
    ...(input.syntheticContinuationPrompt
      ? [{ role: 'user' as const, content: input.syntheticContinuationPrompt }]
      : []),
  ];
  const upstreamPath =
    input.route.upstreamProtocol === 'responses' ? '/responses' : '/chat/completions';
  const shouldApplyThinkingConfig =
    input.requestData.thinkingEnabled !== undefined ||
    input.requestData.reasoningEffort !== undefined;
  const upstreamBody = buildUpstreamRequestBody({
    protocol: input.route.upstreamProtocol,
    model: input.route.model,
    variant: input.route.variant,
    maxTokens: input.route.maxTokens,
    temperature: input.route.temperature,
    messages: upstreamMessages,
    tools: input.enabledTools,
    requestOverrides: input.route.requestOverrides,
    thinking: shouldApplyThinkingConfig
      ? {
          enabled: input.requestData.thinkingEnabled === true,
          effort: input.requestData.reasoningEffort ?? 'medium',
          providerType: input.route.providerType,
          supportsThinking: input.route.supportsThinking,
        }
      : undefined,
  });
  const transformationReport = buildUpstreamTransformationReport({
    compactionSummary: preparedConversation.compactionSummary,
    memoryBlock: input.memoryBlock,
    outboundBody: upstreamBody,
    outboundMessageCount: upstreamMessages.length,
    preparedReport: preparedConversation.report,
    injectedPrompt: input.injectedPrompt,
    capabilityContext: input.capabilityContext,
    lspGuidance: input.lspGuidance,
    dialogueModePrompt: input.dialogueModePrompt,
    yoloModePrompt: input.yoloModePrompt,
    companionPrompt: input.companionPrompt,
    requestOverrides: input.route.requestOverrides,
    routeSystemPrompt: input.route.systemPrompt,
    syntheticContinuationPrompt: input.syntheticContinuationPrompt,
    thinkingApplied: shouldApplyThinkingConfig,
    toolOutputReadbackGuidanceInjected: true,
    upstreamProtocol: input.route.upstreamProtocol,
    workspaceCtx: input.workspaceCtx,
  });
  writeAuditLog({
    sessionId: input.sessionId,
    category: 'llm',
    sourceName: 'UPSTREAM_TRANSFORM',
    requestId: input.clientRequestId,
    input: {
      model: input.route.model,
      round: input.round,
      transformationReport,
    },
    output: {
      message: 'upstream transformation report',
      protocol: input.route.upstreamProtocol,
      requestBodyKeys: Object.keys(upstreamBody),
    },
    isError: false,
  });

  const stepUpstream = input.wl.start(`upstream.fetch.${input.round}`, undefined, {
    maxRetries: input.requestData.upstreamRetryMaxRetries ?? 3,
    model: input.route.model,
    upstreamProtocol: input.route.upstreamProtocol,
    round: input.round,
    stream: true,
  });
  const state = createAccumulationState();
  let stepStream: WorkflowStepHandle | undefined;
  const finalizeAssistant = (reason: StreamStopReason) => {
    if (
      reason === 'cancelled' &&
      state.assistantThinking.trim().length === 0 &&
      state.assistantText.trim().length === 0 &&
      state.toolCalls.size === 0
    ) {
      return;
    }
    const assistantContent = buildAssistantContent(
      state,
      reason === 'tool_use' ? undefined : input.turnFileDiffs,
    );

    const assistantMessage = appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: assistantContent,
      legacyMessagesJson: input.sessionContext.legacyMessagesJson,
      clientRequestId:
        reason === 'tool_use'
          ? createIntermediateAssistantRequestId(input.clientRequestId, input.round)
          : input.clientRequestId,
    });
    if (reason === 'end_turn') {
      upsertArtifactsFromAssistantMessage({
        clientRequestId: input.clientRequestId,
        content: assistantContent,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    }
    if (reason !== 'tool_use' && input.turnFileDiffs && input.turnFileDiffs.size > 0) {
      persistSessionSnapshot({
        sessionId: input.sessionId,
        userId: input.userId,
        snapshotRef: createRequestSnapshotRef(input.clientRequestId),
        fileDiffs: Array.from(input.turnFileDiffs.values()),
      });

      // V2 step-level snapshot/patch (opencode pattern)
      // Each round = one step; create SnapshotPart + PatchPart in V2 message store
      const snapshotRef = createRequestSnapshotRef(input.clientRequestId);
      const diffFiles = Array.from(input.turnFileDiffs.values());
      if (assistantMessage.id) {
        appendSnapshotPart({
          sessionId: input.sessionId,
          messageId: assistantMessage.id as MessageID,
          snapshotRef,
        });
        appendPatchPart({
          sessionId: input.sessionId,
          messageId: assistantMessage.id as MessageID,
          hash: snapshotRef,
          files: diffFiles.map((d) => d.file),
        });
      }
    }
  };
  const markFailedRequestScopeMessages = () => {
    updateSessionMessagesStatusByRequestScope({
      clientRequestId: input.clientRequestId,
      roles: ['assistant', 'tool'],
      sessionId: input.sessionId,
      status: 'error',
      userId: input.userId,
    });
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(input.route.apiKey ? { Authorization: `Bearer ${input.route.apiKey}` } : {}),
      ...(input.route.requestOverrides.headers ?? {}),
    };

    const response = await fetchUpstreamStreamWithRetry({
      url: `${input.route.apiBaseUrl}${upstreamPath}`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamBody),
      },
      signal: input.signal,
      requireResponseBody: true,
      retryOptions: {
        maxAttempts: (input.requestData.upstreamRetryMaxRetries ?? 3) + 1,
      },
    });

    if (!response.ok || !response.body) {
      const upstreamError = await readUpstreamError(response);
      input.wl.fail(stepUpstream, undefined, { status: response.status });
      const contextOverflow = isUpstreamContextOverflowError({
        response,
        error: upstreamError,
      });
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'llm',
        sourceName: upstreamError.code,
        requestId: input.clientRequestId,
        input: {
          model: input.route.model,
          provider: input.route.apiBaseUrl,
          round: input.round,
        },
        output: {
          message: upstreamError.message,
          status: response.status,
          code: upstreamError.code,
        },
      });
      if (contextOverflow && compactionAutoEnabled) {
        return {
          overflow: true,
          shouldContinue: false,
          shouldStop: false,
          stopReason: 'error',
          statusCode: response.status,
          state,
          usage: undefined,
          usageOccurredAt: undefined,
        };
      }
      markFailedRequestScopeMessages();
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
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: response.status,
        state,
        usage: undefined,
        usageOccurredAt: undefined,
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
      const usage = streamState.usage;
      const overflow =
        !!usage &&
        typeof input.route.contextWindow === 'number' &&
        isContextOverflow(usage, input.route.contextWindow, input.compactionReservedTokens);
      return {
        overflow,
        shouldContinue,
        shouldStop: !shouldContinue,
        stopReason,
        statusCode: 200,
        state,
        usage,
        usageOccurredAt: usage ? (doneChunk?.occurredAt ?? Date.now()) : undefined,
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
        writeAuditLog({
          sessionId: input.sessionId,
          category: 'stream',
          sourceName: errorCode,
          requestId: input.clientRequestId,
          input: { model: input.route.model, round: input.round, phase: 'mid-stream' },
          output: { message: errorMessage, code: errorCode },
        });
        markFailedRequestScopeMessages();
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
          overflow: false,
          shouldContinue: false,
          shouldStop: true,
          stopReason: 'error',
          statusCode: 502,
          state,
          usage: undefined,
          usageOccurredAt: undefined,
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
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'stream',
        sourceName: errorCode,
        requestId: input.clientRequestId,
        input: { model: input.route.model, round: input.round, phase: 'trailing-frame' },
        output: { message: errorMessage, code: errorCode },
      });
      markFailedRequestScopeMessages();
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
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: 502,
        state,
        usage: undefined,
        usageOccurredAt: undefined,
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
      finalizeAssistant('cancelled');
      input.writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(input.runId, input.eventSequence),
      });
      return {
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'cancelled',
        statusCode: 200,
        state,
        usage: undefined,
        usageOccurredAt: undefined,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (stepStream && stepStream.status === 'pending') {
      input.wl.fail(stepStream, message, { round: input.round });
    }
    if (stepUpstream.status === 'pending') {
      input.wl.fail(stepUpstream, message);
    }
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'STREAM_ERROR',
      requestId: input.clientRequestId,
      input: { model: input.route.model, round: input.round },
      output: { message, code: 'STREAM_ERROR' },
    });
    markFailedRequestScopeMessages();
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
    return {
      overflow: false,
      shouldContinue: false,
      shouldStop: true,
      stopReason: 'error',
      statusCode: 500,
      state,
      usage: undefined,
      usageOccurredAt: undefined,
    };
  }
}
