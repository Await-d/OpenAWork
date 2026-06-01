import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { parseBody } from '../infra/parse-request.js';
import { LayerCapabilityViolationError } from '../handoff/capability/layer-capabilities.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { logTeamAudit, type TeamAuditAction } from '../team/team-audit-store.js';

// L1.3 §1.3 反向消息通道载荷 schema（与 packages/web-client/src/team-inbound.ts 协议对齐）
const inboundSubmitSchema = z.object({
  messageType: z.enum([
    'cancel_signal',
    'pause_signal',
    'resume_signal',
    'clarification_answer',
    'user_input',
    'escalation_request',
    'progress_report',
  ]),
  // payload 由 messageType 决定形状；这里只校验是 object，具体 shape
  // 由消费方 LLM 循环解释（避免每次扩展类型都要改 schema）。
  payload: z.record(z.unknown()).optional(),
  clientIdempotencyKey: z.string().min(1).max(200).optional(),
  // 客户端可指定过期时间（毫秒 epoch），缺省由 inbound-store 按类型给默认 TTL
  expiresAt: z.number().int().positive().optional(),
});

const dismissClarificationSchema = z.object({
  answeredAt: z.number().int().positive().optional(),
});

type TeamInboundRouteErrorCode =
  | 'team_session_not_found'
  | 'team_clarification_not_found'
  | 'team_inbound_capability_violation'
  | 'team_inbound_submit_failed'
  | 'team_clarification_dismiss_failed';

const TEAM_INBOUND_ROUTE_ERROR_MESSAGES: Record<TeamInboundRouteErrorCode, string> = {
  team_session_not_found: '目标团队会话不存在。',
  team_clarification_not_found: '目标澄清问题不存在。',
  team_inbound_capability_violation: '当前层级不允许接收该消息。',
  team_inbound_submit_failed: '提交团队反向消息失败。',
  team_clarification_dismiss_failed: '忽略澄清问题失败。',
};

