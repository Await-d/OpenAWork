import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  canConfirmMemoryProposal,
  type MemoryProposalActor,
} from '../memory/governance/memory-authorization.js';
import {
  commitMemoryProposal,
  rejectMemoryProposal,
  rollbackMemoryRevision,
} from '../memory/governance/memory-commit-service.js';
import {
  countPendingMemoryProposals,
  getMemoryProposal,
  listMemoryProposals,
  listMemoryProposalRelations,
} from '../memory/governance/memory-proposal-store.js';
import { memoryProposalDecisionSchema, type MemoryEntry } from '@openAwork/agent-core';
import { sqliteAll, sqliteGet } from '../infra/db.js';

/**
 * 记忆提议确认路由（261101-记忆确认写入与周期整理）。
 *
 * 这是**唯一的正式记忆写入门**：自动抽取 / 工具 / 团队初始化产生的提议都在这里由
 * 用户显式批准（`approve`）或拒绝（`reject`）。所有路由都先过 `requireAuth`，
 * actor 一律取 JWT `user.sub`，并且必须通过 `canConfirmMemoryProposal` 判定——
 * 非本人一律 403（fail-closed）。
 */

type MemoriesProposalErrorCode =
  | 'memory_proposal_not_found'
  | 'memory_proposal_forbidden'
  | 'memory_proposal_conflict'
  | 'memory_proposal_expired'
  | 'memory_proposal_decision_failed'
  | 'memory_revision_not_found'
  | 'memory_revision_rollback_failed';

const MEMORIES_PROPOSAL_ERROR_MESSAGES: Record<MemoriesProposalErrorCode, string> = {
  memory_proposal_not_found: '目标记忆提议不存在。',
  memory_proposal_forbidden: '无权处理该记忆提议。',
  memory_proposal_conflict: '记忆已被修改，请刷新后重新确认。',
  memory_proposal_expired: '该记忆提议已过期，请重新发起。',
  memory_proposal_decision_failed: '记忆提议处理失败。',
  memory_revision_not_found: '目标记忆历史版本不存在。',
  memory_revision_rollback_failed: '记忆回滚失败。',
};

type ProposalErrorExtra = Record<string, string | number | boolean>;

