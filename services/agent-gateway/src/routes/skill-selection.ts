import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  DEFAULT_WORKSPACE_PATH_KEY,
  normalizeWorkspacePathForWrite,
  resolveEffectiveSkills,
  type EffectiveSkill,
} from '../skill/skill-selection.js';
import { BUILTIN_SKILLS } from '@openAwork/skills';

const BUILTIN_SKILL_IDS = new Set(BUILTIN_SKILLS.map((entry) => entry.manifest.id));

const selectionItemSchema = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean(),
  pinned: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});
import { parseBody } from '../infra/parse-request.js';

const putSelectionSchema = z.object({
  workspacePath: z.string().nullable().optional(),
  items: z.array(selectionItemSchema).max(500),
});

const sessionOverrideItemSchema = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean(),
  pinned: z.boolean().optional(),
});

const patchSessionOverrideSchema = z.object({
  items: z.array(sessionOverrideItemSchema).max(500),
});

interface WorkspaceSelectionRow {
  skill_id: string;
  enabled: number;
  pinned: number;
  reason: string | null;
  source: string;
  updated_at: number;
  /** Lower = renders first / truncated last; ties broken by skill_id ASC. */
  priority: number;
}

interface SessionOverrideRow {
  skill_id: string;
  enabled: number;
  pinned: number | null;
  updated_at: number;
}

interface SessionOwnershipRow {
  user_id: string;
  workspace_id: string | null;
  metadata_json: string | null;
}

function extractSessionWorkspacePath(session: SessionOwnershipRow | undefined): string | null {
  if (!session) return null;
  if (session.workspace_id) return session.workspace_id;
  if (!session.metadata_json) return null;
  try {
    const parsed = JSON.parse(session.metadata_json) as { workingDirectory?: unknown };
    return typeof parsed.workingDirectory === 'string' ? parsed.workingDirectory : null;
  } catch {
    return null;
  }
}

function serializeEffective(effective: EffectiveSkill[]): Array<{
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  origin: EffectiveSkill['origin'];
  reason?: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
}> {
  return effective.map((entry) => ({
    skillId: entry.skillId,
    enabled: entry.enabled,
    pinned: entry.pinned,
    origin: entry.origin,
    reason: entry.reason,
    displayName: entry.manifest?.displayName ?? entry.manifest?.name,
    description: entry.manifest?.description,
    capabilities: entry.manifest?.capabilities,
  }));
}

