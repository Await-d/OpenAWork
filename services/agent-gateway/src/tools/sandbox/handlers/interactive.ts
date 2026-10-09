/**
 * interactive 域 handler(261009-tool-sandbox 拆分 P2 / T-11)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * skill / question / enter_plan_mode / exit_plan_mode 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import { isPlanModeToolEnabledForSessionMetadata } from '../../../session/session-tool-visibility.js';
import { getEffectiveSkillsForSession } from '../../../skill/skill-selection-context.js';
import { createSkillTool } from '../../../skill/skill-tools.js';
import {
  buildExitPlanModeQuestionInput,
  enterPlanModeToolDefinition,
  exitPlanModeToolDefinition,
} from '../../plan-mode-tools.js';
import { buildQuestionRequestTitle, questionToolDefinition } from '../../question-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import {
  createPendingQuestionRequest,
  findPendingQuestionRequest,
  updatePendingQuestionPayload,
} from '../permission-ladder.js';
import {
  getSessionMetadata,
  getSessionOwnerUserId,
  isPlanModeEnabled,
  updateSessionMetadata,
} from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleSkillTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const effective = getEffectiveSkillsForSession(sessionId) ?? undefined;
  const skillTool = createSkillTool(sessionId, userId, { effective });
  const parsed = skillTool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const output = await skillTool.execute(parsed.data, signal);
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output,
    isError: false,
    durationMs: 0,
  };
}

export async function handleQuestionTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext, observability } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const parsed = questionToolDefinition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const payload =
    executionContext?.clientRequestId &&
    executionContext.requestData &&
    typeof executionContext.nextRound === 'number'
      ? {
          clientRequestId: executionContext.clientRequestId,
          nextRound: executionContext.nextRound,
          requestData: executionContext.requestData,
          toolCallId: request.toolCallId,
          rawInput,
          ...(observability ? { observability } : {}),
        }
      : undefined;
  const title = buildQuestionRequestTitle(parsed.data);
  const existingPending = findPendingQuestionRequest(sessionId, title);
  const requestId = existingPending
    ? existingPending
    : createPendingQuestionRequest({
        sessionId,
        userId,
        title,
        questionsJson: JSON.stringify(parsed.data.questions),
        payload,
      });
  if (existingPending && payload) {
    updatePendingQuestionPayload(existingPending, payload);
  }

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: existingPending
      ? `Question request ${requestId} is still pending. Ask the user to answer it, then resume the session.`
      : `Question request ${requestId} has been created. Ask the user to answer it, then resume the session.`,
    isError: true,
    durationMs: 0,
    pendingPermissionRequestId: requestId,
  };
}

export async function handleEnterPlanModeTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const parsed = enterPlanModeToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const metadata = getSessionMetadata(sessionId);
  if (!isPlanModeToolEnabledForSessionMetadata(metadata)) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: 'EnterPlanMode is not available in this session context.',
      isError: true,
      durationMs: 0,
    };
  }
  if (isPlanModeEnabled(metadata)) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output:
        'Plan mode is already active. Continue refining the plan until you are ready to request approval.',
      isError: false,
      durationMs: 0,
    };
  }

  updateSessionMetadata(sessionId, { ...metadata, planMode: true });
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output:
      'Entered plan mode. Stay in read-first planning until the user approves leaving plan mode.',
    isError: false,
    durationMs: 0,
  };
}

export async function handleExitPlanModeTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext, observability } = ctx;
  const userId = getSessionOwnerUserId(sessionId);
  if (!userId) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: `Session owner not found for session ${sessionId}`,
      isError: true,
      durationMs: 0,
    };
  }

  const parsed = exitPlanModeToolDefinition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }

  const metadata = getSessionMetadata(sessionId);
  if (!isPlanModeToolEnabledForSessionMetadata(metadata)) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: 'ExitPlanMode is not available in this session context.',
      isError: true,
      durationMs: 0,
    };
  }
  if (!isPlanModeEnabled(metadata)) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: 'You are not in plan mode. Call EnterPlanMode before requesting plan approval.',
      isError: true,
      durationMs: 0,
    };
  }

  const payload =
    executionContext?.clientRequestId &&
    executionContext.requestData &&
    typeof executionContext.nextRound === 'number'
      ? {
          clientRequestId: executionContext.clientRequestId,
          nextRound: executionContext.nextRound,
          requestData: executionContext.requestData,
          toolCallId: request.toolCallId,
          rawInput,
          ...(observability ? { observability } : {}),
        }
      : undefined;

  const questionInput = buildExitPlanModeQuestionInput(parsed.data);
  const title = 'Exit plan mode';
  const existingPending = findPendingQuestionRequest(sessionId, title);
  const requestId = existingPending
    ? existingPending
    : createPendingQuestionRequest({
        sessionId,
        userId,
        toolName: exitPlanModeToolDefinition.name,
        title,
        questionsJson: JSON.stringify(questionInput.questions),
        payload,
      });
  if (existingPending && payload) {
    updatePendingQuestionPayload(existingPending, payload);
  }

  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: existingPending
      ? `Plan approval request ${requestId} is still pending. Ask the user to answer it, then resume the session.`
      : `Plan approval request ${requestId} has been created. Ask the user to answer it, then resume the session.`,
    isError: true,
    durationMs: 0,
    pendingPermissionRequestId: requestId,
  };
}
