import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import {
  COMPACTION_SETTINGS_KEY,
  compactionSettingsSchema,
  readCompactionSettings,
} from '../compaction-policy.js';
import {
  filterEnabledProviderConfig,
  materializeProviderConfig,
  parseStoredDefaultThinking,
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
} from '../provider-config.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { listRequestWorkflowLogs } from '../request-workflow-log-store.js';
import {
  readUpstreamRetrySettings,
  UPSTREAM_RETRY_SETTINGS_KEY,
  upstreamRetrySettingsSchema,
} from '../upstream-retry-policy.js';
import { z } from 'zod';

interface RootPackageJson {
  name?: string;
  version?: string;
}

function readPackageJsonVersion(filePath: string): RootPackageJson | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as RootPackageJson;
  } catch {
    return null;
  }
}

function loadAppVersion(): string {
  const cwd = process.cwd();
  const currentPackage = readPackageJsonVersion(resolve(cwd, 'package.json'));
  let cursor = cwd;

  while (true) {
    const candidate = readPackageJsonVersion(resolve(cursor, 'package.json'));
    if (candidate?.name === 'openAwork' && typeof candidate.version === 'string') {
      return candidate.version;
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }

    cursor = parent;
  }

  if (typeof currentPackage?.version === 'string') {
    return currentPackage.version;
  }

  return process.env['OPENAWORK_APP_VERSION'] ?? process.env['npm_package_version'] ?? '0.0.1';
}

const APP_VERSION = loadAppVersion();

interface AuditLogRow {
  id: number;
  session_id: string | null;
  tool_name: string;
  request_id: string;
  input_json: string | null;
  output_json: string | null;
  is_error: number;
  duration_ms: number | null;
  created_at: string;
}

interface PermissionRequestHistoryRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  decision: string | null;
  status: string;
  created_at: string;
}

interface UserSettingRow {
  key: string;
  value: string;
}

const companionInjectionModeSchema = z.enum(['off', 'mention_only', 'always']);
const companionVerbositySchema = z.enum(['minimal', 'normal']);
const companionThemeVariantSchema = z.enum(['default', 'playful']);
const companionVoiceOutputModeSchema = z.enum(['off', 'buddy_only', 'important_only']);
const companionVoiceVariantSchema = z.enum(['system', 'bright', 'calm']);

const companionPreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  muted: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
  verbosity: companionVerbositySchema.default('normal'),
  injectionMode: companionInjectionModeSchema.default('mention_only'),
  themeVariant: companionThemeVariantSchema.default('default'),
  voiceOutputEnabled: z.boolean().default(false),
  voiceOutputMode: companionVoiceOutputModeSchema.default('buddy_only'),
  voiceRate: z.number().min(0.5).max(2).default(1.02),
  voiceVariant: companionVoiceVariantSchema.default('system'),
});

const companionSettingsStoredSchema = z.object({
  preferences: companionPreferencesSchema,
  profile: z.null().default(null),
  updatedAt: z.string().optional(),
});

const companionSettingsUpdateSchema = z.object({
  preferences: companionPreferencesSchema.partial(),
});

const DEFAULT_COMPANION_PREFERENCES = companionPreferencesSchema.parse({});

type CompanionSettingsRecord = {
  preferences: z.infer<typeof companionPreferencesSchema>;
  profile: null;
  updatedAt?: string;
};

function readCompanionSettings(value: string | undefined): CompanionSettingsRecord {
  const parsed = companionSettingsStoredSchema.safeParse(parseStoredJson(value));
  if (parsed.success) {
    return {
      preferences: parsed.data.preferences,
      profile: parsed.data.profile,
      ...(parsed.data.updatedAt ? { updatedAt: parsed.data.updatedAt } : {}),
    };
  }

  return {
    preferences: DEFAULT_COMPANION_PREFERENCES,
    profile: null,
  };
}

function buildCompanionFeatureState(preferences: z.infer<typeof companionPreferencesSchema>): {
  enabled: boolean;
  mode: 'off' | 'beta';
} {
  return preferences.enabled ? { enabled: true, mode: 'beta' } : { enabled: false, mode: 'off' };
}

