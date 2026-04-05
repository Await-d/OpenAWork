import { randomUUID } from 'node:crypto';
import type { FileDiffContent, RunEvent } from '@openAwork/shared';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';
import { appendSessionMessage, truncateSessionMessagesAfter } from '../session-message-store.js';
import {
  persistSessionRunEventForRequest,
  subscribeSessionRunEvents,
} from '../session-run-events.js';
import { persistSessionFileDiffs } from '../session-file-diff-store.js';
import {
  collectFileDiffsFromToolOutput,
  mergeFileDiffs,
  traceFileDiffs,
} from '../modified-files-summary.js';
import { createDefaultSandbox, reconcileResumedTaskChildSession } from '../tool-sandbox.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';
import { buildRequestScopedSystemPrompts } from './stream-system-prompts.js';
import { buildCapabilityContext } from './capabilities.js';
import {
  type ApprovedPermissionResumePayload,
  buildWorkspaceContext,
  createRunEventMeta,
  buildStreamToolObservability,
  createStreamExecutionContext,
  createTaskRuntimeGuardContext,
  createToolResultRequestId,
  executeToolCalls,
  getEnabledTools,
  handleStreamRequest,
  isWebSearchEnabled,
  loadSessionContext,
  loadSessionUser,
  resolveStreamRequestUpstreamRetry,
  resolveStreamModelRoute,
  setPersistedSessionStateStatus,
  streamRequestSchema,
} from './stream.js';
import { buildStreamUsageChunk } from './stream-usage-event.js';
import { runModelRound } from './stream-model-round.js';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  registerInFlightStreamRequest,
} from './stream-cancellation.js';
import { persistMonthlyUsageRecord } from '../usage-records-store.js';
import { resolveSessionInteractionStateUpdate } from '../session-runtime-state.js';
import { autoExtractMemoriesForRequest, buildMemoryBlockForSession } from '../memory-runtime.js';
import {
  clearSessionRuntimeThread,
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
  touchSessionRuntimeThread,
  upsertSessionRuntimeThread,
} from '../session-runtime-thread-store.js';
import { buildCompanionPrompt, loadCompanionSettingsForUser } from '../companion-settings.js';

