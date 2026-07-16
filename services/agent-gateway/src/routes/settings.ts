import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { getProviderCatalogUi } from '@openAwork/agent-core';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { loadAppVersion } from '../app/app-version.js';
import { resolveAuxiliaryLlmConfig } from '../provider/auxiliary-llm-config.js';
import { invalidateCatalog, invalidateAllCatalogs } from '../provider/provider-catalog.js';
import { refreshModelsDevDataOrThrow } from '@openAwork/agent-core';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  COMPACTION_SETTINGS_KEY,
  compactionSettingsSchema,
  readCompactionSettings,
} from '../compaction/compaction-policy.js';
import {
  activeSelectionSchema,
  filterEnabledProviderConfig,
  imageGenerationDefaultsSchema,
  materializeProviderConfig,
  normalizeSingleProviderForTest,
  parseStoredDefaultThinking,
  parseStoredImageGenerationDefaults,
  providerConnectivityTestBodySchema,
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
} from '../provider/provider-config.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { listRequestWorkflowLogs } from '../runtime/request-workflow-log-store.js';
import {
  isMcpServerConnectedForUser,
  listMcpToolsForUser,
  loadConfiguredMcpServersForUser,
  retryMcpConnectionForUser,
} from '../mcp/mcp-runtime.js';
import { BUILTIN_MCP_IDS } from '../mcp/builtin-mcps.js';
import {
  buildSettingsBuiltinMcpServers,
  mcpServersBodySchema,
  mcpStatusQuerySchema,
  sanitizePersistedMcpServers,
} from '../mcp/mcp-settings-schemas.js';
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
  PLUGIN_SETTINGS_KEY,
  pluginSettingsSchema,
  readPluginSettingsForUser,
} from '../tools/plugin-tool-settings.js';
import {
  buildCompanionFeatureState,
  companionSettingsUpdateSchema,
  resolveCompanionProfileForAgent,
  getCompanionSettingsKey,
  loadCompanionSettingsForUser,
} from '../workspace/companion-settings.js';
import {
  loadUserProfileSettings,
  resolveUserDisplayName,
  saveUserProfileSettings,
  userProfileSettingsUpdateSchema,
} from '../user/user-profile-settings.js';
import {
  listEffectiveWorkspacePermissionRules,
  loadWorkspacePermissionConfig,
  writeWorkspacePermissionConfig,
  PERMISSION_CATEGORIES,
} from '@openAwork/agent-core';
import type { AIProvider } from '@openAwork/agent-core';
import { WORKSPACE_ROOT } from '../infra/db.js';
import { z } from 'zod';
import { getTelemetryConsent, setTelemetryConsent } from '../telemetry/telemetry-consent-store.js';
import { trackEvent } from '../telemetry/telemetry-service.js';
import type { TelemetryEventName } from '@openAwork/telemetry';

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

function mergeActiveSelectionPreservingStored(input: {
  incoming: unknown;
  stored: unknown;
}): unknown {
  const incomingParsed = activeSelectionSchema.safeParse(input.incoming);
  if (!incomingParsed.success) {
    return input.stored;
  }

  const storedParsed = activeSelectionSchema.safeParse(input.stored);
  if (!storedParsed.success) {
    return incomingParsed.data;
  }

  return {
    ...storedParsed.data,
    ...incomingParsed.data,
    chat: incomingParsed.data.chat,
    fast: incomingParsed.data.fast,
    compaction: incomingParsed.data.compaction ?? storedParsed.data.compaction,
    image: incomingParsed.data.image ?? storedParsed.data.image,
  };
}

