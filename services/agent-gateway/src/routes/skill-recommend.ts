/**
 * Skill recommendation routes (PR4 of the skill-workspace-selection spec).
 *
 *   POST /api/skills/recommend
 *     - Sample workspace signals (≤ 8KB total)
 *     - Build candidate set from `installed_skills(user, enabled=1)`
 *     - Compute `signalDigest = sha1(stable-stringify({signals, candidateIds}))`
 *     - 24h cache by digest unless `force = true`
 *     - LLM call (JSON-mode); on failure / parse error / hallucinated id list
 *       → fall back to deterministic heuristic
 *     - Persist `chat_workspace_skill_recommendations(applied = 0)`
 *
 *   POST /api/skills/recommend/:id/apply
 *     - Merge optional per-id `overrides` over the LLM output, full-replace
 *       the `(user, workspace_path)` selection rows with `source = 'ai-recommend'`
 *     - Mark recommendation `applied = 1`
 *
 *   GET  /api/skills/recommend/latest?workspacePath=...
 *     - Return latest applied + latest pending (each may be null)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SkillManifest } from '@openAwork/skill-types';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun, sqliteTransaction } from '../db.js';
import { getProviderConfigForSelection } from '../provider/provider-config.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from '../provider/model-router.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { DEFAULT_WORKSPACE_PATH_KEY, normalizeWorkspacePathForWrite } from '../skill/skill-selection.js';
import {
  recommendByHeuristic,
  type HeuristicCandidate,
  type HeuristicRecommendation,
  type HeuristicRejection,
} from '../skill/skill-recommend-heuristic.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';
import {
  collectWorkspaceSignals,
  computeSignalDigest,
  type WorkspaceSignals,
} from '../workspace/workspace-skill-signals.js';

const BUILTIN_SKILL_IDS = new Set(BUILTIN_SKILLS.map((entry) => entry.manifest.id));

const recommendBodySchema = z.object({
  workspacePath: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  force: z.boolean().default(false),
});

const applyOverridesSchema = z.object({
  overrides: z
    .record(
      z.object({
        enabled: z.boolean(),
        pinned: z.boolean().optional(),
      }),
    )
    .default({}),
});

const RECOMMEND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECOMMEND_LLM_TIMEOUT_MS = 60_000;

interface InstalledSkillRow {
  skill_id: string;
  manifest_json: string;
}

interface RecommendationRow {
  id: string;
  user_id: string;
  workspace_path: string;
  signal_digest: string;
  model_id: string | null;
  result_json: string;
  applied: number;
  created_at: number;
}

export interface RecommendationResultBody {
  recommendations: HeuristicRecommendation[];
  rejected: HeuristicRejection[];
}

function loadCandidates(userId: string): HeuristicCandidate[] {
  const rows = sqliteAll<InstalledSkillRow>(
    `SELECT skill_id, manifest_json
       FROM installed_skills
       WHERE user_id = ? AND enabled = 1
       ORDER BY skill_id ASC`,
    [userId],
  );
  return rows
    .map<HeuristicCandidate | null>((row) => {
      try {
        const manifest = JSON.parse(row.manifest_json) as SkillManifest;
        return { skillId: row.skill_id, manifest };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is HeuristicCandidate => entry !== null);
}

function findRecentCachedRecommendation(
  userId: string,
  workspacePath: string,
  signalDigest: string,
): RecommendationRow | undefined {
  const cutoff = Date.now() - RECOMMEND_CACHE_TTL_MS;
  return sqliteGet<RecommendationRow>(
    `SELECT * FROM chat_workspace_skill_recommendations
       WHERE user_id = ? AND workspace_path = ? AND signal_digest = ?
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 1`,
    [userId, workspacePath, signalDigest, cutoff],
  );
}

function buildLlmPrompt(
  signals: WorkspaceSignals,
  candidates: HeuristicCandidate[],
): { system: string; user: string } {
  const system = [
    '你是一个 skill 选型助手。',
    '给定项目特征与可选 skill 清单，输出 JSON：',
    '{',
    '  "recommendations": [',
    '    { "skill_id": "...", "pinned": true|false, "reason": "...", "score": 0-100 }',
    '  ],',
    '  "rejected": [ { "skill_id": "...", "reason": "..." } ]',
    '}',
    '规则：',
    '- pinned=true 仅给「该项目主线必用」的 1-3 个 skill；其它 pinned=false 但 enabled=true。',
    '- 不在候选清单的 skill_id 一律不要输出。',
    '- 理由必须基于具体项目信号，不要泛化。',
    '- reason 控制在 80 个字符内。',
    '- 仅输出 JSON，不要额外说明文字。',
  ].join('\n');

  const candidateList = candidates
    .map((entry) => {
      const tags = (entry.manifest.capabilities ?? []).slice(0, 6).join(', ');
      return `- ${entry.skillId} | ${entry.manifest.displayName ?? entry.manifest.name} | capabilities: ${tags || '(none)'} | desc: ${entry.manifest.description?.slice(0, 120) ?? ''}`;
    })
    .join('\n');

  const signalParts: string[] = [];
  signalParts.push(`workspacePath=${signals.workspacePath}`);
  if (signals.readme) {
    signalParts.push(`README (${signals.readme.path}):\n${signals.readme.content}`);
  }
  for (const manifest of signals.manifests) {
    signalParts.push(`Manifest ${manifest.path}:\n${manifest.content}`);
  }
  if (signals.agentdocsIndex) {
    signalParts.push(`.agentdocs/index.md:\n${signals.agentdocsIndex.content}`);
  }
  if (signals.topLevelTree.length > 0) {
    signalParts.push(`Tree (depth ≤ 2):\n${signals.topLevelTree.slice(0, 200).join('\n')}`);
  }
  const histogram = Object.entries(signals.fileExtensionHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, count]) => `${ext}=${count}`)
    .join(', ');
  if (histogram.length > 0) {
    signalParts.push(`File extension histogram: ${histogram}`);
  }

  const userMessage = [
    '## 项目信号',
    signalParts.join('\n\n---\n\n'),
    '',
    '## 候选 skill 清单',
    candidateList || '(empty)',
  ].join('\n');

  return { system, user: userMessage };
}

function tryParseLlmJson(text: string): RecommendationResultBody | null {
  // Strip ```json fences and stray code fences if any.
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const recommendations = Array.isArray(obj['recommendations'])
    ? (obj['recommendations'] as unknown[])
    : [];
  const rejected = Array.isArray(obj['rejected']) ? (obj['rejected'] as unknown[]) : [];
  const safeRecommendations: HeuristicRecommendation[] = [];
  for (const entry of recommendations) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['skill_id'] !== 'string') continue;
    const score = typeof e['score'] === 'number' ? e['score'] : 0;
    safeRecommendations.push({
      skill_id: e['skill_id'],
      pinned: e['pinned'] === true,
      reason: typeof e['reason'] === 'string' ? e['reason'].slice(0, 160) : '',
      score: Math.max(0, Math.min(100, Math.round(score))),
    });
  }
  const safeRejected: HeuristicRejection[] = [];
  for (const entry of rejected) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['skill_id'] !== 'string') continue;
    safeRejected.push({
      skill_id: e['skill_id'],
      reason: typeof e['reason'] === 'string' ? e['reason'].slice(0, 160) : '',
    });
  }
  return { recommendations: safeRecommendations, rejected: safeRejected };
}

function dropHallucinations(
  result: RecommendationResultBody,
  candidateIds: Set<string>,
): RecommendationResultBody {
  return {
    recommendations: result.recommendations.filter((entry) => candidateIds.has(entry.skill_id)),
    rejected: result.rejected.filter((entry) => candidateIds.has(entry.skill_id)),
  };
}

interface ResolvedRouteHandle {
  modelId: string | null;
  invoke: (system: string, userMessage: string) => Promise<string>;
}

async function resolveRecommendRoute(userId: string): Promise<ResolvedRouteHandle | null> {
  // Reuse the user's default chat model selection for recommendation.
  const providersRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const providerConfig = await getProviderConfigForSelection(
    providersRow?.value ? safeJson(providersRow.value) : undefined,
    selectionRow?.value ? safeJson(selectionRow.value) : undefined,
    {},
  );
  const route = providerConfig
    ? resolveModelRouteFromProvider(providerConfig.provider, providerConfig.modelId, {
        maxTokens: 1500,
        temperature: 0.2,
      })
    : resolveModelRoute({ model: 'default', maxTokens: 1500, temperature: 0.2 });

  return {
    modelId: route.model,
    invoke: async (system, userMessage) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RECOMMEND_LLM_TIMEOUT_MS);
      try {
        const result = await runUpstreamGenerate({
          providerType: route.providerType ?? 'openai',
          // Forward the resolved upstream protocol so providers configured
          // for `anthropic-messages` / `openai-responses` (and the GPT-5 /
          // o-series API) actually hit their native API surface instead of
          // silently degrading to OpenAI Chat Completions.
          ...(route.upstreamProtocol ? { upstreamProtocol: route.upstreamProtocol } : {}),
          ...(route.apiKey ? { apiKey: route.apiKey } : {}),
          ...(route.apiBaseUrl ? { baseURL: route.apiBaseUrl } : {}),
          ...(route.requestOverrides.headers &&
          Object.keys(route.requestOverrides.headers).length > 0
            ? { headers: route.requestOverrides.headers }
            : {}),
          model: route.model,
          system,
          messages: [{ role: 'user', content: userMessage }],
          maxOutputTokens: 1500,
          temperature: 0.2,
          requestOverrides: route.requestOverrides,
          signal: controller.signal,
        });
        return result.text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function persistRecommendation(input: {
  userId: string;
  workspacePath: string;
  signalDigest: string;
  modelId: string | null;
  result: RecommendationResultBody;
}): RecommendationRow {
  const id = randomUUID();
  const createdAt = Date.now();
  sqliteRun(
    `INSERT INTO chat_workspace_skill_recommendations
       (id, user_id, workspace_path, signal_digest, model_id, result_json, applied, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      input.userId,
      input.workspacePath,
      input.signalDigest,
      input.modelId,
      JSON.stringify(input.result),
      createdAt,
    ],
  );
  return {
    id,
    user_id: input.userId,
    workspace_path: input.workspacePath,
    signal_digest: input.signalDigest,
    model_id: input.modelId,
    result_json: JSON.stringify(input.result),
    applied: 0,
    created_at: createdAt,
  };
}

function rowToResponse(row: RecommendationRow, fromCache: boolean, fellBackToHeuristic: boolean) {
  let parsed: RecommendationResultBody = { recommendations: [], rejected: [] };
  try {
    parsed = JSON.parse(row.result_json) as RecommendationResultBody;
  } catch {
    /* keep empty */
  }
  return {
    recommendationId: row.id,
    workspacePath: row.workspace_path,
    signalDigest: row.signal_digest,
    modelId: row.model_id,
    recommendations: parsed.recommendations,
    rejected: parsed.rejected,
    fromCache,
    fellBackToHeuristic,
    applied: row.applied === 1,
    createdAt: row.created_at,
  };
}