function proposalErrorPayload(
  code: MemoriesProposalErrorCode,
  extra?: ProposalErrorExtra,
): Record<string, unknown> {
  return {
    code,
    error: MEMORIES_PROPOSAL_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

const proposalListQuerySchema = z.object({
  status: z
    .enum(['pending', 'applied', 'rejected', 'expired', 'conflicted', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const revisionListQuerySchema = z.object({
  memoryId: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

interface MemoryRevisionRow {
  id: string;
  memory_id: string;
  user_id: string;
  revision: number;
  operation: string;
  before_json: string | null;
  after_json: string | null;
  proposal_id: string | null;
  actor_kind: string;
  actor_id: string | null;
  created_at: string;
}

const revisionSnapshotSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    key: z.string(),
    value: z.string(),
    enabled: z.boolean(),
    changeSeq: z.number().int().nonnegative().optional(),
  })
  .passthrough();

function readRevisionSnapshot(
  json: string | null,
  row: MemoryRevisionRow,
): MemoryEntry | null | undefined {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const result = revisionSnapshotSchema.safeParse(parsed);
  if (!result.success || result.data.userId !== row.user_id || result.data.id !== row.memory_id) {
    return undefined;
  }
  return result.data as unknown as MemoryEntry;
}

function revisionResponse(row: MemoryRevisionRow): Record<string, unknown> | null {
  const before = readRevisionSnapshot(row.before_json, row);
  const after = readRevisionSnapshot(row.after_json, row);
  if (before === undefined || after === undefined) return null;
  const changeSeq = after?.changeSeq ?? before?.changeSeq;
  const origin =
    row.actor_kind === 'maintenance'
      ? 'periodic'
      : row.actor_kind === 'channel'
        ? 'channel'
        : row.proposal_id !== null
          ? 'proposal'
          : 'manual';
  return {
    id: row.id,
    memoryId: row.memory_id,
    revision: row.revision,
    operation: row.operation,
    proposalId: row.proposal_id,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    origin,
    createdAt: row.created_at,
    ...(changeSeq !== undefined ? { changeSeq } : {}),
    before,
    after,
    payload: before,
  };
}

/** 由 JWT 构造提议 actor。路由层恒为 `user`（维护任务不经路由确认提议）。 */
function proposalActor(userId: string): MemoryProposalActor {
  return { userId, kind: 'user' };
}

/**
 * 提议的归属用户（不按调用方过滤）。
 *
 * 与 `getMemoryProposal(userId, ...)` 的差别：后者对本用户之外一律返回 undefined，
 * 从而把「别人的提议」和「不存在的提议」混成同一个 404。要正确区分 403（存在但非
 * 本人）与 404（根本不存在），必须先无过滤地确认提议是否存在。
 */
function readProposalOwnerId(proposalId: string): string | undefined {
  return sqliteGet<{ user_id: string }>(
    'SELECT user_id FROM memory_proposals WHERE id = ? LIMIT 1',
    [proposalId],
  )?.user_id;
}

/**
 * 解析提议归属并做基础授权判定。
 *
 * 返回 `null` 表示提议存在且属于该用户（可继续处理）；否则返回应直接发送的 HTTP
 * 状态与错误码。区分 404（不存在）与 403（存在但非本人）是刻意的：把越权尝试当成
 * 「不存在」会让用户以为自己点错了，掩盖真实的安全事件。
 */
function rejectNonOwnerProposal(
  userId: string,
  proposalId: string,
): { http: number; code: MemoriesProposalErrorCode } | null {
  const ownerId = readProposalOwnerId(proposalId);
  if (!ownerId) {
    return { http: 404, code: 'memory_proposal_not_found' };
  }
  if (ownerId !== userId) {
    return { http: 403, code: 'memory_proposal_forbidden' };
  }
  return null;
}

/** 提议 + 关系（供详情与列表复用）。 */
function withRelations(
  userId: string,
  proposal: ReturnType<typeof listMemoryProposals>[number],
): Record<string, unknown> {
  return {
    ...proposal,
    relations: listMemoryProposalRelations(userId, proposal),
  };
}

export async function memoriesProposalsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/memories/proposals/pending/count',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.proposals.pendingCount');
      const user = request.user as JwtPayload;
      const count = countPendingMemoryProposals(user.sub);
      step.succeed(undefined, { count });
      return reply.send({ count });
    },
  );

  app.get(
    '/memories/proposals',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.proposals.list');
      const user = request.user as JwtPayload;
      const query = parseQuery(proposalListQuerySchema, request.query);

      const proposals = listMemoryProposals(user.sub, {
        ...(query.status !== undefined ? { status: [query.status] } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      });
      step.succeed(undefined, { count: proposals.length });
      return reply.send({
        proposals: proposals.map((proposal) => withRelations(user.sub, proposal)),
      });
    },
  );

  app.get(
    '/memories/revisions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.revisions.list');
      const user = request.user as JwtPayload;
      const query = parseQuery(revisionListQuerySchema, request.query);
      const limit = query.limit ?? 50;

      const rows = sqliteAll<MemoryRevisionRow>(
        `SELECT id, memory_id, user_id, revision, operation, before_json, after_json,
                proposal_id, actor_kind, actor_id, created_at
         FROM memory_revisions
         WHERE user_id = ? AND memory_id = ?
         ORDER BY revision DESC, created_at DESC
         LIMIT ?`,
        [user.sub, query.memoryId, limit],
      );
      step.succeed(undefined, { count: rows.length });
      return reply.send({
        revisions: rows.map(revisionResponse).filter((revision) => revision !== null),
      });
    },
  );

  app.post(
    '/memories/revisions/:revisionId/rollback',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.revisions.rollback');
      const user = request.user as JwtPayload;
      const { revisionId } = request.params as { revisionId: string };

      const result = rollbackMemoryRevision({
        userId: user.sub,
        actorId: user.sub,
        revisionId,
      });
      if (!result.ok) {
        step.fail('memory_revision_rollback_failed');
        return reply.status(result.error?.includes('不存在') ? 404 : 400).send(
          proposalErrorPayload('memory_revision_rollback_failed', {
            detail: result.error ?? '',
          }),
        );
      }
      step.succeed(undefined, { memoryId: result.memory?.id ?? '' });
      return reply.send({ ok: true, memory: result.memory });
    },
  );

  app.get(
    '/memories/proposals/:proposalId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.proposals.get');
      const user = request.user as JwtPayload;
      const { proposalId } = request.params as { proposalId: string };

      const rejected = rejectNonOwnerProposal(user.sub, proposalId);
      if (rejected) {
        step.fail(rejected.code);
        return reply.status(rejected.http).send(proposalErrorPayload(rejected.code));
      }
      const proposal = getMemoryProposal(user.sub, proposalId);
      if (!proposal) {
        step.fail('memory_proposal_not_found');
        return reply.status(404).send(proposalErrorPayload('memory_proposal_not_found'));
      }
      step.succeed(undefined, { proposalId });
      return reply.send({ proposal: withRelations(user.sub, proposal) });
    },
  );

  app.post(
    '/memories/proposals/:proposalId/decision',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.proposals.decision');
      const user = request.user as JwtPayload;
      const { proposalId } = request.params as { proposalId: string };

      const rejected = rejectNonOwnerProposal(user.sub, proposalId);
      if (rejected) {
        step.fail(rejected.code);
        return reply.status(rejected.http).send(proposalErrorPayload(rejected.code));
      }
      const proposal = getMemoryProposal(user.sub, proposalId);
      if (!proposal) {
        step.fail('memory_proposal_not_found');
        return reply.status(404).send(proposalErrorPayload('memory_proposal_not_found'));
      }
      // 归属检查之后再过授权门（pending 状态 / 未过期）。
      if (!canConfirmMemoryProposal(proposalActor(user.sub), proposal)) {
        step.fail('memory_proposal_forbidden');
        return reply.status(403).send(proposalErrorPayload('memory_proposal_forbidden'));
      }

      const decision = parseBody(memoryProposalDecisionSchema, request.body);

      if (decision.decision === 'approve') {
        const result = commitMemoryProposal({
          userId: user.sub,
          proposalId,
          decidedBy: user.sub,
          note: decision.note ?? null,
          overridePayload: decision.payload ?? null,
          expectedRevision: decision.expectedRevision ?? null,
        });
        if (!result.ok) {
          const status = mapCommitFailureStatus(result.error);
          step.fail(status.code);
          return reply.status(status.http).send(
            proposalErrorPayload(status.code, {
              detail: result.error ?? '',
            }),
          );
        }
        step.succeed(undefined, { memoryId: result.memory?.id ?? '' });
        return reply.send({ ok: true, memory: result.memory });
      }

      const result = rejectMemoryProposal({
        userId: user.sub,
        proposalId,
        decidedBy: user.sub,
        note: decision.note ?? null,
        keepOriginal: decision.keepOriginal ?? false,
      });
      if (!result.ok) {
        step.fail('memory_proposal_decision_failed');
        return reply.status(400).send(
          proposalErrorPayload('memory_proposal_decision_failed', {
            detail: result.error ?? '',
          }),
        );
      }
      step.succeed(undefined, { proposalId });
      return reply.send({ ok: true, rejected: true });
    },
  );
}

/**
 * 提交失败原因 → HTTP 状态与错误码。
 *
 * `commitMemoryProposal` 只回字符串原因（契约如此），这里按关键字归类：不存在 → 404、
 * 冲突 → 409、过期 → 410、其余 → 400。归类只影响响应形状，不影响提交器的判定。
 */
function mapCommitFailureStatus(error: string | undefined): {
  http: number;
  code: MemoriesProposalErrorCode;
} {
  const detail = error ?? '';
  if (detail.includes('不存在')) {
    return { http: 404, code: 'memory_proposal_not_found' };
  }
  if (detail.includes('过期')) {
    return { http: 410, code: 'memory_proposal_expired' };
  }
  if (detail.includes('冲突') || detail.includes('已被')) {
    return { http: 409, code: 'memory_proposal_conflict' };
  }
  return { http: 400, code: 'memory_proposal_decision_failed' };
}