const AUDIT_PAYLOAD_MAX_STRING_LENGTH = 1000;
const AUDIT_PAYLOAD_MAX_DEPTH = 4;
const AUDIT_PAYLOAD_MAX_ARRAY_ITEMS = 20;
const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_SUFFIX = '…[truncated]';
const REDACTED_KEY_PATTERN =
  /(authorization|api[-_]?key|token|secret|password|cookie|set-cookie|session)/i;

const parseStoredJson = (value: string | undefined): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

function extractAuditSummary(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload.trim().length > 0 ? payload.trim() : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const summary = extractAuditSummary(item);
      if (summary) {
        return summary;
      }
    }
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidateKeys = ['message', 'error', 'summary', 'detail', 'reason', 'stderr', 'text'];
  for (const key of candidateKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  if (record['data']) {
    return extractAuditSummary(record['data']);
  }

  return null;
}

function truncateAuditString(value: string): string {
  if (value.length <= AUDIT_PAYLOAD_MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, AUDIT_PAYLOAD_MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function sanitizeAuditPayload(payload: unknown, depth = 0): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === 'string') {
    return truncateAuditString(payload);
  }

  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return payload;
  }

  if (typeof payload === 'bigint' || typeof payload === 'symbol') {
    return payload.toString();
  }

  if (typeof payload === 'function') {
    return '[Function]';
  }

  if (depth >= AUDIT_PAYLOAD_MAX_DEPTH) {
    return '[Max depth reached]';
  }

  if (Array.isArray(payload)) {
    return payload
      .slice(0, AUDIT_PAYLOAD_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeAuditPayload(item, depth + 1));
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const sanitizedEntries = Object.entries(record).map(([key, value]) => {
      if (REDACTED_KEY_PATTERN.test(key)) {
        return [key, REDACTED_VALUE] as const;
      }

      return [key, sanitizeAuditPayload(value, depth + 1)] as const;
    });

    return Object.fromEntries(sanitizedEntries);
  }

  return '[Unsupported payload]';
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/companion',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.companion.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'companion_preferences_v1'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const settings = readCompanionSettings(row?.value);
      step.succeed(undefined, { voiceOutputEnabled: settings.preferences.voiceOutputEnabled });
      return reply.send({
        feature: buildCompanionFeatureState(settings.preferences),
        preferences: settings.preferences,
        profile: settings.profile,
      });
    },
  );

  app.put(
    '/settings/companion',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.companion.put');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const parsed = companionSettingsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        parseStep.fail('invalid companion body');
        step.fail('invalid companion body');
        return reply
          .status(400)
          .send({ error: 'Invalid companion settings', issues: parsed.error.issues });
      }
      parseStep.succeed(undefined, { keys: Object.keys(parsed.data.preferences).length });

      const loadStep = child('load-existing');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'companion_preferences_v1'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const existing = readCompanionSettings(row?.value);
      const nextSettings = {
        preferences: {
          ...existing.preferences,
          ...parsed.data.preferences,
        },
        profile: existing.profile,
        updatedAt: new Date().toISOString(),
      };

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'companion_preferences_v1', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(nextSettings)],
      );
      saveStep.succeed(undefined, {
        voiceOutputEnabled: nextSettings.preferences.voiceOutputEnabled,
      });
      step.succeed(undefined, { saved: true });

      return reply.send({
        feature: buildCompanionFeatureState(nextSettings.preferences),
        preferences: nextSettings.preferences,
        profile: nextSettings.profile,
      });
    },
  );

  app.get(
    '/settings/mcp-status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.mcp-status.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const parseStep = child('parse-json');
      let servers: unknown[] = [];
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value) as unknown[];
          servers = Array.isArray(parsed)
            ? parsed.map((server) => {
                const normalized = server as Record<string, unknown>;
                return {
                  id: normalized['id'] ?? '',
                  name: normalized['name'] ?? '',
                  type: normalized['type'] ?? 'stdio',
                  status: 'unknown',
                  enabled: normalized['enabled'] ?? true,
                };
              })
            : [];
          parseStep.succeed(undefined, { servers: servers.length });
        } catch {
          parseStep.fail('invalid mcp_servers JSON');
          servers = [];
        }
      } else {
        parseStep.succeed(undefined, { servers: 0 });
      }

      step.succeed(undefined, { servers: servers.length });
      return reply.send({ servers });
    },
  );

  app.get(
    '/settings/permissions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.permissions.list');
      const queryStep = child('query');
      const rows = sqliteAll<PermissionRequestHistoryRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, decision, status, created_at
         FROM permission_requests
         WHERE status != 'pending'
         ORDER BY created_at DESC
         LIMIT 50`,
        [],
      );
      queryStep.succeed(undefined, { rows: rows.length });

      const mapStep = child('map');
      const decisions = rows.map((row) => ({
        id: row.id,
        toolName: row.tool_name,
        scope: row.scope,
        reason: row.reason,
        sessionId: row.session_id,
        decision: row.decision ?? 'reject',
        riskLevel: row.risk_level,
        createdAt: row.created_at,
      }));
      mapStep.succeed(undefined, { decisions: decisions.length });
      step.succeed(undefined, { decisions: decisions.length });

      return reply.send({ decisions });
    },
  );

  app.get(
    '/settings/diagnostics',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.diagnostics.list');
      const user = request.user as JwtPayload;

      const queryParamsStep = child('parse-query');
      const querySchema = z.object({
        date: z.string().optional(),
      });
      const parsedQuery = querySchema.safeParse(request.query ?? {});
      const dateFilter =
        parsedQuery.success && parsedQuery.data.date ? parsedQuery.data.date : null;
      queryParamsStep.succeed(undefined, { dateFilter: dateFilter ?? 'all' });

      const queryStep = child('query');
      const rows = dateFilter
        ? sqliteAll<AuditLogRow>(
            `SELECT audit_logs.id,
                    audit_logs.session_id,
                    audit_logs.tool_name,
                    audit_logs.request_id,
                    audit_logs.input_json,
                    audit_logs.output_json,
                    audit_logs.is_error,
                    audit_logs.duration_ms,
                    audit_logs.created_at
             FROM audit_logs
             INNER JOIN sessions ON sessions.id = audit_logs.session_id
             WHERE sessions.user_id = ? AND audit_logs.is_error = 1
               AND date(audit_logs.created_at) = date(?)
             ORDER BY audit_logs.created_at DESC
             LIMIT 200`,
            [user.sub, dateFilter],
          )
        : sqliteAll<AuditLogRow>(
            `SELECT audit_logs.id,
                    audit_logs.session_id,
                    audit_logs.tool_name,
                    audit_logs.request_id,
                    audit_logs.input_json,
                    audit_logs.output_json,
                    audit_logs.is_error,
                    audit_logs.duration_ms,
                    audit_logs.created_at
             FROM audit_logs
             INNER JOIN sessions ON sessions.id = audit_logs.session_id
             WHERE sessions.user_id = ? AND audit_logs.is_error = 1
             ORDER BY audit_logs.created_at DESC
             LIMIT 200`,
            [user.sub],
          );
      queryStep.succeed(undefined, { rows: rows.length });

      const appVersion = APP_VERSION;

      const mapStep = child('map');
      const diagnostics = rows.map((row) => {
        const input = sanitizeAuditPayload(parseStoredJson(row.input_json ?? undefined));
        const output = sanitizeAuditPayload(parseStoredJson(row.output_json ?? undefined));
        const summary = extractAuditSummary(output) ?? `Tool error: ${row.tool_name}`;

        return {
          id: String(row.id),
          filePath: row.tool_name,
          toolName: row.tool_name,
          requestId: row.request_id,
          sessionId: row.session_id,
          durationMs: row.duration_ms,
          message: summary,
          severity: 'error' as const,
          createdAt: row.created_at,
          appVersion,
          input,
          output,
        };
      });

      const availableDatesStep = child('available-dates');
      const dateRows = sqliteAll<{ date: string }>(
        `SELECT DISTINCT date(audit_logs.created_at) AS date
         FROM audit_logs
         INNER JOIN sessions ON sessions.id = audit_logs.session_id
         WHERE sessions.user_id = ? AND audit_logs.is_error = 1
         ORDER BY date DESC
         LIMIT 90`,
        [user.sub],
      );
      const availableDates = dateRows.map((r) => r.date);
      availableDatesStep.succeed(undefined, { dates: availableDates.length });

      mapStep.succeed(undefined, { diagnostics: diagnostics.length });
      step.succeed(undefined, { diagnostics: diagnostics.length });

      return reply.send({ diagnostics, availableDates, appVersion });
    },
  );

  app.get(
    '/settings/workers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.workers.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'workers'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const parseStep = child('parse-json');
      let workers: unknown[] = [];
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value) as unknown[];
          workers = Array.isArray(parsed) ? parsed : [];
          parseStep.succeed(undefined, { workers: workers.length });
        } catch {
          parseStep.fail('invalid workers JSON');
          workers = [];
        }
      } else {
        parseStep.succeed(undefined, { workers: 0 });
      }

      step.succeed(undefined, { workers: workers.length });
      return reply.send({ workers });
    },
  );

  app.get(
    '/settings/providers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.get');
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const parsedQuery = providerSettingsQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        queryStep.fail('invalid provider query');
        step.fail('invalid provider query');
        return reply
          .status(400)
          .send({ error: 'Invalid provider query', issues: parsedQuery.error.issues });
      }
      queryStep.succeed(undefined, { enabledOnly: parsedQuery.data.enabledOnly });

      const loadStep = child('load');
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const thinkingRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'default_thinking'`,
        [user.sub],
      );
      loadStep.succeed();

      const materializeStep = child('materialize');
      const materialized = await materializeProviderConfig(
        parseStoredJson(providerRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      const { providers, activeSelection } = parsedQuery.data.enabledOnly
        ? filterEnabledProviderConfig(materialized)
        : materialized;
      const defaultThinking = parseStoredDefaultThinking(parseStoredJson(thinkingRow?.value));
      materializeStep.succeed(undefined, { providers: providers.length });
      step.succeed(undefined, { providers: providers.length });

      return reply.send({ providers, activeSelection, defaultThinking });
    },
  );

  app.put(
    '/settings/providers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.put');
      const user = request.user as JwtPayload;

      const loadSelectionStep = child('load-selection');
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const thinkingRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'default_thinking'`,
        [user.sub],
      );
      loadSelectionStep.succeed(undefined, { found: selectionRow !== undefined });

      const parseStep = child('parse-body');
      const parsed = providerSettingsBodySchema.safeParse(request.body);
      if (!parsed.success) {
        parseStep.fail('invalid provider config');
        step.fail('invalid provider config');
        return reply
          .status(400)
          .send({ error: 'Invalid provider config', issues: parsed.error.issues });
      }
      parseStep.succeed();

      const materializeStep = child('materialize');
      const { providers, activeSelection } = await materializeProviderConfig(
        parsed.data.providers,
        parsed.data.activeSelection ?? parseStoredJson(selectionRow?.value),
      );
      const defaultThinking = parsed.data.defaultThinking
        ? parsed.data.defaultThinking
        : parseStoredDefaultThinking(parseStoredJson(thinkingRow?.value));
      materializeStep.succeed(undefined, { providers: providers.length });

      const saveProvidersStep = child('save-providers');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(providers)],
      );
      saveProvidersStep.succeed();

      const saveSelectionStep = child('save-active-selection');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(activeSelection)],
      );
      saveSelectionStep.succeed();
      const saveThinkingStep = child('save-default-thinking');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'default_thinking', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(defaultThinking)],
      );
      saveThinkingStep.succeed();
      step.succeed(undefined, { providers: providers.length });

      return reply.send({ providers, activeSelection, defaultThinking });
    },
  );

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
        compaction: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Invalid body' });
      }
      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
        [user.sub, JSON.stringify(parsed.data)],
      );
      saveStep.succeed();
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

      const parsed = upstreamRetrySettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Invalid upstream retry settings' });
      }

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, UPSTREAM_RETRY_SETTINGS_KEY, JSON.stringify(parsed.data)],
      );
      saveStep.succeed(undefined, { maxRetries: parsed.data.maxRetries });
      step.succeed(undefined, { saved: true });

      return reply.send(parsed.data);
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

      const parsed = compactionSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: 'Invalid compaction settings' });
      }

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, COMPACTION_SETTINGS_KEY, JSON.stringify(parsed.data)],
      );
      saveStep.succeed(undefined, {
        auto: parsed.data.auto,
        prune: parsed.data.prune,
        ...(typeof parsed.data.reserved === 'number' ? { reserved: parsed.data.reserved } : {}),
      });
      step.succeed(undefined, { saved: true });

      return reply.send(parsed.data);
    },
  );

  app.get(
    '/settings/mcp-servers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.mcp-servers.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
        [user.sub],
      );
      loadStep.succeed(undefined, { found: row !== undefined });

      const parseStep = child('parse-json');
      if (row?.value) {
        try {
          const servers = JSON.parse(row.value) as unknown[];
          parseStep.succeed(undefined, { servers: Array.isArray(servers) ? servers.length : 0 });
          step.succeed(undefined, { servers: Array.isArray(servers) ? servers.length : 0 });
          return reply.send({ servers });
        } catch {
          parseStep.fail('invalid mcp_servers JSON');
          step.succeed(undefined, { servers: 0 });
          return reply.send({ servers: [] });
        }
      }

      parseStep.succeed(undefined, { servers: 0 });
      step.succeed(undefined, { servers: 0 });
      return reply.send({ servers: [] });
    },
  );

  app.put(
    '/settings/mcp-servers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.mcp-servers.put');
      const user = request.user as JwtPayload;
      const body = request.body as { servers: unknown };

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(body.servers)],
      );
      saveStep.succeed();
      step.succeed();

      return reply.send({ ok: true });
    },
  );

  app.get(
    '/settings/model-prices',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.model-prices.get');
      const builtinPrices = [
        { modelName: 'claude-opus-4-5', inputPer1m: 15.0, outputPer1m: 75.0 },
        { modelName: 'claude-3-5-sonnet-20241022', inputPer1m: 3.0, outputPer1m: 15.0 },
        { modelName: 'claude-3-5-haiku-20241022', inputPer1m: 0.8, outputPer1m: 4.0 },
        { modelName: 'gpt-4o', inputPer1m: 2.5, outputPer1m: 10.0 },
        { modelName: 'gpt-4o-mini', inputPer1m: 0.15, outputPer1m: 0.6 },
        { modelName: 'deepseek-chat', inputPer1m: 0.27, outputPer1m: 1.1 },
        { modelName: 'deepseek-reasoner', inputPer1m: 0.55, outputPer1m: 2.19 },
        { modelName: 'qwen-max', inputPer1m: 0.4, outputPer1m: 1.2 },
      ];
      step.succeed(undefined, { models: builtinPrices.length });
      return reply.send({ models: builtinPrices });
    },
  );

  app.delete(
    '/settings/diagnostics',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.diagnostics.clear');
      const user = request.user as JwtPayload;
      sqliteRun(
        `DELETE FROM audit_logs
         WHERE is_error = 1
           AND session_id IN (
             SELECT id FROM sessions WHERE user_id = ?
           )`,
        [user.sub],
      );
      step.succeed(undefined, { cleared: true });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/settings/dev-logs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.dev-logs.list');
      const user = request.user as JwtPayload;
      const queryStep = child('query');
      const rows = sqliteAll<AuditLogRow>(
        `SELECT audit_logs.id,
                audit_logs.session_id,
                audit_logs.tool_name,
                audit_logs.request_id,
                audit_logs.input_json,
                audit_logs.output_json,
                audit_logs.is_error,
                audit_logs.duration_ms,
                audit_logs.created_at
         FROM audit_logs
         INNER JOIN sessions ON sessions.id = audit_logs.session_id
         WHERE sessions.user_id = ?
         ORDER BY audit_logs.created_at DESC
         LIMIT 100`,
        [user.sub],
      );
      queryStep.succeed(undefined, { rows: rows.length });

      const mapStep = child('map');
      const auditLogs = rows.map((row) => {
        const input = sanitizeAuditPayload(parseStoredJson(row.input_json ?? undefined));
        const output = sanitizeAuditPayload(parseStoredJson(row.output_json ?? undefined));
        const summary = extractAuditSummary(output);

        return {
          id: String(row.id),
          sessionId: row.session_id,
          requestId: row.request_id,
          level: row.is_error ? 'error' : 'info',
          message:
            summary ?? (row.is_error ? `${row.tool_name} 执行失败` : `${row.tool_name} 执行完成`),
          toolName: row.tool_name,
          durationMs: row.duration_ms,
          createdAt: row.created_at,
          input,
          output,
          isError: row.is_error === 1,
          source: 'tool',
        };
      });
      const workflowLogs = listRequestWorkflowLogs(user.sub, 100).map((row) => ({
        id: `workflow-${row.id}`,
        sessionId: row.session_id,
        requestId: row.request_id,
        level: row.status_code >= 400 ? 'error' : 'info',
        message: `${row.method} ${row.path} → ${row.status_code}`,
        toolName: 'request_workflow',
        durationMs: undefined,
        createdAt: row.created_at,
        input: undefined,
        output: sanitizeAuditPayload(parseStoredJson(row.workflow_json)),
        isError: row.status_code >= 400,
        source: 'workflow',
      }));
      const logs = [...auditLogs, ...workflowLogs].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
      mapStep.succeed(undefined, { logs: logs.length });
      step.succeed(undefined, { logs: logs.length });

      return reply.send({ logs });
    },
  );

  app.get(
    '/settings/file-patterns',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.file-patterns.get');
      const user = request.user as JwtPayload;
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'file_patterns'`,
        [user.sub],
      );
      const patterns = row ? (JSON.parse(row.value) as string[]) : [];
      step.succeed(undefined, { count: patterns.length });
      return reply.send({ patterns });
    },
  );

  app.put(
    '/settings/file-patterns',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.file-patterns.put');
      const user = request.user as JwtPayload;
      const body = z.object({ patterns: z.array(z.string()) }).safeParse(request.body);
      if (!body.success) {
        step.fail('invalid body');
        return reply.status(400).send({ error: body.error.issues });
      }
      sqliteRun(
        `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'file_patterns', ?)`,
        [user.sub, JSON.stringify(body.data.patterns)],
      );
      step.succeed(undefined, { saved: body.data.patterns.length });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/settings/version',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(_request, 'settings.version.get');
      const currentVersion = APP_VERSION;

      let latestVersion: string | null = null;
      let updateAvailable = false;
      let checkError: string | null = null;

      try {
        const response = await fetch('https://registry.npmjs.org/@openAwork/agent-gateway/latest', {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = (await response.json()) as { version?: string };
          latestVersion = data.version ?? null;
          if (latestVersion) {
            const parts = (v: string) => v.split('.').map(Number) as [number, number, number];
            const [curMajor, curMinor, curPatch] = parts(currentVersion);
            const [latMajor, latMinor, latPatch] = parts(latestVersion);
            updateAvailable =
              latMajor > curMajor ||
              (latMajor === curMajor && latMinor > curMinor) ||
              (latMajor === curMajor && latMinor === curMinor && latPatch > curPatch);
          }
        }
      } catch {
        checkError = 'Unable to reach npm registry';
      }

      step.succeed(undefined, { currentVersion, updateAvailable });
      return reply.send({
        currentVersion,
        latestVersion,
        updateAvailable,
        checkError,
        checkedAt: new Date().toISOString(),
      });
    },
  );
}
