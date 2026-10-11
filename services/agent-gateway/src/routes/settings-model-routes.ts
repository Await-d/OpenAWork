import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import {
  readUpstreamRetrySettings,
  UPSTREAM_RETRY_SETTINGS_KEY,
  upstreamRetrySettingsSchema,
} from '../provider/upstream-retry-policy.js';
import {
  readWebsearchPolicy,
  WEBSEARCH_POLICY_KEY,
  websearchPolicySchema,
} from '../provider/websearch-policy.js';
import {
  COMPACTION_SETTINGS_KEY,
  compactionSettingsSchema,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { z } from 'zod';

import { parseStoredJson, type UserSettingRow } from './settings-support.js';
import { activeSelectionSchema, materializeProviderConfig } from '../provider/provider-config.js';
import { invalidateCatalog } from '../provider/provider-catalog.js';

export async function registerSettingsModelRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/active-selection',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.active-selection.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      loadStep.succeed();

      const materializeStep = child('materialize');
      const { activeSelection } = await materializeProviderConfig(
        parseStoredJson(providerRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      materializeStep.succeed();
      step.succeed();

      return reply.send({ activeSelection });
    },
  );

  app.put(
    '/settings/active-selection',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.active-selection.put');
      const user = request.user as JwtPayload;
      const schema = z.object({
        chat: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
        fast: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
        image: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
        compaction: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
      });
      const parsed = parseBody(schema, request.body);
      const loadStep = child('load-existing');
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: selectionRow !== undefined });

      const mergedSelection = (() => {
        const stored = parseStoredJson(selectionRow?.value);
        const storedParsed = activeSelectionSchema.safeParse(stored);
        const storedSelection = storedParsed.success ? storedParsed.data : undefined;

        return {
          ...(storedSelection?.chat ? { chat: storedSelection.chat } : {}),
          ...(storedSelection?.fast ? { fast: storedSelection.fast } : {}),
          ...(storedSelection?.image ? { image: storedSelection.image } : {}),
          ...(storedSelection?.compaction ? { compaction: storedSelection.compaction } : {}),
          ...(parsed.chat ? { chat: parsed.chat } : {}),
          ...(parsed.fast ? { fast: parsed.fast } : {}),
          ...(parsed.image ? { image: parsed.image } : {}),
          ...(parsed.compaction ? { compaction: parsed.compaction } : {}),
        };
      })();
      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
        [user.sub, JSON.stringify(mergedSelection)],
      );
      saveStep.succeed();
      invalidateCatalog(user.sub);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/settings/upstream-retry',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.upstream-retry.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
        [user.sub, UPSTREAM_RETRY_SETTINGS_KEY],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const settings = readUpstreamRetrySettings(parseStoredJson(row?.value));
      step.succeed(undefined, { maxRetries: settings.maxRetries });
      return reply.send(settings);
    },
  );

  app.put(
    '/settings/upstream-retry',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.upstream-retry.put');
      const user = request.user as JwtPayload;

      const parsed = parseBody(upstreamRetrySettingsSchema, request.body);

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, UPSTREAM_RETRY_SETTINGS_KEY, JSON.stringify(parsed)],
      );
      saveStep.succeed(undefined, { maxRetries: parsed.maxRetries });
      step.succeed(undefined, { saved: true });

      return reply.send(parsed);
    },
  );

  // P2-WEBSEARCH (workflow 260509): persisted multi-provider rollout
  // policy. The gateway tool path currently still uses the legacy
  // single-provider call; this endpoint stores the user's intended
  // configuration so a future switch to `searchMultiProvider` can
  // pick it up without a UI re-roll. Default state keeps the legacy
  // behaviour (`sequential`, no providers) so saving an empty
  // configuration is a no-op.
  app.get(
    '/settings/websearch',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.websearch.get');
      const user = request.user as JwtPayload;
      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
        [user.sub, WEBSEARCH_POLICY_KEY],
      );
      loadStep.succeed(undefined, { found: row !== undefined });
      const settings = readWebsearchPolicy(parseStoredJson(row?.value));
      step.succeed(undefined, {
        providers: settings.providers.length,
        rolloutMode: settings.rolloutMode,
      });
      return reply.send(settings);
    },
  );

  app.put(
    '/settings/websearch',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.websearch.put');
      const user = request.user as JwtPayload;
      const parsed = parseBody(websearchPolicySchema, request.body);
      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, WEBSEARCH_POLICY_KEY, JSON.stringify(parsed)],
      );
      saveStep.succeed(undefined, {
        providers: parsed.providers.length,
        rolloutMode: parsed.rolloutMode,
      });
      step.succeed(undefined, { saved: true });
      return reply.send(parsed);
    },
  );

  app.get(
    '/settings/compaction',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.compaction.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
        [user.sub, COMPACTION_SETTINGS_KEY],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const settings = readCompactionSettings(parseStoredJson(row?.value));
      step.succeed(undefined, {
        auto: settings.auto,
        prune: settings.prune,
        ...(typeof settings.reserved === 'number' ? { reserved: settings.reserved } : {}),
      });
      return reply.send(settings);
    },
  );

  app.put(
    '/settings/compaction',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.compaction.put');
      const user = request.user as JwtPayload;

      const parsed = parseBody(compactionSettingsSchema, request.body);

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, COMPACTION_SETTINGS_KEY, JSON.stringify(parsed)],
      );
      saveStep.succeed(undefined, {
        auto: parsed.auto,
        prune: parsed.prune,
        ...(typeof parsed.reserved === 'number' ? { reserved: parsed.reserved } : {}),
      });
      step.succeed(undefined, { saved: true });

      return reply.send(parsed);
    },
  );
}
