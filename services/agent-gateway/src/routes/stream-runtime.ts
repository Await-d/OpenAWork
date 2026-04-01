import { randomUUID } from 'node:crypto';
import type { FileDiffContent, RunEvent } from '@openAwork/shared';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { filterEnabledGatewayToolsForSession } from '../session-tool-visibility.js';
import { appendSessionMessage, truncateSessionMessagesAfter } from '../session-message-store.js';
import {
  persistSessionRunEventForRequest,
  subscribeSessionRunEvents,
} from '../session-run-events.js';
import { mergeFileDiffs, collectFileDiffsFromToolOutput } from '../modified-files-summary.js';
import { createDefaultSandbox, reconcileResumedTaskChildSession } from '../tool-sandbox.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tool-result-contract.js';
import { buildRequestScopedSystemPrompts } from './stream-system-prompts.js';
import { buildCapabilityContext } from './capabilities.js';
import {
  type ApprovedPermissionResumePayload,
  buildWorkspaceContext,
  createRunEventMeta,
  createStreamExecutionContext,
  createTaskRuntimeGuardContext,
  createToolResultRequestId,
  executeToolCalls,
  getEnabledTools,
  handleStreamRequest,
  isWebSearchEnabled,
  loadSessionContext,
  loadSessionUser,
  resolveStreamModelRoute,
  setPersistedSessionStateStatus,
  streamRequestSchema,
} from './stream.js';
import { runModelRound } from './stream-model-round.js';
import { getAnyInFlightStreamRequestForSession } from './stream-cancellation.js';

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
  const requestSystemPrompts = buildRequestScopedSystemPrompts(
    requestData.message,
    buildCapabilityContext(input.userId, input.sessionId),
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
        buildToolResultContent({
          toolCallId: input.initialToolResult.toolCallId,
          toolName: input.initialToolResult.toolName,
          output: input.initialToolResult.output,
          isError: input.initialToolResult.isError,
          observability: input.payload.observability,
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
        output: input.initialToolResult.output,
        isError: input.initialToolResult.isError,
        observability: input.payload.observability,
        eventMeta: createRunEventMeta(runId, eventSequence),
      }),
    );
    mergeFileDiffs(turnFileDiffs, collectFileDiffsFromToolOutput(input.initialToolResult.output));

    const unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
      if (event.type === 'question_asked') {
        shouldKeepPausedState = true;
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'paused',
          userId: input.userId,
        });
      }

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

      if (event.type === 'question_replied' && event.status === 'answered') {
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
          requestSystemPrompts,
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

  return execution;
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