export async function skillRecommendRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /skills/recommend — sample, hash, cache, LLM, fallback, persist ───
  app.post(
    '/skills/recommend',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.recommend.create');
      const user = request.user as JwtPayload;
      const parsed = recommendBodySchema.safeParse(request.body);
      if (!parsed.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Invalid recommendation request body' });
      }
      const normalized = normalizeWorkspacePathForWrite(parsed.data.workspacePath ?? null);
      const workspacePath = normalized ?? DEFAULT_WORKSPACE_PATH_KEY;
      const candidates = loadCandidates(user.sub);
      const candidateIds = new Set(candidates.map((entry) => entry.skillId));
      const signals = await collectWorkspaceSignals(workspacePath);
      const signalDigest = computeSignalDigest(
        signals,
        candidates.map((entry) => entry.skillId),
      );

      // 24h cache short-circuit
      if (!parsed.data.force) {
        const cached = findRecentCachedRecommendation(user.sub, workspacePath, signalDigest);
        if (cached) {
          step.succeed(undefined, { cached: true, candidateCount: candidates.length });
          return reply.send(rowToResponse(cached, true, false));
        }
      }

      let result: RecommendationResultBody | null = null;
      let fellBackToHeuristic = false;
      let modelId: string | null = null;

      if (candidates.length > 0) {
        try {
          const route = await resolveRecommendRoute(user.sub);
          if (route) {
            modelId = route.modelId;
            const { system, user: userPrompt } = buildLlmPrompt(signals, candidates);
            const raw = await route.invoke(system, userPrompt);
            const parsedJson = tryParseLlmJson(raw);
            if (parsedJson) {
              result = dropHallucinations(parsedJson, candidateIds);
            }
          }
        } catch (error) {
          // Swallow LLM failures and fall through to heuristic. Caller sees
          // `fellBackToHeuristic = true` so the UI can label it.
          request.log.warn(
            { err: error instanceof Error ? error.message : String(error) },
            'skill recommendation LLM call failed',
          );
        }
      }

      if (!result || result.recommendations.length === 0) {
        const heuristic = recommendByHeuristic(candidates, signals);
        result = dropHallucinations(heuristic, candidateIds);
        fellBackToHeuristic = true;
      }

      const row = persistRecommendation({
        userId: user.sub,
        workspacePath,
        signalDigest,
        modelId,
        result,
      });
      step.succeed(undefined, {
        recommendationId: row.id,
        candidateCount: candidates.length,
        fellBackToHeuristic,
      });
      return reply.send(rowToResponse(row, false, fellBackToHeuristic));
    },
  );

  // ─── POST /skills/recommend/:id/apply — merge overrides + full replace ───
  app.post(
    '/skills/recommend/:id/apply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.recommend.apply');
      const user = request.user as JwtPayload;
      const { id } = request.params as { id: string };

      const row = sqliteGet<RecommendationRow>(
        'SELECT * FROM chat_workspace_skill_recommendations WHERE id = ? AND user_id = ?',
        [id, user.sub],
      );
      if (!row) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Recommendation not found' });
      }
      const parsed = applyOverridesSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Invalid apply body' });
      }

      let payload: RecommendationResultBody = { recommendations: [], rejected: [] };
      try {
        payload = JSON.parse(row.result_json) as RecommendationResultBody;
      } catch {
        /* corrupted row — fall through with empty payload */
      }

      // Defensive: refuse user-supplied overrides whose skillId either is a
      // BUILTIN (UI must not allow this — BUILTIN is always-available, never
      // managed via selection tables) or is not currently installed for this
      // user (foreign-id pollution / stale UI state). The PUT route enforces
      // the same BUILTIN guard; mirror it here so neither surface can be
      // used to inject rows that bypass the invariant.
      const installedIds = new Set(
        sqliteAll<{ skill_id: string }>(
          'SELECT skill_id FROM installed_skills WHERE user_id = ? AND enabled = 1',
          [user.sub],
        ).map((r) => r.skill_id),
      );
      const overrideEntries = Object.entries(parsed.data.overrides);
      const illegalBuiltinOverride = overrideEntries.find(([skillId]) =>
        BUILTIN_SKILL_IDS.has(skillId),
      );
      if (illegalBuiltinOverride) {
        step.fail('attempted to apply BUILTIN override');
        return reply.status(400).send({
          error: `BUILTIN skill '${illegalBuiltinOverride[0]}' cannot be managed via selection`,
        });
      }
      // Merge overrides over the LLM payload. Overrides may add entries that
      // were rejected (user wants them anyway) or flip pinned flags. Drop
      // overrides for skill ids the user does not have installed — these
      // would just sit in the selection table doing nothing.
      const overrideMap: Record<string, { enabled: boolean; pinned?: boolean }> = {};
      for (const [skillId, value] of overrideEntries) {
        if (!installedIds.has(skillId)) continue;
        overrideMap[skillId] = value;
      }
      const finalRows: Array<{
        skillId: string;
        enabled: boolean;
        pinned: boolean;
        reason: string;
      }> = [];
      const seen = new Set<string>();
      for (const entry of payload.recommendations) {
        if (seen.has(entry.skill_id)) continue;
        seen.add(entry.skill_id);
        const override = overrideMap[entry.skill_id];
        finalRows.push({
          skillId: entry.skill_id,
          enabled: override?.enabled ?? true,
          pinned: override?.pinned ?? entry.pinned,
          reason: entry.reason,
        });
      }
      for (const [skillId, override] of Object.entries(overrideMap)) {
        if (seen.has(skillId)) continue;
        seen.add(skillId);
        finalRows.push({
          skillId,
          enabled: override.enabled,
          pinned: override.pinned ?? false,
          reason: 'manual override applied during AI recommendation',
        });
      }

      const now = Date.now();
      // All writes (full-replace selection rows + configured marker upsert
      // + applied flag) live in a single transaction so a partial failure
      // never leaves the user with half-applied recommendations.
      sqliteTransaction(() => {
        sqliteRun(
          'DELETE FROM chat_workspace_skill_selections WHERE user_id = ? AND workspace_path = ?',
          [user.sub, row.workspace_path],
        );
        // Priority follows the merged final order — recommendations come in
        // LLM-ranked sequence (or heuristic-score order on fallback) and
        // user-only overrides are appended after, so the resulting numeric
        // priority preserves what the user just confirmed in the diff drawer.
        for (let index = 0; index < finalRows.length; index += 1) {
          const finalRow = finalRows[index]!;
          sqliteRun(
            `INSERT INTO chat_workspace_skill_selections
               (user_id, workspace_path, skill_id, enabled, pinned, reason, source, updated_at, priority)
             VALUES (?, ?, ?, ?, ?, ?, 'ai-recommend', ?, ?)`,
            [
              user.sub,
              row.workspace_path,
              finalRow.skillId,
              finalRow.enabled ? 1 : 0,
              finalRow.pinned ? 1 : 0,
              finalRow.reason || null,
              now,
              index,
            ],
          );
        }

        // Mark this (user, workspace_path) tuple as explicitly configured —
        // mirrors the PUT /skills/selection handler so the resolver doesn't
        // erroneously fall back to installed_skills.enabled when the AI
        // recommendation legitimately produced an empty selection set.
        sqliteRun(
          `INSERT INTO chat_workspace_skill_configured
             (user_id, workspace_path, configured_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, workspace_path) DO UPDATE SET
             configured_at = excluded.configured_at`,
          [user.sub, row.workspace_path, now],
        );

        sqliteRun('UPDATE chat_workspace_skill_recommendations SET applied = 1 WHERE id = ?', [id]);
      });

      step.succeed(undefined, { recommendationId: id, replaced: finalRows.length });
      return reply.send({
        recommendationId: id,
        applied: true,
        replacedCount: finalRows.length,
        items: finalRows,
      });
    },
  );

  // ─── GET /skills/recommend/latest?workspacePath=... ───
  app.get(
    '/skills/recommend/latest',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'skills.recommend.latest');
      const user = request.user as JwtPayload;
      const query = request.query as { workspacePath?: string };
      const normalized = normalizeWorkspacePathForWrite(query.workspacePath ?? null);
      const workspacePath = normalized ?? DEFAULT_WORKSPACE_PATH_KEY;
      const applied = sqliteGet<RecommendationRow>(
        `SELECT * FROM chat_workspace_skill_recommendations
           WHERE user_id = ? AND workspace_path = ? AND applied = 1
           ORDER BY created_at DESC
           LIMIT 1`,
        [user.sub, workspacePath],
      );
      const pending = sqliteGet<RecommendationRow>(
        `SELECT * FROM chat_workspace_skill_recommendations
           WHERE user_id = ? AND workspace_path = ? AND applied = 0
           ORDER BY created_at DESC
           LIMIT 1`,
        [user.sub, workspacePath],
      );
      step.succeed(undefined, {
        hasApplied: !!applied,
        hasPending: !!pending,
      });
      return reply.send({
        applied: applied ? rowToResponse(applied, false, false) : null,
        pending: pending ? rowToResponse(pending, false, false) : null,
      });
    },
  );
}
