import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { parseBody } from '../infra/parse-request.js';
import { LayerCapabilityViolationError } from '../handoff/capability/layer-capabilities.js';
import { publishTeamEvent } from '../handoff/bus/team-events-bus.js';
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

const INBOUND_EVENT_PREVIEW_MAX_LENGTH = 160;

function buildInboundTextPreview(
  messageType: string,
  payload: Record<string, unknown> | undefined,
): string | null {
  if (messageType !== 'user_input' && messageType !== 'clarification_answer') {
    return null;
  }
  const text = typeof payload?.['text'] === 'string' ? payload['text'].trim() : '';
  if (text.length === 0) {
    return null;
  }
  return text.length > INBOUND_EVENT_PREVIEW_MAX_LENGTH
    ? `${text.slice(0, INBOUND_EVENT_PREVIEW_MAX_LENGTH)}...`
    : text;
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
        return reply.status(404).send({ error: 'Session not found' });
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
        submitStep.succeed(undefined, {
          messageId: result.record.id,
          reused: result.reused,
        });

        if (!result.reused) {
          const textPreview = buildInboundTextPreview(body.messageType, body.payload);
          publishTeamEvent({
            type: 'session.inbound.submitted',
            sessionId,
            layer: result.record.fromRoleLayer,
            timestamp: Date.now(),
            payload: {
              messageId: result.record.id,
              toSessionId: result.record.toSessionId,
              messageType: result.record.messageType,
              fromRoleLayer: result.record.fromRoleLayer,
              reused: false,
              ...(textPreview ? { textPreview } : {}),
            },
            userId: user.sub,
          });
        }

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
                `[team.session.inbound] orchestrate (async) failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          })();
        }

        step.succeed(undefined, { messageId: result.record.id });

        try {
          const { recordLatency } = await import('../handoff/bus/latency-monitor.js');
          const requestStartMs = (request as unknown as { startTime?: number }).startTime;
          if (typeof requestStartMs === 'number') {
            recordLatency('a_to_b_ack', Date.now() - requestStartMs);
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
          return reply.status(400).send({ error: reason });
        }
        return reply.status(500).send({ error: reason });
      }
    },
  );
}