export async function skillSelectionRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET current effective set + raw workspace + raw session overrides ───
  app.get(
    '/skills/selection',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.selection.get');
      const user = request.user as JwtPayload;
      const query = request.query as { workspacePath?: string; sessionId?: string };

      const normalized = normalizeWorkspacePathForWrite(query.workspacePath ?? null);
      if (normalized === null) {
        step.fail('workspace path out of root');
        return reply
          .status(400)
          .send({ error: 'workspacePath 必须位于已配置的工作区根目录内。' });
      }

      const sessionId = query.sessionId ?? null;
      if (sessionId) {
        const session = sqliteGet<SessionOwnershipRow>(
          'SELECT user_id, workspace_id, metadata_json FROM sessions WHERE id = ?',
          [sessionId],
        );
        if (!session || session.user_id !== user.sub) {
          step.fail('session not found or not owned');
          return reply.status(404).send({ error: '目标会话不存在。' });
        }
      }

      const workspaceRows = sqliteAll<WorkspaceSelectionRow>(
        `SELECT skill_id, enabled, pinned, reason, source, updated_at, priority
         FROM chat_workspace_skill_selections
         WHERE user_id = ? AND workspace_path = ?
         ORDER BY priority ASC, skill_id ASC`,
        [user.sub, normalized],
      );

      const sessionRows = sessionId
        ? sqliteAll<SessionOverrideRow>(
            `SELECT skill_id, enabled, pinned, updated_at
             FROM chat_session_skill_overrides WHERE session_id = ?`,
            [sessionId],
          )
        : [];

      const effective = resolveEffectiveSkills({
        userId: user.sub,
        workspacePath: normalized === DEFAULT_WORKSPACE_PATH_KEY ? null : normalized,
        sessionId,
      });

      step.succeed(undefined, {
        workspacePath: normalized,
        workspaceCount: workspaceRows.length,
        sessionCount: sessionRows.length,
        effectiveCount: effective.length,
      });

      return reply.send({
        workspacePath: normalized,
        workspaceSelections: workspaceRows.map((row) => ({
          skillId: row.skill_id,
          enabled: row.enabled === 1,
          pinned: row.pinned === 1,
          reason: row.reason,
          source: row.source,
          updatedAt: row.updated_at,
          priority: row.priority,
        })),
        sessionOverrides: sessionRows.map((row) => ({
          skillId: row.skill_id,
          enabled: row.enabled === 1,
          pinned: row.pinned === null || row.pinned === undefined ? null : row.pinned === 1,
          updatedAt: row.updated_at,
        })),
        effective: serializeEffective(effective),
      });
    },
  );

  // ─── PUT: full replace of the workspace-level selection set ───
  app.put(
    '/skills/selection',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.selection.put');
      const user = request.user as JwtPayload;
      const parsed = parseBody(putSelectionSchema, request.body);

      const normalized = normalizeWorkspacePathForWrite(parsed.workspacePath ?? null);
      if (normalized === null) {
        step.fail('workspace path out of root');
        return reply
          .status(400)
          .send({ error: 'workspacePath 必须位于已配置的工作区根目录内。' });
      }

      // Defend the BUILTIN hard-invariant: caller may not write a BUILTIN id
      // (UI must not show those in selection list). Reject loudly.
      const illegalBuiltin = parsed.items.find((item) => BUILTIN_SKILL_IDS.has(item.skillId));
      if (illegalBuiltin) {
        step.fail('attempted to write BUILTIN skill');
        return reply.status(400).send({
          error: `内置技能 '${illegalBuiltin.skillId}' 不允许通过选择接口管理。`,
        });
      }

      const now = Date.now();
      // Wrap delete + N inserts + marker upsert in a single transaction so a
      // mid-loop failure (or a concurrent reader) never observes a partially
      // replaced selection set.
      sqliteTransaction(() => {
        sqliteRun(
          'DELETE FROM chat_workspace_skill_selections WHERE user_id = ? AND workspace_path = ?',
          [user.sub, normalized],
        );
        // Priority = index in the request items array. Lower = renders
        // first / truncated last in the pinned prompt section. This lets
        // the management page expose a drag-reorder UX without introducing
        // a separate priority API.
        for (let index = 0; index < parsed.items.length; index += 1) {
          const item = parsed.items[index]!;
          sqliteRun(
            `INSERT INTO chat_workspace_skill_selections
               (user_id, workspace_path, skill_id, enabled, pinned, reason, source, updated_at, priority)
             VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
            [
              user.sub,
              normalized,
              item.skillId,
              item.enabled ? 1 : 0,
              item.pinned ? 1 : 0,
              item.reason ?? null,
              now,
              index,
            ],
          );
        }
        // Record that this (user, workspace_path) tuple has been explicitly
        // configured — even when items is empty. The resolver checks this
        // marker before falling back to installed_skills.enabled, so an empty
        // PUT correctly yields a BUILTIN-only effective set instead of
        // re-enabling every installed skill via fallback.
        sqliteRun(
          `INSERT INTO chat_workspace_skill_configured
             (user_id, workspace_path, configured_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, workspace_path) DO UPDATE SET
             configured_at = excluded.configured_at`,
          [user.sub, normalized, now],
        );
      });

      step.succeed(undefined, { count: parsed.items.length });
      return reply.send({
        workspacePath: normalized,
        count: parsed.items.length,
      });
    },
  );

  // ─── PATCH: per-session overrides (additive / upsert) ───
  app.patch(
    '/skills/selection/session/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.selection.session.patch');
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };

      const session = sqliteGet<SessionOwnershipRow>(
        'SELECT user_id, workspace_id, metadata_json FROM sessions WHERE id = ?',
        [sessionId],
      );
      if (!session || session.user_id !== user.sub) {
        step.fail('session not found or not owned');
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const parsed = parseBody(patchSessionOverrideSchema, request.body);

      const illegalBuiltin = parsed.items.find((item) => BUILTIN_SKILL_IDS.has(item.skillId));
      if (illegalBuiltin) {
        step.fail('attempted to write BUILTIN skill');
        return reply.status(400).send({
          error: `内置技能 '${illegalBuiltin.skillId}' 不允许在会话级覆盖。`,
        });
      }

      const now = Date.now();
      sqliteTransaction(() => {
        for (const item of parsed.items) {
          sqliteRun(
            `INSERT INTO chat_session_skill_overrides
               (session_id, skill_id, enabled, pinned, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(session_id, skill_id) DO UPDATE SET
               enabled = excluded.enabled,
               pinned = excluded.pinned,
               updated_at = excluded.updated_at`,
            [
              sessionId,
              item.skillId,
              item.enabled ? 1 : 0,
              item.pinned === undefined ? null : item.pinned ? 1 : 0,
              now,
            ],
          );
        }
      });

      const workspacePath = extractSessionWorkspacePath(session);
      const effective = resolveEffectiveSkills({
        userId: user.sub,
        workspacePath,
        sessionId,
      });

      step.succeed(undefined, {
        sessionId,
        count: parsed.items.length,
        effectiveCount: effective.length,
      });
      return reply.send({
        sessionId,
        effective: serializeEffective(effective),
      });
    },
  );

  // ─── DELETE: clear all session overrides (revert to workspace default) ───
  app.delete(
    '/skills/selection/session/:sessionId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.selection.session.delete');
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };

      const session = sqliteGet<SessionOwnershipRow>(
        'SELECT user_id, workspace_id, metadata_json FROM sessions WHERE id = ?',
        [sessionId],
      );
      if (!session || session.user_id !== user.sub) {
        step.fail('session not found or not owned');
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      sqliteRun('DELETE FROM chat_session_skill_overrides WHERE session_id = ?', [sessionId]);
      step.succeed(undefined, { sessionId });
      return reply.send({ sessionId, cleared: true });
    },
  );
}