async function continueFromApprovedToolResult(input: {
  initialToolResult: {
    isError: boolean;
    output: unknown;
    toolCallId: string;
    toolName: string;
  };
  payload: ApprovedPermissionResumePayload;
  resumedAfterApproval?: boolean;
  sessionId: string;
  userId: string;
}): Promise<{ pendingInteraction: boolean; statusCode: number }> {
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error('Session not found');
  }

  const requestData = resolveStreamRequestUpstreamRetry({
    metadataJson: sessionContext.metadataJson,
    requestData: streamRequestSchema.parse(input.payload.requestData),
    userId: input.userId,
  });

  const runId = randomUUID();
  const eventSequence = { value: 1 };
  const writeChunk = (chunk: RunEvent) => {
    persistSessionRunEventForRequest(input.sessionId, chunk, {
      clientRequestId: input.payload.clientRequestId,
    });
  };
  const route = await resolveStreamModelRoute({
    metadataJson: sessionContext.metadataJson,
    requestData,
    userId: input.userId,
  });
  const workspaceCtx = await buildWorkspaceContext(sessionContext.metadataJson);
  const resumedUser = loadSessionUser(input.sessionId, input.userId);
  const companionPrompt = resumedUser
    ? buildCompanionPrompt(
        loadCompanionSettingsForUser(resumedUser.sub, resumedUser.email, requestData.agentId),
        requestData.message,
      )
    : null;
  const requestSystemPrompts = buildRequestScopedSystemPrompts(
    requestData.message,
    buildCapabilityContext(input.userId, input.sessionId),
    {
      companionPrompt,
      dialogueMode: requestData.dialogueMode,
      yoloMode: requestData.yoloMode,
    },
  );
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
  const memoryBlock = buildMemoryBlockForSession(input.userId, sessionContext.metadataJson);
  const wl = new WorkflowLogger();
  const ctx = createRequestContext(
    'INTERNAL',
    `/sessions/${input.sessionId}/stream/resume`,
    {},
    'local',
  );

  const execution = (async (): Promise<{ pendingInteraction: boolean; statusCode: number }> => {
    let shouldKeepPausedState = false;
    const runtimeThreadStartedAt = Date.now();
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'running',
      userId: input.userId,
    });
    upsertSessionRuntimeThread({
      clientRequestId: input.payload.clientRequestId,
      heartbeatAtMs: runtimeThreadStartedAt,
      sessionId: input.sessionId,
      startedAtMs: runtimeThreadStartedAt,
      userId: input.userId,
    });
    const runtimeThreadHeartbeat = setInterval(() => {
      touchSessionRuntimeThread({
        clientRequestId: input.payload.clientRequestId,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    }, SESSION_RUNTIME_THREAD_HEARTBEAT_MS);

    if (
      getAnyInFlightStreamRequestForSession({
        excludeClientRequestId: input.payload.clientRequestId,
        sessionId: input.sessionId,
        userId: input.userId,
      })
    ) {
      throw new Error('Another request is already running for this session.');
    }

    const observability =
      input.payload.observability ??
      buildStreamToolObservability({
        metadataJson: sessionContext.metadataJson,
        presentedToolName: input.initialToolResult.toolName,
      });
    const resumedFileDiffs = traceFileDiffs({
      clientRequestId: input.payload.clientRequestId,
      diffs: collectFileDiffsFromToolOutput(input.initialToolResult.output),
      observability,
      requestId: createToolResultRequestId(
        input.payload.clientRequestId,
        input.initialToolResult.toolCallId,
      ),
      toolCallId: input.initialToolResult.toolCallId,
      toolName: input.initialToolResult.toolName,
    });

    const toolResultMessage = appendSessionMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'tool',
      content: [
        buildToolResultContent({
          toolCallId: input.initialToolResult.toolCallId,
          toolName: input.initialToolResult.toolName,
          clientRequestId: input.payload.clientRequestId,
          output: input.initialToolResult.output,
          isError: input.initialToolResult.isError,
          fileDiffs: resumedFileDiffs,
          resumedAfterApproval: input.resumedAfterApproval === true,
          observability,
        }),
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

    writeChunk(
      buildToolResultRunEvent({
        toolCallId: input.initialToolResult.toolCallId,
        toolName: input.initialToolResult.toolName,
        clientRequestId: input.payload.clientRequestId,
        output: input.initialToolResult.output,
        isError: input.initialToolResult.isError,
        fileDiffs: resumedFileDiffs,
        resumedAfterApproval: input.resumedAfterApproval === true,
        observability,
        eventMeta: createRunEventMeta(runId, eventSequence),
      }),
    );
    mergeFileDiffs(turnFileDiffs, resumedFileDiffs);
    if (resumedFileDiffs.length > 0) {
      persistSessionFileDiffs({
        sessionId: input.sessionId,
        userId: input.userId,
        clientRequestId: input.payload.clientRequestId,
        requestId: createToolResultRequestId(
          input.payload.clientRequestId,
          input.initialToolResult.toolCallId,
        ),
        toolName: input.initialToolResult.toolName,
        toolCallId: input.initialToolResult.toolCallId,
        observability,
        diffs: resumedFileDiffs,
      });
    }

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
          requestSystemPrompts,
          memoryBlock,
          writeChunk,
        });

        if (result.usage) {
          writeChunk(
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
            userId: input.userId,
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
              userId: input.userId,
            });
          }
          try {
            autoExtractMemoriesForRequest({
              userId: input.userId,
              sessionId: input.sessionId,
              clientRequestId: input.payload.clientRequestId,
            });
          } catch (error: unknown) {
            console.warn('memory auto extraction failed after resume completion', error);
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
      clearInterval(runtimeThreadHeartbeat);
      clearSessionRuntimeThread({
        clientRequestId: input.payload.clientRequestId,
        sessionId: input.sessionId,
        userId: input.userId,
      });
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
      resumedAfterApproval: true,
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
