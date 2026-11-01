import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { memoryRuleDraftSchema, type MemoryScope } from '@openAwork/agent-core';
import { createMemoryProposal } from '../memory/governance/memory-proposal-store.js';
import {
  deleteMemoryRule,
  getMemoryRuleByName,
  listMemoryRules,
  setMemoryRuleEnabled,
} from '../memory/governance/memory-rule-store.js';
import { scanMemoryWriteContent } from '../memory/memory-security-scanner.js';
import { z } from 'zod';

/**
 * 结构化规则路由（261101-记忆确认写入与周期整理）。
 *
 * 规则以 DB 为权威来源。这里的**方向性**是刻意的：
 * - **扩宽**（新增规则 / 改内容 / 重新启用）→ 只产生 `action:'rule'` 提议，必须用户确认；
 * - **收窄**（停用 / 删除）→ 由 owner 直接执行，不要求二次确认。
 *
 * 理由：收窄只会降低规则的影响面，如果连撤销都要先走确认，用户在最需要「立刻止血」
 * 的时候反而被卡住。这与仓库里会话扩展「撤权只收窄、启用须重新提案」的既有先例一致。
 */

type MemoriesRuleErrorCode =
  | 'memory_rule_not_found'
  | 'memory_rule_write_blocked'
  | 'memory_rule_proposal_failed'
  | 'memory_rule_scope_forbidden'
  | 'memory_rule_conflict';

const MEMORIES_RULE_ERROR_MESSAGES: Record<MemoriesRuleErrorCode, string> = {
  memory_rule_not_found: '目标规则不存在。',
  memory_rule_write_blocked: '规则内容未通过安全校验。',
  memory_rule_proposal_failed: '规则提议提交失败。',
  memory_rule_scope_forbidden: '无权在该作用域下管理规则。',
  memory_rule_conflict: '规则已被修改，请刷新后重试。',
};

function ruleErrorPayload(
  code: MemoriesRuleErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { code, error: MEMORIES_RULE_ERROR_MESSAGES[code], ...(extra ?? {}) };
}

/** 用户作用域校验归属；其余沿用现有格式边界，规则行仍按 user_id 隔离。 */
function isScopeOwnedByUser(userId: string, scope: MemoryScope): boolean {
  switch (scope.type) {
    case 'user':
      return scope.id === userId;
    case 'workspace':
    case 'team':
      return scope.id.trim().length > 0;
    case 'channel_chat':
      return scope.id.startsWith('channel:') && scope.id.includes(':chat:');
    default:
      return false;
  }
}

const ruleListQuerySchema = z.object({
  scopeType: z.enum(['user', 'workspace', 'team', 'channel_chat']).optional(),
  scopeId: z.string().trim().min(1).max(500).optional(),
});

export async function memoriesRulesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/memories/rules',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.rules.list');
      const user = request.user as JwtPayload;
      const query = request.query as Record<string, unknown>;
      const parsed = ruleListQuerySchema.safeParse(query);
      if (!parsed.success) {
        step.fail('memory_rule_scope_forbidden');
        return reply.status(400).send(ruleErrorPayload('memory_rule_scope_forbidden'));
      }

      const scopeFilter =
        parsed.data.scopeType && parsed.data.scopeId
          ? { type: parsed.data.scopeType, id: parsed.data.scopeId }
          : undefined;
      const rules = listMemoryRules(user.sub, scopeFilter);
      step.succeed(undefined, { count: rules.length });
      return reply.send({ rules });
    },
  );

  app.post(
    '/memories/rules',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.rules.propose');
      const user = request.user as JwtPayload;
      const body = parseBody(memoryRuleDraftSchema, request.body);

      if (!isScopeOwnedByUser(user.sub, body.scope)) {
        step.fail('memory_rule_scope_forbidden');
        return reply.status(403).send(ruleErrorPayload('memory_rule_scope_forbidden'));
      }

      for (const [field, content] of [
        ['name', body.name],
        ['body', body.body],
      ] as const) {
        const scan = scanMemoryWriteContent(content);
        if (!scan.ok) {
          step.fail('memory_rule_write_blocked');
          return reply.status(400).send(
            ruleErrorPayload('memory_rule_write_blocked', {
              field,
              threat: scan.threat,
              reason: scan.reason,
            }),
          );
        }
      }

      const current = getMemoryRuleByName(user.sub, body.scope, body.name);
      const revision = current?.revision ?? 0;
      if (body.expectedRevision !== undefined && body.expectedRevision !== revision) {
        step.fail('memory_rule_conflict');
        return reply.status(409).send(ruleErrorPayload('memory_rule_conflict'));
      }
      const result = createMemoryProposal({
        userId: user.sub,
        action: 'rule',
        scope: body.scope,
        payload: {
          name: body.name,
          body: body.body,
          ...(current ? { ruleId: current.id } : {}),
          ruleRevision: revision,
        },
        origin: 'api',
        reason: '结构化规则变更（待确认）。',
      });

      if (result.outcome !== 'created' || !result.proposal) {
        step.fail('memory_rule_proposal_failed');
        return reply
          .status(400)
          .send(ruleErrorPayload('memory_rule_proposal_failed', { outcome: result.outcome }));
      }

      step.succeed(undefined, { proposalId: result.proposal.id });
      return reply.status(202).send({
        status: 'pending_confirmation',
        proposalId: result.proposal.id,
        message: '已提交待确认的规则提议；确认前规则不会生效。',
        scope: body.scope,
      });
    },
  );

  app.post(
    '/memories/rules/:ruleId/disable',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.rules.disable');
      const user = request.user as JwtPayload;
      const { ruleId } = request.params as { ruleId: string };

      // 收窄：停用立即生效，不要求二次确认（撤销必须比生效更容易）。
      const ok = setMemoryRuleEnabled({ userId: user.sub, ruleId, enabled: false });
      if (!ok) {
        step.fail('memory_rule_not_found');
        return reply.status(404).send(ruleErrorPayload('memory_rule_not_found'));
      }
      step.succeed(undefined, { ruleId });
      return reply.send({ ok: true, enabled: false });
    },
  );

  app.delete(
    '/memories/rules/:ruleId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.rules.delete');
      const user = request.user as JwtPayload;
      const { ruleId } = request.params as { ruleId: string };

      // 同为收窄：删除直接执行。
      const ok = deleteMemoryRule(user.sub, ruleId);
      if (!ok) {
        step.fail('memory_rule_not_found');
        return reply.status(404).send(ruleErrorPayload('memory_rule_not_found'));
      }
      step.succeed(undefined, { ruleId });
      return reply.send({ ok: true });
    },
  );
}
