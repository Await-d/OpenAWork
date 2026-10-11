import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CommandExecutionResult, Message } from '@openAwork/shared';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteGet } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { resolveTaskGraphProjectRoot } from '../task/task-graph-root.js';
import { buildCommandDescriptors } from './command-descriptors.js';
import { taskManager } from './command-executors.js';
import { extractCommandArgs } from './command-args.js';
import { executeCompactCommand, requireCompactionSummary } from './compact-command.js';
import { executeHandoffCommand } from './handoff-command.js';
import { executeInitDeepCommand } from './init-deep-command.js';
import {
  executeCancelRalphCommand,
  executeRalphLoopCommand,
  executeStopContinuationCommand,
  executeUlwLoopCommand,
} from './loop-commands.js';
import { executeUlwVerifyCommand } from './ulw-verify-command.js';
import { executeRefactorCommand, executeRemoveDeadcodeCommand } from './code-workflow-commands.js';
import {
  executeStartWorkCommand,
  executeStartWorkDoneClaimCommand,
  executeStartWorkReviewCommand,
} from './start-work-commands.js';
import { findLatestWorkflowPlan, findMatchingWorkflowPlan } from './workflow-plan-context.js';

const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolCallContentSchema = z.object({
  type: z.literal('tool_call'),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.record(z.unknown()),
});

const toolResultContentSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string(),
  toolName: z.string().optional(),
  output: z.unknown(),
  isError: z.boolean(),
});

const messageSnapshotSchema = z.object({
  id: z.string(),
  // `synthetic` is a gateway-injected role (subagent completion delivery back
  // into the parent session). Accepting it here keeps this execute-command
  // snapshot boundary aligned with the server-side message semantics instead
  // of rejecting gateway-authored snapshots with a 400.
  role: z.enum(['user', 'assistant', 'tool', 'system', 'synthetic']),
  content: z.array(z.union([textContentSchema, toolCallContentSchema, toolResultContentSchema])),
  createdAt: z.number(),
});

const executeCommandSchema = z.object({
  commandId: z.string().min(1),
  executionId: z.string().trim().min(1).max(128).optional(),
  messages: z.array(messageSnapshotSchema).optional(),
  rawInput: z.string().trim().min(1).optional(),
});

function normalizeMessageSnapshots(
  messages: Array<z.infer<typeof messageSnapshotSchema>>,
): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: message.content.map((content) => {
      if (content.type === 'text') {
        return content;
      }
      if (content.type === 'tool_call') {
        return content;
      }
      return {
        type: 'tool_result' as const,
        toolCallId: content.toolCallId,
        toolName: content.toolName,
        output: content.output,
        isError: content.isError,
      };
    }),
  }));
}

export async function commandsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/commands',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'command.list');
      const commands = buildCommandDescriptors();
      step.succeed(undefined, { count: commands.length });
      return reply.send({ commands });
    },
  );

  app.post(
    '/sessions/:sessionId/commands/execute',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'command.execute', undefined, { sessionId });
      const body = parseBody(executeCommandSchema, request.body);

      const session = sqliteGet<{ id: string; user_id: string; metadata_json: string }>(
        'SELECT id, user_id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );

      if (!session) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const command = buildCommandDescriptors().find((item) => item.id === body.commandId);
      if (!command || command.execution !== 'server') {
        throw ApiError.badRequest('不支持的命令。');
      }

      const storedMessages = listSessionMessagesV2({
        sessionId,
        userId: user.sub,
      });
      const messages =
        storedMessages.length > 0
          ? storedMessages
          : body.messages
            ? normalizeMessageSnapshots(body.messages)
            : storedMessages;
      const graph = await taskManager.loadOrCreate(
        resolveTaskGraphProjectRoot(sessionId),
        sessionId,
      );

      const cmdParams = {
        args: extractCommandArgs(body.rawInput, command.label),
        commandId: command.id,
        executionId: body.executionId,
        graph,
        messages,
        metadataJson: session.metadata_json,
        rawInput: body.rawInput,
        sessionId,
        userId: user.sub,
      };

      let result: CommandExecutionResult;
      switch (command.action.kind) {
        case 'compact_session':
          result = await executeCompactCommand(cmdParams);
          break;
        case 'init_deep':
          result = await executeInitDeepCommand(cmdParams);
          break;
        case 'start_ralph_loop':
          result = await executeRalphLoopCommand(cmdParams);
          break;
        case 'start_ulw_loop':
          result = await executeUlwLoopCommand(cmdParams);
          break;
        case 'verify_ulw_loop':
          result = await executeUlwVerifyCommand(cmdParams);
          break;
        case 'cancel_ralph_loop':
          result = await executeCancelRalphCommand(cmdParams);
          break;
        case 'stop_continuation':
          result = await executeStopContinuationCommand(cmdParams);
          break;
        case 'refactor_session':
          result = await executeRefactorCommand(cmdParams);
          break;
        case 'remove_deadcode':
          result = await executeRemoveDeadcodeCommand(cmdParams);
          break;
        case 'start_work':
          result = await executeStartWorkCommand(cmdParams);
          break;
        case 'submit_start_work_done_claim':
          result = await executeStartWorkDoneClaimCommand(cmdParams);
          break;
        case 'review_start_work_done_claim':
          result = await executeStartWorkReviewCommand(cmdParams);
          break;
        case 'generate_handoff':
          result = await executeHandoffCommand(cmdParams);
          break;
        default:
          throw ApiError.badRequest('不支持的命令动作。');
      }

      step.succeed(undefined, { commandId: command.id });
      return reply.send({ result });
    },
  );
}

export const __testing = {
  requireCompactionSummary,
  executeStartWorkDoneClaimCommand,
  executeStartWorkReviewCommand,
  findLatestWorkflowPlan,
  findMatchingWorkflowPlan,
  messageSnapshotSchema,
};
