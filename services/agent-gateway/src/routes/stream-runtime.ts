import { randomUUID } from 'node:crypto';
import type { FileDiffContent, RunEvent } from '@openAwork/shared';
import type { HandleStreamResult } from './stream-types.js';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import {
  filterEnabledGatewayToolsForDialogueMode,
  filterEnabledGatewayToolsForSession,
} from '../session/session-tool-visibility.js';
import { resolveSessionRuntimePolicy } from '../session/session-runtime-policy.js';
import { isTerminatedChildSession } from '../session/child-session-terminal-guard.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  approveToolPermission,
  listSessionMessagesV2 as listSessionMessages,
  rejectToolPermission,
} from '../message/message-v2-adapter.js';
import {
  publishSessionRunEvent,
  subscribeSessionRunEvents,
} from '../session/session-run-events.js';
import { persistSessionFileDiffs } from '../session/session-file-diff-store.js';
import {
  collectFileDiffsFromToolOutput,
  mergeFileDiffs,
  traceFileDiffs,
} from '../tools/modified-files-summary.js';
import {
  createDefaultSandbox,
  recordBlockedToolCallsForPendingRequest,
  reconcileResumedTaskChildSession,
} from '../tools/tool-sandbox.js';
import { buildToolResultContent, buildToolResultRunEvent } from '../tools/tool-result-contract.js';
import {
  CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
  YOLO_MODE_SYSTEM_PROMPT,
} from './stream-system-prompts.js';
import { calculateTokenUsageCost, KeywordDetectorImpl } from '@openAwork/agent-core';
import { buildCapabilityContext } from './capabilities.js';
import { filterPluginControlledToolsForUser } from '../tools/plugin-tool-settings.js';
import {
  type ApprovedPermissionResumePayload,
  type BlockedToolCallResumeEntry,
  buildRouteOnlyUpstreamSummary,
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
  resolveStreamInteractionModes,
  resolveStreamRequestUpstreamRetry,
  resolveStreamModelRoute,
  setPersistedSessionStateStatus,
  streamRequestSchema,
} from './stream.js';
import { buildStreamUsageChunk } from './stream-usage-event.js';
import { publishTeamUsageEvent } from './stream-team-events.js';
import {
  clearInFlightStreamRequest,
  getAnyInFlightStreamRequestForSession,
  registerInFlightStreamRequest,
} from './stream-cancellation.js';
import { persistMonthlyUsageRecord } from '../session/usage-records-store.js';
import { sqliteGet } from '../infra/db.js';
import {
  COMPACTION_SETTINGS_KEY,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import {
  triggerOverflowCompaction,
  triggerProactiveCompaction,
} from '../compaction/auto-compaction-trigger.js';
import { runModelRound, MAX_CONTINUATION_ROUNDS } from './stream-model-round.js';
import { resolveSessionInteractionStateUpdate } from '../session/session-runtime-state.js';
import {
  autoExtractMemoriesForRequest,
  buildMemoryBlockForSession,
} from '../memory/memory-runtime.js';
import { buildTeamInstructionStack } from '../team/team-instruction-stack.js';
import {
  buildTeamResumeSystemPrompt,
  buildTeamUserFacingStatusPrompt,
  clearInternalTeamResumeRequest,
  getInternalTeamResumeRootSessionId,
  rememberInternalTeamResumeRequest,
  resolveTeamRootSessionId,
} from '../team/team-resume-context.js';
import {
  applyTeamLayerToolGate,
  appendTeamDynamicInstructionBlocks,
  isTeamRoleLayer,
  resolveTeamSessionRoleLayer,
} from '../handoff/capability/apply-team-layer-tools.js';
import {
  clearSessionRuntimeThread,
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS,
  touchSessionRuntimeThread,
  upsertSessionRuntimeThread,
} from '../session/session-runtime-thread-store.js';
import {
  buildCompanionPrompt,
  loadCompanionSettingsForUser,
} from '../workspace/companion-settings.js';
import type { InputImageContent } from '@openAwork/shared';

export function resolveBlockedCalls(
  payload: ApprovedPermissionResumePayload,
): BlockedToolCallResumeEntry[] {
  if (payload.blockedToolCalls && payload.blockedToolCalls.length > 0) {
    return payload.blockedToolCalls;
  }
  return [
    {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      rawInput: payload.rawInput,
    },
  ];
}

function hasResidualPendingPermissionRequests(sessionId: string): boolean {
  const row = sqliteGet<{ id: string }>(
    `SELECT id FROM permission_requests WHERE session_id = ? AND status = 'pending' LIMIT 1`,
    [sessionId],
  );
  return Boolean(row);
}

/**
 * True when the paused turn already produced a continuation (a later message
 * exists after the assistant message that owns `anchorCallId`).
 *
 * Tool results attach as parts of that assistant message, so appending a resumed
 * result does not itself create a newer message — only a real follow-up round
 * does. This is the opencode-aligned "never replay a round that already ran"
 * guard: a late sibling approval must append in place instead of re-running the
 * model round from `nextRound`, which could leave stale rounds in the transcript.
 */
function hasTurnContinuationAfterPause(input: {
  anchorCallId: string;
  sessionId: string;
  userId: string;
}): boolean {
  const messages = listSessionMessages({ sessionId: input.sessionId, userId: input.userId });
  const anchorIndex = messages.findIndex(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) => (part as { toolCallId?: string }).toolCallId === input.anchorCallId,
      ),
  );
  return anchorIndex !== -1 && anchorIndex < messages.length - 1;
}