function mergeImageGenerationDefaultsPreservingStored(input: {
  incoming: unknown;
  stored: unknown;
}) {
  const incomingParsed = imageGenerationDefaultsSchema.safeParse(input.incoming);
  if (!incomingParsed.success) {
    return parseStoredImageGenerationDefaults(input.stored);
  }

  return {
    ...parseStoredImageGenerationDefaults(input.stored),
    ...incomingParsed.data,
  };
}

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
  const companionSettingsQuerySchema = z.object({
    agentId: z.string().trim().min(1).max(120).optional(),
  });

  app.get(
    '/settings/profile',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.profile.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const settings = loadUserProfileSettings(user.sub);
      loadStep.succeed(undefined, { hasNickname: settings.nickname !== null });
      step.succeed(undefined, { hasNickname: settings.nickname !== null });

      return reply.send({
        email: user.email,
        nickname: settings.nickname,
        displayName: resolveUserDisplayName({
          email: user.email,
          nickname: settings.nickname,
        }),
        updatedAt: settings.updatedAt ?? null,
      });
    },
  );

  app.put(
    '/settings/profile',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.profile.put');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(userProfileSettingsUpdateSchema, request.body);
      parseStep.succeed(undefined, {
        nickname:
          typeof body.nickname === 'string'
            ? body.nickname
            : body.nickname === null
              ? '(cleared)'
              : '(unchanged)',
      });

      const saveStep = child('save');
      const settings = saveUserProfileSettings(user.sub, body);
      saveStep.succeed(undefined, { hasNickname: settings.nickname !== null });
      step.succeed(undefined, { hasNickname: settings.nickname !== null });

      return reply.send({
        email: user.email,
        nickname: settings.nickname,
        displayName: resolveUserDisplayName({
          email: user.email,
          nickname: settings.nickname,
        }),
        updatedAt: settings.updatedAt ?? null,
      });
    },
  );

  app.get(
    '/settings/companion',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.companion.get');
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const parsedQuery = parseQuery(companionSettingsQuerySchema, request.query);
      queryStep.succeed(undefined, {
        agentId: parsedQuery.agentId ?? 'default',
      });

      const loadStep = child('load');
      const settings = loadCompanionSettingsForUser(user.sub, user.email, parsedQuery.agentId);
      loadStep.succeed(undefined, { found: true });
      step.succeed(undefined, { voiceOutputEnabled: settings.preferences.voiceOutputEnabled });
      return reply.send({
        activeBinding: settings.activeBinding,
        bindings: settings.bindings,
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

      const queryStep = child('parse-query');
      const parsedQuery = parseQuery(companionSettingsQuerySchema, request.query);
      queryStep.succeed(undefined, {
        agentId: parsedQuery.agentId ?? 'default',
      });

      const parseStep = child('parse-body');
      const parsed = parseBody(companionSettingsUpdateSchema, request.body);
      parseStep.succeed(undefined, {
        bindingCount: parsed.bindings ? Object.keys(parsed.bindings).length : 0,
        preferenceCount: parsed.preferences ? Object.keys(parsed.preferences).length : 0,
      });

      const loadStep = child('load-existing');
      const existing = loadCompanionSettingsForUser(user.sub, user.email, parsedQuery.agentId);
      loadStep.succeed(undefined, { found: true });
      const nextSettings = {
        bindings: parsed.bindings ?? existing.bindings,
        preferences: {
          ...existing.preferences,
          ...(parsed.preferences ?? {}),
        },
        profile: existing.profile,
        updatedAt: new Date().toISOString(),
      };

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, getCompanionSettingsKey(), JSON.stringify(nextSettings)],
      );
      saveStep.succeed(undefined, {
        voiceOutputEnabled: nextSettings.preferences.voiceOutputEnabled,
      });
      step.succeed(undefined, { saved: true });

      const resolved = {
        ...nextSettings,
        activeBinding: parsedQuery.agentId ? nextSettings.bindings[parsedQuery.agentId] : undefined,
        profile: resolveCompanionProfileForAgent({
          agentId: parsedQuery.agentId,
          bindings: nextSettings.bindings,
          preferences: nextSettings.preferences,
          userEmail: user.email,
        }),
      };

      return reply.send({
        activeBinding: resolved.activeBinding,
        bindings: resolved.bindings,
        feature: buildCompanionFeatureState(resolved.preferences),
        preferences: resolved.preferences,
        profile: resolved.profile,
      });
    },
  );

  app.get(
    '/settings/mcp-status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.mcp-status.get');
      const user = request.user as JwtPayload;
      const query = parseQuery(mcpStatusQuerySchema, request.query);

      // 走 mcp-runtime 而不是直接读 SQL，让前端展示同时包含
      // 内置 MCP（websearch / grep_app）与用户自定义项；同 id 的
      // 用户配置已在 runtime 层完成覆盖。`mcp-status` 仅用于展示，
      // PUT/GET `/settings/mcp-servers` 仍只镜像用户原始 JSON，
      // 避免内置项被错误写回 SQLite。
      const loadStep = child('load');
      const merged = loadConfiguredMcpServersForUser(user.sub);
      loadStep.succeed(undefined, { servers: merged.length });

      const builtinIds = new Set<string>(BUILTIN_MCP_IDS);
      if (query.includeTools) {
        const catalogStep = child('list-tools');
        const catalogs = await listMcpToolsForUser(user.sub);
        catalogStep.succeed(undefined, { servers: catalogs.length });

        const servers = catalogs.map((catalog) => {
          const configured = merged.find((entry) => entry.id === catalog.serverId);
          const disabledTools = configured?.disabledTools ?? [];
          return {
            id: catalog.serverId,
            name: catalog.serverName,
            type: catalog.transport,
            status: catalog.status,
            enabled: catalog.enabled,
            builtin: builtinIds.has(catalog.serverId),
            toolCount: catalog.tools.length,
            tools: catalog.tools.map((tool) => ({
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
            })),
            disabledTools,
            ...(catalog.error ? { error: catalog.error } : {}),
          };
        });

        step.succeed(undefined, { servers: servers.length, includeTools: true });
        return reply.send({ servers });
      }

      // Real connection status — `isMcpServerConnectedForUser` is a
      // peek-only `Map.has` against the pool, so polling this
      // endpoint never warms an idle connection. Disabled servers
      // and servers we've never tried still report `disconnected`,
      // which the frontend renders as a grey dot.
      const servers = merged.map((server) => ({
        id: server.id,
        name: server.name,
        type: server.transport,
        status: !server.enabled
          ? ('disabled' as const)
          : isMcpServerConnectedForUser(user.sub, server)
            ? ('connected' as const)
            : ('disconnected' as const),
        enabled: server.enabled,
        builtin: builtinIds.has(server.id),
        toolCount: 0,
        disabledTools: server.disabledTools ?? [],
      }));

      step.succeed(undefined, { servers: servers.length });
      return reply.send({ servers });
    },
  );

  app.post(
    '/settings/mcp-servers/:id/retry',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.mcp-servers.retry');
      const user = request.user as JwtPayload;
      const params = request.params as { id?: string };
      const serverId = (params.id ?? '').trim();
      if (!serverId) {
        step.fail('serverId required');
        return reply.code(400).send({ error: '缺少 MCP 服务标识。' });
      }

      try {
        const result = await retryMcpConnectionForUser(user.sub, serverId);
        // Note: we deliberately call `succeed` even when
        // `result.status === 'error'` — the route processed
        // successfully, the *MCP* failed. We surface
        // `result.error` in the workflow fields so an operator
        // grepping logs by `status: 'error'` immediately sees the
        // SDK / transport message without having to chase across
        // request ids.
        step.succeed(undefined, {
          serverId: result.serverId,
          status: result.status,
          toolCount: result.toolCount,
          durationMs: result.durationMs,
          ...(result.error ? { mcpError: result.error } : {}),
        });
        // We deliberately return 200 even on `status: 'error'` —
        // the failure is a successful diagnostic outcome, not a
        // protocol error. The frontend uses `result.status` and
        // `result.error` to render red/green chips.
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        step.fail(msg);
        // The only path here is `getConfiguredServerByIdForUser`
        // throwing because the id genuinely doesn't exist in either
        // the user's settings or the builtin list. 404 is the
        // honest answer.
        return reply.code(404).send({ error: '目标 MCP 服务不存在。' });
      }
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
    '/settings/permission-rules',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.permission-rules.list');
      const config = loadWorkspacePermissionConfig(WORKSPACE_ROOT);
      // Return the merged effective view so legacy `permanentGrants`
      // entries (from before permanent grants were stored as `rules`)
      // are visible and editable from the settings panel.
      const rules = listEffectiveWorkspacePermissionRules(config);
      step.succeed(undefined, { count: rules.length });
      return reply.send({ rules, categories: PERMISSION_CATEGORIES });
    },
  );

  app.put(
    '/settings/permission-rules',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.permission-rules.update');
      const bodySchema = z.object({
        rules: z.array(
          z.object({
            permission: z.string().min(1),
            pattern: z.string().min(1),
            action: z.enum(['allow', 'deny', 'ask']),
          }),
        ),
      });
      const parsed = parseBody(bodySchema, request.body);
      const config = loadWorkspacePermissionConfig(WORKSPACE_ROOT);
      // Clear legacy `permanentGrants` on save so deletions from the
      // settings panel actually take effect. The GET handler already
      // surfaces these entries as `rules`, so any grant the user wanted
      // to keep is round-tripped through `parsed.rules`.
      const next = { ...config, rules: parsed.rules, permanentGrants: [] };
      writeWorkspacePermissionConfig(WORKSPACE_ROOT, next);
      step.succeed(undefined, { count: parsed.rules.length });
      return reply.send({ ok: true, rules: parsed.rules });
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
      const parsedQuery = parseQuery(querySchema, request.query);
      const dateFilter = parsedQuery.date ?? null;
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
    '/settings/providers/catalog',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      // 平台「单一事实来源」的 UI 投影：logo / 显示名 / 回退字形 / 上游变体 /
      // 别名。前端据此渲染选择器与设置页，新增平台无需改前端映射表。
      return reply.send({ catalog: getProviderCatalogUi() });
    },
  );

  app.get(
    '/settings/providers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.get');
      const user = request.user as JwtPayload;

      const queryStep = child('parse-query');
      const parsedQuery = parseQuery(providerSettingsQuerySchema, request.query);
      queryStep.succeed(undefined, { enabledOnly: parsedQuery.enabledOnly });

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
      const imageDefaultsRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'image_generation_defaults'`,
        [user.sub],
      );
      loadStep.succeed();

      const materializeStep = child('materialize');
      const materialized = await materializeProviderConfig(
        parseStoredJson(providerRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      const { providers, activeSelection } = parsedQuery.enabledOnly
        ? filterEnabledProviderConfig(materialized)
        : materialized;
      const defaultThinking = parseStoredDefaultThinking(parseStoredJson(thinkingRow?.value));
      const imageGenerationDefaults = parseStoredImageGenerationDefaults(
        parseStoredJson(imageDefaultsRow?.value),
      );
      materializeStep.succeed(undefined, { providers: providers.length });
      step.succeed(undefined, { providers: providers.length });

      return reply.send({
        providers,
        activeSelection,
        defaultThinking,
        imageGenerationDefaults,
      });
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
      const imageDefaultsRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'image_generation_defaults'`,
        [user.sub],
      );
      loadSelectionStep.succeed(undefined, { found: selectionRow !== undefined });

      const parseStep = child('parse-body');
      const parsed = parseBody(providerSettingsBodySchema, request.body);
      parseStep.succeed();

      const materializeStep = child('materialize');
      const mergedActiveSelection = mergeActiveSelectionPreservingStored({
        incoming: parsed.activeSelection,
        stored: parseStoredJson(selectionRow?.value),
      });
      const { providers, activeSelection } = await materializeProviderConfig(
        parsed.providers,
        mergedActiveSelection,
      );
      const defaultThinking = parsed.defaultThinking
        ? parsed.defaultThinking
        : parseStoredDefaultThinking(parseStoredJson(thinkingRow?.value));
      const imageGenerationDefaults = mergeImageGenerationDefaultsPreservingStored({
        incoming: parsed.imageGenerationDefaults,
        stored: parseStoredJson(imageDefaultsRow?.value),
      });
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
      const saveImageDefaultsStep = child('save-image-generation-defaults');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'image_generation_defaults', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(imageGenerationDefaults)],
      );
      saveImageDefaultsStep.succeed();

      // 方案 3：配置变更后 invalidate catalog 缓存
      invalidateCatalog(user.sub);

      step.succeed(undefined, { providers: providers.length });

      return reply.send({
        providers,
        activeSelection,
        defaultThinking,
        imageGenerationDefaults,
      });
    },
  );

  app.post(
    '/settings/providers/test',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.test');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const parsed = parseBody(providerConnectivityTestBodySchema, request.body);
      parseStep.succeed();

      // 解析待测 provider：优先用请求体里内联的 provider(测「尚未保存」的表单值)，
      // 否则按 providerId 从已保存配置里取。
      const resolveStep = child('resolve-provider');
      let provider: AIProvider | undefined;
      if (parsed.provider) {
        const normalized = normalizeSingleProviderForTest(parsed.provider);
        provider = normalized;
      } else if (parsed.providerId) {
        const providerRow = sqliteGet<UserSettingRow>(
          `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
          [user.sub],
        );
        const selectionRow = sqliteGet<UserSettingRow>(
          `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
          [user.sub],
        );
        const { providers } = await materializeProviderConfig(
          parseStoredJson(providerRow?.value),
          parseStoredJson(selectionRow?.value),
        );
        provider = providers.find((item) => item.id === parsed.providerId);
      }

      if (!provider) {
        resolveStep.fail('provider not found');
        step.fail('provider not found');
        return reply.status(404).send({
          ok: false,
          status: 'error',
          message: '未找到待测的 provider，请先保存配置或提供完整的 provider 信息。',
        });
      }

      const model = provider.defaultModels.find((item) => item.id === parsed.modelId);
      if (!model) {
        resolveStep.fail('model not found');
        step.fail('model not found');
        return reply.status(404).send({
          ok: false,
          status: 'error',
          message: `provider「${provider.name}」下未找到模型「${parsed.modelId}」。`,
        });
      }
      resolveStep.succeed(undefined, { providerId: provider.id, modelId: parsed.modelId });

      const probeStep = child('probe');
      const { testProviderConnectivity } =
        await import('../provider/provider-connectivity-test.js');
      const result = await testProviderConnectivity({
        provider,
        modelId: parsed.modelId,
      });
      if (result.ok) {
        probeStep.succeed(undefined, { latencyMs: result.latencyMs ?? 0 });
        step.succeed(undefined, { status: result.status });
      } else {
        probeStep.fail(result.status);
        step.fail(result.status);
      }

      // 业务层失败仍以 200 返回结构化结果，让前端按钮统一按 `ok` 字段渲染状态，
      // 而不是把「配置错误」当成 HTTP 传输错误处理。
      return reply.send(result);
    },
  );

  // 手动同步内置模型目录：强制从 models.dev 重新拉取一次（绕过每小时定时刷新），
  // 成功后让所有用户的 provider catalog 缓存失效，下次请求即重建出最新模型清单。
  app.post(
    '/settings/providers/sync',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.sync');

      const fetchStep = child('refresh-models-dev');
      let data: Awaited<ReturnType<typeof refreshModelsDevDataOrThrow>>;
      try {
        // 用「会抛错」的刷新变体：这样网络失败能被真实反馈给用户，而不是被
        // 后台定时刷新那套「静默吞错」逻辑掩盖、误报成功。
        data = await refreshModelsDevDataOrThrow();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fetchStep.fail(message);
        step.fail('models.dev unavailable');
        return reply.status(502).send({
          ok: false,
          message: `无法从 models.dev 拉取模型目录：${message}`,
        });
      }
      const providerCount = Object.keys(data).length;
      const modelCount = Object.values(data).reduce(
        (sum, provider) => sum + Object.keys(provider.models ?? {}).length,
        0,
      );
      fetchStep.succeed(undefined, { providers: providerCount, models: modelCount });

      // models.dev 是全局数据源，刷新后所有用户的 catalog 都过期了，全部失效。
      invalidateAllCatalogs();

      step.succeed(undefined, { providers: providerCount, models: modelCount });
      return reply.send({ ok: true, providerCount, modelCount });
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

  // ── Plugin settings ──────────────────────────────────────────

  app.get(
    '/settings/plugins',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.plugins.get');
      const user = request.user as JwtPayload;

      const loadStep = child('load');
      const settings = readPluginSettingsForUser(user.sub);
      loadStep.succeed(undefined, {
        imageGeneration: settings.imageGeneration?.enabled === true,
        desktopControl: settings.desktopControl?.enabled === true,
      });

      step.succeed();
      return reply.send(settings);
    },
  );

  app.put(
    '/settings/plugins',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.plugins.put');
      const user = request.user as JwtPayload;

      const parsed = parseBody(pluginSettingsSchema, request.body);

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, PLUGIN_SETTINGS_KEY, JSON.stringify(parsed)],
      );
      saveStep.succeed();
      step.succeed(undefined, { saved: true });

      return reply.send(parsed);
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
      const builtinServers = buildSettingsBuiltinMcpServers();

      const parseStep = child('parse-json');
      if (row?.value) {
        try {
          const parsed: unknown = JSON.parse(row.value);
          const servers = sanitizePersistedMcpServers(parsed);
          parseStep.succeed(undefined, { servers: Array.isArray(servers) ? servers.length : 0 });
          step.succeed(undefined, { servers: Array.isArray(servers) ? servers.length : 0 });
          return reply.send({ servers, builtinServers });
        } catch {
          parseStep.fail('invalid mcp_servers JSON');
          step.succeed(undefined, { servers: 0 });
          return reply.send({ servers: [], builtinServers });
        }
      }

      parseStep.succeed(undefined, { servers: 0 });
      step.succeed(undefined, { servers: 0 });
      return reply.send({ servers: [], builtinServers });
    },
  );

  app.put(
    '/settings/mcp-servers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.mcp-servers.put');
      const user = request.user as JwtPayload;
      const body = parseBody(mcpServersBodySchema, request.body);

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(body.servers)],
      );
      saveStep.succeed(undefined, { servers: body.servers.length });
      step.succeed(undefined, { servers: body.servers.length });

      return reply.send({ ok: true, servers: body.servers });
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
      // Tolerant parse: a corrupt `file_patterns` row (crash mid-write, disk
      // error, hand-edited DB) must degrade to an empty list rather than 500
      // the route. Every sibling reader in this file already guards its parse;
      // this was the lone unguarded one. (§0.115/§0.116 user_settings class.)
      const parsedPatterns = parseStoredJson(row?.value);
      const patterns = Array.isArray(parsedPatterns)
        ? parsedPatterns.filter((value): value is string => typeof value === 'string')
        : [];
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
      const body = parseBody(z.object({ patterns: z.array(z.string()) }), request.body);
      sqliteRun(
        `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'file_patterns', ?)`,
        [user.sub, JSON.stringify(body.patterns)],
      );
      step.succeed(undefined, { saved: body.patterns.length });
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

  const buddyChatSchema = z.object({
    message: z.string().min(1).max(2000),
    context: z
      .object({
        attachedCount: z.number().optional(),
        hasStreamError: z.boolean().optional(),
        idleSeconds: z.number().optional(),
        lastToolName: z.string().nullable().optional(),
        sessionBusy: z.boolean().optional(),
        pendingApprovals: z.number().optional(),
        pendingQuestions: z.number().optional(),
        queuedCount: z.number().optional(),
        runningTasks: z.number().optional(),
        blockedTasks: z.number().optional(),
        streamErrorMessage: z.string().nullable().optional(),
        todoCount: z.number().optional(),
        toolCallCount: z.number().optional(),
      })
      .optional(),
    agentId: z.string().optional(),
  });

  app.post(
    '/settings/companion/chat',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.companion.chat');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(buddyChatSchema, request.body);
      parseStep.succeed();

      // Use the shared auxiliary LLM resolver so the companion chat
      // route honours the user's configured fast/inline provider
      // — critically, with providerType + upstreamProtocol forwarded so
      // anthropic_messages / responses providers do not silently fall
      // back to chat_completions. Env vars stay as the last-resort
      // fallback inside the resolver itself.
      const llmConfig = await resolveAuxiliaryLlmConfig(user.sub);
      if (!llmConfig) {
        step.fail('no llm config');
        return reply.status(503).send({ error: 'Companion 陪跑聊天模型尚未配置。' });
      }

      const {
        buildCompanionIntroText,
        buildCompanionWorkspaceContextText,
        loadCompanionSettingsForUser,
      } = await import('../workspace/companion-settings.js');
      const companionSettings = loadCompanionSettingsForUser(user.sub, user.email, body.agentId);
      const profile = companionSettings.profile;
      const intro = buildCompanionIntroText(profile);

      const contextParts: string[] = [];
      if (body.context) {
        const ctx = body.context;
        if (ctx.sessionBusy) contextParts.push('当前会话正在运行中');
        if (ctx.pendingApprovals && ctx.pendingApprovals > 0)
          contextParts.push(`${ctx.pendingApprovals} 个待审批项`);
        if (ctx.pendingQuestions && ctx.pendingQuestions > 0)
          contextParts.push(`${ctx.pendingQuestions} 个待回答问题`);
        if (ctx.runningTasks && ctx.runningTasks > 0)
          contextParts.push(`${ctx.runningTasks} 个正在运行的任务`);
        if (ctx.blockedTasks && ctx.blockedTasks > 0)
          contextParts.push(`${ctx.blockedTasks} 个被阻塞的任务`);
        if (ctx.todoCount && ctx.todoCount > 0) contextParts.push(`${ctx.todoCount} 个待办事项`);
        const companionContext = buildCompanionWorkspaceContextText({
          attachedCount: ctx.attachedCount,
          hasStreamError: ctx.hasStreamError,
          idleSeconds: ctx.idleSeconds,
          lastToolName: ctx.lastToolName,
          pendingApprovals: ctx.pendingApprovals,
          queuedCount: ctx.queuedCount,
          streamErrorMessage: ctx.streamErrorMessage,
          toolCallCount: ctx.toolCallCount,
        });
        if (companionContext) contextParts.push(companionContext);
      }

      const contextBlock =
        contextParts.length > 0
          ? `\n\n当前工作台状态：\n${contextParts.map((p) => `- ${p}`).join('\n')}`
          : '';

      const prompt = `你是 ${profile.name}，一个 OpenAWork 工作台的低打扰陪跑 companion。

角色设定：
${intro}
${profile.name} 的定位：${profile.archetype}。
行为基调：${profile.note}。
关注标签：${profile.traits.join(' / ')}。

你的行为准则：
1. 保持极短、低打扰，不主动展开，不抢主助手的话筒
2. 只在必要时补充轻量提醒、节奏反馈或陪伴式短句
3. 语气要贴合你的角色设定，但不要过度表演
4. 不要重复用户已经知道的信息
5. 用中文回复，控制在 40 字以内
${contextBlock}

用户对你说：${body.message}

请以 ${profile.name} 的身份简短回复：`;

      const chatStep = child('llm-chat');
      try {
        const { requestWorkflowLlmCompletion } = await import('./workflow-llm.js');
        const response = await requestWorkflowLlmCompletion({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
          ...(llmConfig.upstreamProtocol ? { upstreamProtocol: llmConfig.upstreamProtocol } : {}),
          prompt,
          temperature: 0.7,
        });
        chatStep.succeed(undefined, { outputLength: response.length });
        step.succeed();

        return reply.send({
          text: response.trim(),
          profileName: profile.name,
          profileSpecies: profile.species,
          tone: 'chat',
        });
      } catch (_error: unknown) {
        chatStep.fail('llm error');
        step.fail('llm error');
        return reply.status(500).send({ error: 'Companion 陪跑聊天失败。' });
      }
    },
  );

  // ── Telemetry consent & event reporting ────────────────────────

  const telemetryConsentSchema = z.object({
    status: z.enum(['accepted', 'declined']),
  });

  app.get(
    '/settings/telemetry/consent',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.telemetry.consent.get');
      const user = request.user as JwtPayload;
      const consent = getTelemetryConsent(user.sub);
      step.succeed(undefined, { status: consent.status ?? 'unset' });
      return reply.send(consent);
    },
  );

  app.put(
    '/settings/telemetry/consent',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.telemetry.consent.put');
      const user = request.user as JwtPayload;
      const parsed = parseBody(telemetryConsentSchema, request.body);
      setTelemetryConsent(user.sub, parsed.status);
      step.succeed(undefined, { status: parsed.status });
      return reply.send({ ok: true, status: parsed.status });
    },
  );

  const telemetryEventSchema = z.object({
    name: z.enum([
      'app_start',
      'session_created',
      'tool_call',
      'skill_installed',
      'error_boundary',
    ]) satisfies z.ZodType<TelemetryEventName>,
    properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  });

  app.post(
    '/settings/telemetry/event',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.telemetry.event');
      const user = request.user as JwtPayload;

      const consent = getTelemetryConsent(user.sub);
      if (consent.status !== 'accepted') {
        step.succeed(undefined, { skipped: 'no-consent' });
        return reply.status(403).send({ error: '遥测未授权。' });
      }

      const parsed = parseBody(telemetryEventSchema, request.body);
      trackEvent(user.sub, parsed.name, parsed.properties);
      step.succeed(undefined, { event: parsed.name });
      return reply.send({ ok: true });
    },
  );
}