function teamInboundRouteErrorPayload(
  code: TeamInboundRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: TEAM_INBOUND_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

export async function teamInboundRoutes(app: FastifyInstance): Promise<void> {
  // ─── L1.3 §1.3 反向消息通道：POST /team/sessions/:sessionId/inbound-messages ───
  // 关联文档：docs/team-architecture-l1-3-streaming-handoff-spec.md §1.3
  // 关联实现：handoff/inbound-store.ts
  //
  // 用途：
  //   - team 用户回答 c 的 [NEEDS CLARIFICATION] → clarification_answer
  //   - team 用户中途追加输入 → user_input
  //   - 取消 / 暂停 / 恢复信号
  // 这条端点写入 session_inbound_messages 表，下游 session 在 LLM 循环中
  // 通过 consumePendingInboundMessage 拉取消费。
  app.post(
    '/team/sessions/:sessionId/inbound-messages',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const { step, child } = startRequestWorkflow(request, 'team.session.inbound', undefined, {
        sessionId,
      });
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(inboundSubmitSchema, request.body);
      parseStep.succeed();

      const sessionStep = child('resolve-session');
      const session = sqliteGet<{ id: string; user_id: string; role_layer: string | null }>(
        `SELECT id, user_id, role_layer FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );
      if (!session) {
        sessionStep.fail('session not found');
        step.fail('session not found');
        return reply.status(404).send(teamInboundRouteErrorPayload('team_session_not_found'));
      }
      sessionStep.succeed();

      const submitStep = child('submit-inbound');
      try {
        const { submitInboundMessage } = await import('../handoff/store/inbound-store.js');
        const expiresAtIso =
          typeof body.expiresAt === 'number'
            ? new Date(body.expiresAt).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
            : undefined;
        const result = submitInboundMessage({
          userId: user.sub,
          toSessionId: sessionId,
          // L1.4 capability：HTTP 入口的发送方语义。
          //   - 目标是 reception 会话 → 'user'（用户直接发到 b）
          //   - 目标是其他层会话 → 'reception'（b 代为转发用户的回答给 c/d/e/f/g）
          // 这与 layer-capabilities 矩阵的 canReceiveInboundFrom 对齐。
          fromRoleLayer: session.role_layer === 'reception' ? 'user' : 'reception',
          messageType: body.messageType,
          payload: body.payload ?? {},
          clientIdempotencyKey: body.clientIdempotencyKey ?? null,
          ...(expiresAtIso ? { expiresAt: expiresAtIso } : {}),
        });

        if (body.messageType === 'clarification_answer') {
          const questionId =
            typeof body.payload?.['questionId'] === 'string' ? body.payload['questionId'] : null;
          const answer =
            typeof body.payload?.['answer'] === 'string' ? body.payload['answer'] : null;
          const answeredAt =
            typeof body.payload?.['answeredAt'] === 'number'
              ? body.payload['answeredAt']
              : Date.now();
          if (questionId && answer) {
            try {
              const { resolveClarificationEscalationRequest } =
                await import('../handoff/store/inbound-store.js');
              resolveClarificationEscalationRequest({
                answer,
                answeredAt,
                questionId,
                status: 'answered',
                userId: user.sub,
              });
            } catch (err) {
              console.warn(
                `[team.session.inbound] resolve clarification(answered) failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
        submitStep.succeed(undefined, {
          messageId: result.record.id,
          reused: result.reused,
        });

        const isEscapeHatch =
          body.messageType === 'cancel_signal' ||
          body.messageType === 'pause_signal' ||
          body.messageType === 'resume_signal' ||
          body.messageType === 'escalation_request';
        if (isEscapeHatch && !result.reused) {
          const hatchType =
            body.messageType === 'escalation_request'
              ? '#1 escalation'
              : body.messageType === 'cancel_signal' || body.messageType === 'pause_signal'
                ? '#3 cancel/pause'
                : '#3 resume';
          try {
            logTeamAudit({
              action: 'escape_hatch_used' satisfies TeamAuditAction,
              actorEmail: user.email,
              actorUserId: user.sub,
              detail: JSON.stringify({
                hatchType,
                messageType: body.messageType,
                targetSessionId: sessionId,
                decisionSource: 'user',
              }),
              entityId: result.record.id,
              entityType: 'session_inbound_message',
              summary: `Escape hatch ${hatchType}: ${body.messageType} → session ${sessionId.slice(0, 8)}`,
              userId: user.sub,
            });
          } catch (err) {
            console.warn(
              `[team.session.inbound] audit log failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        if (body.messageType === 'user_input' && !result.reused) {
          const userInputText =
            typeof body.payload?.['text'] === 'string' ? body.payload['text'] : '';
          if (userInputText.trim().length > 0) {
            try {
              const { appendSessionMessageV2 } = await import('../message/message-v2-adapter.js');
              appendSessionMessageV2({
                sessionId,
                userId: user.sub,
                role: 'user',
                content: [{ type: 'text', text: userInputText }],
                clientRequestId: body.clientIdempotencyKey ?? null,
              });
            } catch (err) {
              console.warn(
                `[team.session.inbound] persist user msg failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }

        const shouldOrchestrate =
          !result.reused && session.role_layer === 'reception' && body.messageType === 'user_input';
        if (shouldOrchestrate) {
          const userInputText =
            typeof body.payload?.['text'] === 'string' ? body.payload['text'] : '';
          const sessionMeta = sqliteGet<{ metadata_json: string | null }>(
            `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
            [sessionId],
          );
          let teamWorkspaceIdFromMeta: string | null = null;
          if (sessionMeta?.metadata_json) {
            try {
              const parsed = JSON.parse(sessionMeta.metadata_json) as Record<string, unknown>;
              if (typeof parsed['teamWorkspaceId'] === 'string') {
                teamWorkspaceIdFromMeta = parsed['teamWorkspaceId'];
              }
            } catch (err) {
              void err;
            }
          }

          // 注意：不再在此处提前把 teamInit 标记为 skipped。
          // 周全性补强（§auto-init）：是否需要自动初始化由 orchestrateReceptionInput
          // 在 orchestrate 路径内部决定——只有判定为真任务时才先自动跑完初始化，
          // 闲聊 / 问候（direct/clarify）不触发，避免无谓等待。初始化产物会在
          // 编排内部从最新 teamInit 重新构建 context 注入，无需在这里拼。

          void (async () => {
            try {
              const { orchestrateReceptionInput } =
                await import('../handoff/runner/reception-orchestrator.js');
              await orchestrateReceptionInput({
                userId: user.sub,
                receptionSessionId: sessionId,
                userIntent: userInputText,
                teamWorkspaceId: teamWorkspaceIdFromMeta,
                clientIdempotencyKey: body.clientIdempotencyKey ?? null,
                // user 消息已在上面同步写过，避免重复写
                persistUserMessage: false,
              });
            } catch (err) {
              console.warn(
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `[team.session.inbound] orchestrate (async) failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              // 🔴#3 端到端健壮性：编排是 fire-and-forget（不阻塞 inbound 入库），
              // 但若它抛出**意料之外**的异常（orchestrateReceptionInput 正常会用
              // result.reason 兜底而不抛），用户会停留在"我发了消息但团队毫无回应"
              // 的静默态。这里补一条 best-effort 的 assistant 反馈消息，让用户知道
              // 需要重试，而不是无限等待。
              try {
                const { appendSessionMessageV2 } =
                  await import('../message/message-v2-adapter.js');
                appendSessionMessageV2({
                  sessionId,
                  userId: user.sub,
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: '抱歉，团队在处理你的请求时出现了意外错误，任务未能启动。请稍后重试。',
                    },
                  ],
                  clientRequestId: null,
                });
              } catch (ackErr) {
                console.warn(
                  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                  `[team.session.inbound] orchestrate failure ack write failed: ${ackErr instanceof Error ? ackErr.message : String(ackErr)}`,
                );
              }
            }
          })();
        }

        step.succeed(undefined, { messageId: result.record.id });

        try {
          const { recordLatency } = await import('../handoff/bus/latency-monitor.js');
          const requestStartMs = (request as unknown as { startTime?: number }).startTime;
          if (typeof requestStartMs === 'number') {
            recordLatency('a_to_b_ack', Date.now() - requestStartMs, user.sub);
          }
        } catch (err) {
          void err;
        }

        return reply.status(result.reused ? 200 : 201).send({
          messageId: result.record.id,
          createdAt: result.record.createdAt,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'inbound submit failed';
        submitStep.fail(reason);
        step.fail(reason);
        if (err instanceof LayerCapabilityViolationError) {
          return reply.status(400).send(
            teamInboundRouteErrorPayload('team_inbound_capability_violation', {
              detail: reason,
            }),
          );
        }
        request.log.error({ err }, '[team.session.inbound] submit failed');
        return reply.status(500).send(teamInboundRouteErrorPayload('team_inbound_submit_failed'));
      }
    },
  );

  app.post(
    '/team/sessions/:sessionId/clarifications/:questionId/dismiss',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.session.clarification.dismiss');
      const user = request.user as JwtPayload;
      const { sessionId, questionId } = request.params as { questionId: string; sessionId: string };

      const sessionStep = child('resolve-session');
      const session = sqliteGet<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1`,
        [sessionId, user.sub],
      );
      if (!session) {
        sessionStep.fail('session not found');
        step.fail('session not found');
        return reply.status(404).send(teamInboundRouteErrorPayload('team_session_not_found'));
      }
      sessionStep.succeed();

      const parseStep = child('parse-body');
      const body = parseBody(dismissClarificationSchema, request.body ?? {});
      parseStep.succeed();

      const dismissStep = child('dismiss-clarification');
      try {
        const { resolveClarificationEscalationRequest } =
          await import('../handoff/store/inbound-store.js');
        const resolved = resolveClarificationEscalationRequest({
          answeredAt: body.answeredAt ?? Date.now(),
          questionId,
          status: 'dismissed',
          userId: user.sub,
        });
        if (!resolved) {
          dismissStep.fail('clarification not found');
          step.fail('clarification not found');
          return reply
            .status(404)
            .send(teamInboundRouteErrorPayload('team_clarification_not_found'));
        }
        dismissStep.succeed(undefined, { messageId: resolved.id });
        step.succeed(undefined, { questionId, sessionId });
        return reply.status(200).send({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'dismiss clarification failed';
        dismissStep.fail(reason);
        step.fail(reason);
        request.log.error({ err }, '[team.session.clarification.dismiss] failed');
        return reply
          .status(500)
          .send(teamInboundRouteErrorPayload('team_clarification_dismiss_failed'));
      }
    },
  );
}