/**
 * Derive the next model round from the persisted transcript instead of trusting
 * the round stored on the pending payload.
 *
 * Intermediate assistant messages are keyed `${clientRequestId}:assistant:<n>`
 * (`createIntermediateAssistantRequestId`), so the next round is `max(n) + 1`.
 * `fallbackRound` (the payload's `nextRound`, captured as `round + 1` at pause
 * time) is only used when no intermediate round is recoverable, which keeps the
 * behaviour identical on the normal path while removing the round-replay class
 * of bug when a continuation already exists.
 */
export function deriveResumeRound(input: {
  clientRequestId: string;
  fallbackRound: number;
  sessionId: string;
  userId: string;
}): number {
  const prefix = `${input.clientRequestId}:assistant:`;
  let maxRound = 0;
  for (const message of listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
  })) {
    const value = (message as { clientRequestId?: string }).clientRequestId;
    if (typeof value !== 'string' || !value.startsWith(prefix)) continue;
    const parsed = Number.parseInt(value.slice(prefix.length), 10);
    if (Number.isFinite(parsed) && parsed > maxRound) {
      maxRound = parsed;
    }
  }
  return maxRound > 0 ? maxRound + 1 : input.fallbackRound;
}

async function continueFromApprovedToolResult(input: {
  initialToolResults: Array<{
    attachments?: InputImageContent[];
    isError: boolean;
    output: unknown;
    toolCallId: string;
    toolName: string;
  }>;
  payload: ApprovedPermissionResumePayload;
  resumedAfterApproval?: boolean;
  sessionId: string;
  userId: string;
}): Promise<{ pendingInteraction: boolean; statusCode: number }> {
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error('目标会话不存在。');
  }

  const requestData = resolveStreamRequestUpstreamRetry({
    metadataJson: sessionContext.metadataJson,
    requestData: streamRequestSchema.parse(input.payload.requestData),
    userId: input.userId,
  });
  const settingsRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [input.userId, COMPACTION_SETTINGS_KEY],
  );
  let storedSettings: unknown;
  if (settingsRow?.value) {
    try {
      storedSettings = JSON.parse(settingsRow.value) as unknown;
    } catch {
      storedSettings = undefined;
    }
  }
  const compactionSettings = readCompactionSettings(storedSettings);

  const runId = randomUUID();
  const eventSequence = { value: 1 };
  // Permission-approval resume runs without an open WS/SSE — clients consume
  // events through the /stream/attach endpoint instead. Use publish (persist
  // + broadcast) so attach subscribers receive live events; the local
  // session-run-events subscription below only reacts to interaction-state
  // event types, so broadcasting other chunks here is a no-op for it.
  const writeChunk = (chunk: RunEvent) => {
    publishSessionRunEvent(input.sessionId, chunk, {
      clientRequestId: input.payload.clientRequestId,
    });
  };
  const route = await resolveStreamModelRoute({
    metadataJson: sessionContext.metadataJson,
    requestData,
    userId: input.userId,
  });
  const workspaceCtx = await buildWorkspaceContext(sessionContext.metadataJson, {
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const sessionMeta = parseSessionMetadataJson(sessionContext.metadataJson);
  const runtimePolicy = resolveSessionRuntimePolicy(sessionMeta);
  const resumedUser = loadSessionUser(input.sessionId, input.userId);
  const companionPrompt = resumedUser
    ? buildCompanionPrompt(
        loadCompanionSettingsForUser(resumedUser.sub, resumedUser.email, requestData.agentId),
        requestData.message,
      )
    : null;
  const capabilityContext = runtimePolicy.includeCapabilityContext
    ? buildCapabilityContext(input.userId, input.sessionId)
    : null;
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(requestData.message);
  const injectedPrompt = detection.injectedPrompt ?? null;
  const lspGuidance = runtimePolicy.includeLspGuidance
    ? requestData.dialogueMode === 'clarify'
      ? CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
      : LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
    : null;
  const dialogueModePrompt =
    requestData.dialogueMode !== undefined
      ? DIALOGUE_MODE_SYSTEM_PROMPTS[requestData.dialogueMode]
      : null;
  // 与 stream.ts 的 resolveStreamInteractionModes 共用同一优先级（请求 permissionMode 规范键
  // > 请求 yoloMode 旧布尔 > 会话 metadata 解析结果），避免两条入口的 YOLO 提示词投影漂移。
  const yoloModePrompt = resolveStreamInteractionModes({
    metadataJson: sessionContext.metadataJson,
    requestData,
  }).yoloMode
    ? YOLO_MODE_SYSTEM_PROMPT
    : null;
  const webSearchEnabled =
    requestData.webSearchEnabled ?? isWebSearchEnabled(sessionContext.metadataJson);
  const filteredTools = filterEnabledGatewayToolsForDialogueMode(
    filterEnabledGatewayToolsForSession(
      // Per-turn model-aware tool filter (mirrors opencode
      // `tool/registry.ts:303-315`). See routes/stream.ts getEnabledTools
      // doc for the full GPT-5 vs edit/write split rationale.
      filterPluginControlledToolsForUser(
        getEnabledTools(webSearchEnabled, { modelId: route.model }),
        input.userId,
      ),
      sessionContext.metadataJson,
    ),
    // 本轮提示词由 `requestData.dialogueMode` 决定（恢复轮沿用原始请求）。工具面必须
    // 跟同一模式收敛：澄清完成会在回复响应前把会话元数据切成 coding，若只按元数据
    // 过滤，恢复出的那一轮会带着"澄清（只读）"提示词却拿到写/执行工具。
    requestData.dialogueMode,
  );
  // 团队层（pm1/pm2/executor/reviewer 后台执行经此路径）：与 stream.ts 一致地
  //   1) 注入按会话绑定的 flat MCP 工具，2) 施加 toolset 门控 + 内置指令注入。
  //   早期本路径漏了这步，导致干活层拿不到 submit_artifact/submit_patch 等指令 + MCP。
  const roleLayerForTools = resolveTeamSessionRoleLayer(sessionContext.roleLayer);
  let toolsForSession = filteredTools;
  let flatMcpToolsEnabled = false;
  if (isTeamRoleLayer(roleLayerForTools)) {
    // flat MCP（按 requestedMcpServers 白名单动态注入）
    try {
      const { isFlatMcpToolsDisabled } = await import('../mcp/mcp-tool-naming.js');
      if (!isFlatMcpToolsDisabled()) {
        const { listMcpToolsForSession } = await import('../mcp/mcp-runtime.js');
        const { buildFlatMcpToolDefinitions } = await import('../mcp/mcp-flat-tool-defs.js');
        const allowedMcp = Array.isArray(sessionMeta['requestedMcpServers'])
          ? (sessionMeta['requestedMcpServers'] as unknown[]).filter(
              (v): v is string => typeof v === 'string' && v.length > 0,
            )
          : [];
        // team 最小授权（同 stream.ts）：此分支恒为 team 层，未显式绑定 MCP 时传空
        // 白名单（defined []）只暴露内置 MCP，不继承用户私有 MCP。
        const catalogs = await listMcpToolsForSession(input.sessionId, {
          allowedServerIds: allowedMcp,
        });
        const flat = buildFlatMcpToolDefinitions(catalogs).definitions;
        if (flat.length > 0) {
          const base = toolsForSession.filter(
            (t) => t.function.name !== 'mcp_list_tools' && t.function.name !== 'mcp_call',
          );
          toolsForSession = [...base, ...flat];
          flatMcpToolsEnabled = true;
        }
      }
    } catch (err) {
      console.warn(
        `[stream-runtime] flat MCP 注入失败（忽略，不阻塞）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    toolsForSession = await applyTeamLayerToolGate({
      roleLayer: roleLayerForTools,
      metadataJson: sessionContext.metadataJson,
      filteredTools: toolsForSession,
    });
  }
  const shouldDeferToolLoading =
    route.deferToolLoading === true || sessionMeta['deferToolLoading'] === true;
  const enabledTools = shouldDeferToolLoading
    ? toolsForSession.map((tool) => ({
        ...tool,
        function: { ...tool.function, deferLoading: true },
      }))
    : toolsForSession;
  const enabledToolNames = new Set(enabledTools.map((tool) => tool.function.name));
  const turnFileDiffs = new Map<string, FileDiffContent>();
  const abortController = new AbortController();
  const taskRuntimeGuardContext = createTaskRuntimeGuardContext(sessionContext.metadataJson);
  const memoryBlock = buildMemoryBlockForSession(input.userId, sessionContext.metadataJson);

  // 260515-team-phase-a · T-06：构建 7 层团队指令栈（resume 路径）
  const teamWorkspaceIdForStack =
    typeof sessionMeta['teamWorkspaceId'] === 'string' ? sessionMeta['teamWorkspaceId'] : null;
  // 递归解析 workingDirectory：子 session 可能没有直接设置 workingDirectory，
  // 需要通过 DB 列 team_parent_session_id 向上查找父 session 链。
  const workingDirectoryForStack = resolveSessionWorkspacePath({
    metadataJson: sessionContext.metadataJson,
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const roleLayerForStack = roleLayerForTools;
  const teamInstructionStackResult = await buildTeamInstructionStack({
    userId: input.userId,
    workspaceRoot: workingDirectoryForStack,
    teamWorkspaceId: teamWorkspaceIdForStack,
    roleLayer: roleLayerForStack,
  });
  const teamInstructionStack = appendTeamDynamicInstructionBlocks({
    stableBlock: teamInstructionStackResult.stableBlock,
    roleLayer: roleLayerForStack,
    teamRosterManifest:
      typeof sessionMeta['teamRosterManifest'] === 'string'
        ? sessionMeta['teamRosterManifest']
        : null,
    enabledToolNames,
  });
  const teamResumeRootSessionId = getInternalTeamResumeRootSessionId({
    clientRequestId: requestData.clientRequestId,
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const teamResumePrompt = teamResumeRootSessionId
    ? await buildTeamResumeSystemPrompt({
        rootSessionId: teamResumeRootSessionId,
        userId: input.userId,
      })
    : null;
  const teamStatusRootSessionId =
    teamResumeRootSessionId ??
    resolveTeamRootSessionId({
      metadataJson: sessionContext.metadataJson,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  const teamStatusPrompt = teamStatusRootSessionId
    ? await buildTeamUserFacingStatusPrompt({
        rootSessionId: teamStatusRootSessionId,
        userId: input.userId,
      })
    : null;

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
      // Heartbeat is a best-effort liveness ping. A transient SQLite error
      // here must not throw out of the timer callback as an uncaught
      // exception — the next tick simply retries.
      try {
        touchSessionRuntimeThread({
          clientRequestId: input.payload.clientRequestId,
          sessionId: input.sessionId,
          userId: input.userId,
        });
      } catch (err) {
        console.warn(
          '[stream-runtime] runtime-thread heartbeat failed',
          err instanceof Error ? err.message : String(err),
        );
      }
    }, SESSION_RUNTIME_THREAD_HEARTBEAT_MS);

    // Every exit path between here and the `finally` below must run the runtime
    // thread teardown: two early returns (residual pending gate / turn-continuation
    // guard) used to sit outside the try, leaking the heartbeat interval and
    // leaving a stale `session_runtime_thread` row behind.
    let unsubscribeSessionEvents: (() => void) | undefined;
    try {
      if (
        getAnyInFlightStreamRequestForSession({
          excludeClientRequestId: input.payload.clientRequestId,
          sessionId: input.sessionId,
          userId: input.userId,
        })
      ) {
        throw new Error('Another request is already running for this session.');
      }

      // Append every resumed tool result (the blocked call plus any held-back
      // siblings), in `tool_use` order.
      //
      // We intentionally DO NOT truncate messages after these results: sibling
      // results produced during the pause turn were written earlier in the
      // transcript, while the resumed call's own result message already exists
      // (deterministic `createToolResultRequestId` + `replaceExisting`). Truncating
      // after that (older) message id would silently delete the siblings' results.
      // Idempotency for retried resumes comes from the deterministic
      // clientRequestId keying instead of transcript truncation.
      for (const initialToolResult of input.initialToolResults) {
        const observability =
          input.payload.observability ??
          buildStreamToolObservability({
            metadataJson: sessionContext.metadataJson,
            presentedToolName: initialToolResult.toolName,
          });
        const resumedFileDiffs = traceFileDiffs({
          clientRequestId: input.payload.clientRequestId,
          diffs: collectFileDiffsFromToolOutput(initialToolResult.output),
          observability,
          requestId: createToolResultRequestId(
            input.payload.clientRequestId,
            initialToolResult.toolCallId,
          ),
          toolCallId: initialToolResult.toolCallId,
          toolName: initialToolResult.toolName,
        });

        appendSessionMessage({
          sessionId: input.sessionId,
          userId: input.userId,
          role: 'tool',
          content: [
            buildToolResultContent({
              toolCallId: initialToolResult.toolCallId,
              toolName: initialToolResult.toolName,
              clientRequestId: input.payload.clientRequestId,
              output: initialToolResult.output,
              isError: initialToolResult.isError,
              ...(initialToolResult.attachments
                ? { attachments: initialToolResult.attachments }
                : {}),
              fileDiffs: resumedFileDiffs,
              resumedAfterApproval: input.resumedAfterApproval === true,
              observability,
            }),
          ],
          clientRequestId: createToolResultRequestId(
            input.payload.clientRequestId,
            initialToolResult.toolCallId,
          ),
          replaceExisting: true,
        });

        writeChunk(
          buildToolResultRunEvent({
            toolCallId: initialToolResult.toolCallId,
            toolName: initialToolResult.toolName,
            clientRequestId: input.payload.clientRequestId,
            output: initialToolResult.output,
            isError: initialToolResult.isError,
            ...(initialToolResult.attachments
              ? { attachments: initialToolResult.attachments }
              : {}),
            fileDiffs: resumedFileDiffs,
            resumedAfterApproval: input.resumedAfterApproval === true,
            observability,
            eventMeta: createRunEventMeta(runId, eventSequence),
          }),
        );
        mergeFileDiffs(turnFileDiffs, resumedFileDiffs);
        if (resumedFileDiffs.length > 0) {
          await persistSessionFileDiffs({
            sessionId: input.sessionId,
            userId: input.userId,
            clientRequestId: input.payload.clientRequestId,
            requestId: createToolResultRequestId(
              input.payload.clientRequestId,
              initialToolResult.toolCallId,
            ),
            toolName: initialToolResult.toolName,
            toolCallId: initialToolResult.toolCallId,
            observability,
            diffs: resumedFileDiffs,
          });
        }
      }

      // D-6 gate: if other permission requests for this session are still pending
      // (e.g. a held-back sibling needed its own approval), hold the turn instead of
      // sending a partial tool_result set upstream.
      if (hasResidualPendingPermissionRequests(input.sessionId)) {
        writeChunk({
          type: 'done',
          stopReason: 'tool_permission',
          upstreamSummary: buildRouteOnlyUpstreamSummary(route, 'tool_permission'),
          ...createRunEventMeta(runId, eventSequence),
        });
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'paused',
          userId: input.userId,
        });
        wl.flush(ctx, 200);
        return { pendingInteraction: true, statusCode: 200 };
      }

      // opencode-aligned: if this turn already continued past the pause, a late
      // sibling approval only appends its result in place. Re-running the model
      // round from `nextRound` would replay rounds that already ran and could
      // leave stale transcript entries behind.
      if (
        hasTurnContinuationAfterPause({
          anchorCallId: input.payload.toolCallId,
          sessionId: input.sessionId,
          userId: input.userId,
        })
      ) {
        setPersistedSessionStateStatus({
          sessionId: input.sessionId,
          status: 'idle',
          userId: input.userId,
        });
        wl.flush(ctx, 200);
        return { pendingInteraction: false, statusCode: 200 };
      }

      unsubscribeSessionEvents = subscribeSessionRunEvents(input.sessionId, (event) => {
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

      let syntheticContinuationPrompt: string | undefined;
      let previousRoundUsedTools = false;
      const resumeStartRound = deriveResumeRound({
        clientRequestId: input.payload.clientRequestId,
        fallbackRound: input.payload.nextRound,
        sessionId: input.sessionId,
        userId: input.userId,
      });
      for (let round = resumeStartRound; ; round += 1) {
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
          compactionAutoEnabled: compactionSettings.auto,
          compactionReservedTokens: compactionSettings.reserved,
          workspaceCtx,
          injectedPrompt,
          capabilityContext,
          lspGuidance,
          dialogueModePrompt,
          yoloModePrompt,
          companionPrompt,
          flatMcpToolsEnabled,
          memoryBlock,
          teamInstructionStack,
          teamResumePrompt,
          teamStatusPrompt,
          ...(round === resumeStartRound || previousRoundUsedTools
            ? {
                beforeUpstreamCall: async (renderedMessageTokens: number) => {
                  const proactiveResult = await triggerProactiveCompaction({
                    userId: input.userId,
                    sessionId: input.sessionId,
                    metadataJson: sessionContext.metadataJson,
                    clientRequestId: input.payload.clientRequestId,
                    runId,
                    route,
                    compactionSettings,
                    signal: abortController.signal,
                    round,
                    lastRoundUsage: { inputTokens: renderedMessageTokens },
                    requestKind: 'conversation',
                  });
                  if (proactiveResult.triggered) {
                    sessionContext.metadataJson = proactiveResult.metadataJson;
                  }
                  return proactiveResult.triggered;
                },
              }
            : {}),
          syntheticContinuationPrompt,
          writeChunk,
        });
        syntheticContinuationPrompt = undefined;
        previousRoundUsedTools = result.stopReason === 'tool_use';

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
            cacheReadPricePerMillion: route.cacheReadPricePerMillion,
            cacheWritePricePerMillion: route.cacheWritePricePerMillion,
            usage: result.usage,
            userId: input.userId,
          });
          publishTeamUsageEvent({
            userId: input.userId,
            sessionId: input.sessionId,
            sessionContext,
            round,
            agentId: route.effectiveAgentId ?? undefined,
            provider: route.providerType ?? undefined,
            model: route.model ?? undefined,
            clientRequestId: input.payload.clientRequestId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.reasoningTokens,
            cacheReadTokens: result.usage.cacheReadTokens,
            cacheWriteTokens: result.usage.cacheWriteTokens,
            costUsd:
              route.inputPricePerMillion !== undefined ||
              route.outputPricePerMillion !== undefined ||
              route.cacheReadPricePerMillion !== undefined ||
              route.cacheWritePricePerMillion !== undefined
                ? calculateTokenUsageCost({
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    cacheReadTokens: result.usage.cacheReadTokens,
                    cacheWriteTokens: result.usage.cacheWriteTokens,
                    inputPricePerMillion: route.inputPricePerMillion,
                    outputPricePerMillion: route.outputPricePerMillion,
                    cacheReadPricePerMillion: route.cacheReadPricePerMillion,
                    cacheWritePricePerMillion: route.cacheWritePricePerMillion,
                  })
                : undefined,
          });
        }

        let overflowTriggered = false;
        if (result.overflow === true) {
          const overflowResult = await triggerOverflowCompaction({
            userId: input.userId,
            sessionId: input.sessionId,
            metadataJson: sessionContext.metadataJson,
            clientRequestId: input.payload.clientRequestId,
            runId,
            route,
            compactionSettings,
            signal: abortController.signal,
            round,
            requestKind: 'conversation',
            roundResult: {
              overflow: result.overflow,
              stopReason: result.stopReason,
              usage: result.usage,
              upstreamError: result.upstreamError,
            },
          });
          if (overflowResult.triggered) {
            sessionContext.metadataJson = overflowResult.metadataJson;
            overflowTriggered = true;
            if (overflowResult.syntheticContinuationPrompt) {
              syntheticContinuationPrompt = overflowResult.syntheticContinuationPrompt;
            }
          }
        }

        if (result.overflow === true && overflowTriggered && round < MAX_CONTINUATION_ROUNDS) {
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
              userId: input.userId,
            });
          }
          try {
            autoExtractMemoriesForRequest({
              userId: input.userId,
              sessionId: input.sessionId,
              clientRequestId: input.payload.clientRequestId,
              metadataJson: sessionContext.metadataJson,
            });
          } catch (error: unknown) {
            console.warn('memory auto extraction failed after resume completion', error);
          }
          // Session memory extraction (Layer 1 compaction support).
          // Fire-and-forget: extracts key session info for use by
          // Session Memory Compact during future compaction rounds.
          try {
            const { extractSessionMemory } =
              await import('../compaction/session-memory-extractor.js');
            void extractSessionMemory({
              sessionId: input.sessionId,
              userId: input.userId,
              route,
            });
          } catch {
            // Intentionally silent — session memory extraction is best-effort
          }
          return { pendingInteraction: shouldKeepPausedState, statusCode: result.statusCode };
        }

        const toolCallsResult = await executeToolCalls({
          clientRequestId: input.payload.clientRequestId,
          executionContext: createStreamExecutionContext(
            input.payload.clientRequestId,
            round + 1,
            requestData,
            input.userId,
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

        if (toolCallsResult.hasPendingPermission) {
          console.log(
            '[PERMISSION_PAUSE][RUNTIME] emitting done with tool_permission, sessionId=',
            input.sessionId,
            'runId=',
            runId,
          );
          writeChunk({
            type: 'done',
            stopReason: 'tool_permission',
            // 权限暂停也必须携带 upstreamSummary，否则前端会沿用上一轮的终态标签（如「已停止」）。
            upstreamSummary: buildRouteOnlyUpstreamSummary(route, 'tool_permission'),
            ...createRunEventMeta(runId, eventSequence),
          });
          setPersistedSessionStateStatus({
            sessionId: input.sessionId,
            status: 'paused',
            userId: input.userId,
          });
          wl.flush(ctx, 200);
          return { pendingInteraction: true, statusCode: 200 };
        }
      }
    } finally {
      clearInterval(runtimeThreadHeartbeat);
      clearSessionRuntimeThread({
        clientRequestId: input.payload.clientRequestId,
        sessionId: input.sessionId,
        userId: input.userId,
      });
      unsubscribeSessionEvents?.();
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
    const result = await execution;
    if (!result.pendingInteraction) {
      clearInternalTeamResumeRequest(input.payload.clientRequestId);
    }
    return result;
  } catch (error) {
    clearInternalTeamResumeRequest(input.payload.clientRequestId);
    throw error;
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
  if (isTerminatedChildSession(input.sessionId)) {
    // 子会话已被停止/超时终止：拒绝复活，避免已取消的子代理重新执行工具。
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.userId,
    });
    return;
  }

  let resumeResult: { pendingInteraction: boolean; statusCode: number };
  const blockedCalls = resolveBlockedCalls(input.payload);
  try {
    const sandbox = createDefaultSandbox([], { userId: input.userId });
    const executionContext = createStreamExecutionContext(
      input.payload.clientRequestId,
      input.payload.nextRound,
      streamRequestSchema.parse(input.payload.requestData),
      input.userId,
    );
    const initialToolResults: Array<{
      attachments?: InputImageContent[];
      isError: boolean;
      output: unknown;
      toolCallId: string;
      toolName: string;
    }> = [];

    for (const [index, call] of blockedCalls.entries()) {
      // V2: Transition ToolPart from pending → running before executing
      approveToolPermission({
        sessionId: input.sessionId,
        userId: input.userId,
        callID: call.toolCallId,
        title: call.toolName,
      });

      const toolResult = await sandbox.execute(
        {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          rawInput: call.rawInput,
        },
        new AbortController().signal,
        input.sessionId,
        executionContext,
      );

      if (toolResult.pendingPermissionRequestId) {
        // A held-back sibling still needs its own approval: keep this call and
        // everything after it with the new pending request. The residual-pending
        // gate inside continueFromApprovedToolResult then holds the turn.
        recordBlockedToolCallsForPendingRequest(
          toolResult.pendingPermissionRequestId,
          blockedCalls.slice(index),
        );
        break;
      }

      initialToolResults.push({
        ...(toolResult.attachments ? { attachments: toolResult.attachments } : {}),
        isError: toolResult.isError,
        output: toolResult.output,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      });
    }

    resumeResult = await continueFromApprovedToolResult({
      initialToolResults,
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
    clearInternalTeamResumeRequest(input.payload.clientRequestId);
    // V2: Transition ToolPart to error state on failure
    for (const call of blockedCalls) {
      rejectToolPermission({
        sessionId: input.sessionId,
        userId: input.userId,
        callID: call.toolCallId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await reconcileResumedTaskChildSession({
      childSessionId: input.sessionId,
      pendingInteraction: false,
      statusCode: 500,
      userId: input.userId,
    });
    throw error;
  }
}

/**
 * Resume session after a rejected permission request by feeding the rejection
 * as a tool error result, allowing the LLM to try a different approach.
 * Mirrors opencode's `continue_loop_on_deny` behavior.
 */
export async function resumeRejectedPermissionRequest(input: {
  payload: ApprovedPermissionResumePayload;
  feedback?: string;
  sessionId: string;
  userId: string;
}): Promise<void> {
  if (isTerminatedChildSession(input.sessionId)) {
    // 子会话已被停止/超时终止：拒绝复活，避免已取消的子代理重新执行工具。
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.userId,
    });
    return;
  }

  try {
    const blockedCalls = resolveBlockedCalls(input.payload);
    const rejectionError = input.feedback
      ? `权限已拒绝。用户反馈: ${input.feedback}`
      : '权限已拒绝，工具未执行。';
    const rejectionOutput = input.feedback
      ? `权限已拒绝。用户反馈: ${input.feedback}。请尝试其他方法。`
      : '权限已拒绝，工具未执行。请尝试其他方法。';

    // V2: Transition every blocked ToolPart to error state for the rejection
    for (const call of blockedCalls) {
      rejectToolPermission({
        sessionId: input.sessionId,
        userId: input.userId,
        callID: call.toolCallId,
        error: rejectionError,
      });
    }

    // Continue the stream loop with the rejection as a tool error
    const resumeResult = await continueFromApprovedToolResult({
      initialToolResults: blockedCalls.map((call) => ({
        isError: true,
        output: rejectionOutput,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      })),
      payload: input.payload,
      resumedAfterApproval: false,
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
    clearInternalTeamResumeRequest(input.payload.clientRequestId);
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
  onStarted?: () => void;
  requestData: Record<string, unknown>;
  sessionId: string;
  signal?: AbortSignal;
  teamResumeRootSessionId?: string;
  userId: string;
  writeChunk?: (chunk: RunEvent) => void;
}): Promise<HandleStreamResult> {
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error(`目标会话不存在：${input.sessionId}`);
  }

  const user = loadSessionUser(input.sessionId, input.userId);
  if (!user) {
    throw new Error(`Session user not found: ${input.userId}`);
  }

  const requestData = streamRequestSchema.parse(input.requestData);
  if (input.teamResumeRootSessionId) {
    rememberInternalTeamResumeRequest({
      clientRequestId: requestData.clientRequestId,
      rootSessionId: input.teamResumeRootSessionId,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  try {
    const result = await handleStreamRequest({
      headers: {},
      ip: 'internal',
      method: 'INTERNAL',
      path: `/sessions/${input.sessionId}/stream/background`,
      requestData,
      signal: input.signal,
      sessionContext,
      sessionId: input.sessionId,
      teamResumeRootSessionId: input.teamResumeRootSessionId,
      transport: 'SSE',
      user,
      writeChunk: input.writeChunk ?? (() => undefined),
      onStarted: input.onStarted,
    });
    if (result.stopReason !== 'tool_permission') {
      clearInternalTeamResumeRequest(requestData.clientRequestId);
    }
    // 防御性补全：handleStreamRequest 的某些 early-return 路径（如模型绑定不可用、
    // replay 命中、SESSION_ALREADY_RUNNING）返回不含 stopReason 的结果。
    // 这会导致 runExecutionLayer 无法正确判断失败原因，报"stopReason=undefined"。
    // 这里统一补全：无 stopReason 的结果视为 error。
    if (!result.stopReason) {
      return {
        ...result,
        stopReason: 'error' as const,
        errorSummary:
          result.errorSummary ??
          `stream 执行未正常结束（statusCode=${result.statusCode}，无 stopReason），可能模型路由解析失败、replay 命中或 session 冲突`,
      };
    }
    return result;
  } catch (error) {
    clearInternalTeamResumeRequest(requestData.clientRequestId);
    throw error;
  }
}

/**
 * 从既有历史继续执行一轮（唤醒父会话），**不新增用户轮**。
 *
 * 与 `runSessionInBackground` 的关键区别：后者会持久化一条用户消息（「用户发言」语义），
 * 本函数只触发执行——输入（例如已落库的子代理完成通知）必须已存在于会话历史中。
 * 对齐上游 opencode 的 `sessions.synthetic`（入库）与 `execution.wake`（执行）两段分离。
 *
 * 幂等：调用方应传入稳定的 `clientRequestId`（如通知身份 `notificationId`），
 * 复用既有「按请求的已完成重放」语义，重复唤醒不会重复执行。
 */
export async function continueSessionFromHistory(input: {
  clientRequestId: string;
  onStarted?: () => void;
  sessionId: string;
  signal?: AbortSignal;
  userId: string;
  writeChunk?: (chunk: RunEvent) => void;
}): Promise<HandleStreamResult> {
  const sessionContext = loadSessionContext(input.sessionId, input.userId);
  if (!sessionContext) {
    throw new Error(`目标会话不存在：${input.sessionId}`);
  }

  const user = loadSessionUser(input.sessionId, input.userId);
  if (!user) {
    throw new Error(`Session user not found: ${input.userId}`);
  }

  // `message` 在此模式下不承载输入（输入已在历史中），但 schema 要求该字段存在。
  const requestData = streamRequestSchema.parse({
    clientRequestId: input.clientRequestId,
    message: '',
  });

  return handleStreamRequest({
    continueFromHistory: true,
    headers: {},
    ip: 'internal',
    method: 'INTERNAL',
    path: `/sessions/${input.sessionId}/stream/continue`,
    requestData,
    ...(input.signal ? { signal: input.signal } : {}),
    sessionContext,
    sessionId: input.sessionId,
    transport: 'SSE',
    user,
    writeChunk: input.writeChunk ?? (() => undefined),
    onStarted: input.onStarted,
  });
}

export async function resumeAnsweredQuestionRequest(input: {
  payload: ApprovedPermissionResumePayload;
  answerOutput: string;
  sessionId: string;
  userId: string;
}): Promise<void> {
  if (isTerminatedChildSession(input.sessionId)) {
    // 子会话已被停止/超时终止：拒绝复活，避免已取消的子代理重新执行工具。
    setPersistedSessionStateStatus({
      sessionId: input.sessionId,
      status: 'idle',
      userId: input.userId,
    });
    return;
  }

  let resumeResult: { pendingInteraction: boolean; statusCode: number };
  try {
    resumeResult = await continueFromApprovedToolResult({
      initialToolResults: [
        {
          isError: false,
          output: input.answerOutput,
          toolCallId: input.payload.toolCallId,
          toolName: input.payload.toolName,
        },
      ],
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
