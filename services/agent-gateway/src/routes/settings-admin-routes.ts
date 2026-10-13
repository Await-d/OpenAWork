import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  listPermissionGrantsForUser,
  reconcilePermissionGrants,
} from '../permission/permission-grants-store.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  clearChannelErrorRecords,
  listChannelErrorAuditLogs,
  listChannelHealthRecords,
} from '../channels/channel-error-store.js';
import {
  clearRequestWorkflowLogs,
  listRequestWorkflowLogs,
} from '../runtime/request-workflow-log-store.js';
import { WORKSPACE_ROOT } from '../infra/db.js';
import {
  PLUGIN_SETTINGS_KEY,
  pluginSettingsSchema,
  readPluginSettingsForUser,
} from '../tools/plugin-tool-settings.js';
import {
  listEffectiveWorkspacePermissionRules,
  loadWorkspacePermissionConfig,
  writeWorkspacePermissionConfig,
  PERMISSION_CATEGORIES,
} from '@openAwork/agent-core';
import { z } from 'zod';
import { checkLatestReleaseVersion } from '../app/release-version-check.js';
import { loadAppVersion } from '../app/app-version.js';

import {
  extractAuditSummary,
  parseStoredJson,
  sanitizeAuditPayload,
  type AuditLogRow,
  type PermissionRequestHistoryRow,
  type UserSettingRow,
} from './settings-support.js';

const APP_VERSION = loadAppVersion();

export async function registerSettingsAdminRoutes(app: FastifyInstance): Promise<void> {
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
      const user = request.user as JwtPayload;
      const config = loadWorkspacePermissionConfig(WORKSPACE_ROOT);
      // Return the merged effective view so legacy `permanentGrants`
      // entries (from before permanent grants were stored as `rules`) and the
      // user's durable `permission_grants` are visible and editable here.
      const rules = listEffectiveWorkspacePermissionRules(config);
      const grantRules = listPermissionGrantsForUser(user.sub).map((grant) => ({
        permission: grant.tool_name,
        pattern: grant.scope,
        action: 'allow' as const,
      }));
      const byKey = new Map<string, (typeof rules)[number]>();
      for (const rule of [...rules, ...grantRules]) {
        byKey.set(`${rule.permission}\u0000${rule.pattern}\u0000${rule.action}`, rule);
      }
      const mergedRules = [...byKey.values()];
      step.succeed(undefined, { count: mergedRules.length });
      return reply.send({ rules: mergedRules, categories: PERMISSION_CATEGORIES });
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
      const user = request.user as JwtPayload;
      const config = loadWorkspacePermissionConfig(WORKSPACE_ROOT);
      // Clear legacy `permanentGrants` on save so deletions from the
      // settings panel actually take effect. The GET handler already
      // surfaces these entries as `rules`, so any grant the user wanted
      // to keep is round-tripped through `parsed.rules`.
      const next = { ...config, rules: parsed.rules, permanentGrants: [] };
      writeWorkspacePermissionConfig(WORKSPACE_ROOT, next);
      // Revoke any durable user-scoped grant the user removed in this panel.
      // Grants are never created here.
      reconcilePermissionGrants(user.sub, parsed.rules);
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
                    audit_logs.pending_interaction,
                    audit_logs.duration_ms,
                    audit_logs.created_at
             FROM audit_logs
             INNER JOIN sessions ON sessions.id = audit_logs.session_id
             WHERE sessions.user_id = ? AND audit_logs.is_error = 1
               AND audit_logs.pending_interaction = 0
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
                    audit_logs.pending_interaction,
                    audit_logs.duration_ms,
                    audit_logs.created_at
             FROM audit_logs
             INNER JOIN sessions ON sessions.id = audit_logs.session_id
             WHERE sessions.user_id = ? AND audit_logs.is_error = 1
               AND audit_logs.pending_interaction = 0
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
           AND audit_logs.pending_interaction = 0
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
                audit_logs.pending_interaction,
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
        // 提问 / 审批这类挂起必须以 is_error=1 落库（模型侧要看到失败才停下来等输入），
        // 但对人不是故障：降级为 info 保留在日志流里，又不进「待排查问题合计」。
        const isPendingInteraction = row.pending_interaction === 1;
        const isError = row.is_error === 1 && !isPendingInteraction;

        return {
          id: String(row.id),
          sessionId: row.session_id,
          requestId: row.request_id,
          level: isError ? 'error' : 'info',
          message:
            summary ??
            (isError
              ? `${row.tool_name} 执行失败`
              : isPendingInteraction
                ? `${row.tool_name} 等待用户交互`
                : `${row.tool_name} 执行完成`),
          toolName: row.tool_name,
          durationMs: row.duration_ms,
          createdAt: row.created_at,
          input,
          output,
          isError,
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

  app.delete(
    '/settings/dev-logs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.dev-logs.clear');
      const user = request.user as JwtPayload;
      // 列表把「工具执行日志」(audit_logs)与「请求工作流日志」(request_workflow_logs)
      // 合并展示,清除必须同时覆盖两张表,否则清完仍会残留工作流日志。
      sqliteRun(
        `DELETE FROM audit_logs
         WHERE session_id IN (
           SELECT id FROM sessions WHERE user_id = ?
         )`,
        [user.sub],
      );
      clearRequestWorkflowLogs(user.sub);
      step.succeed(undefined, { cleared: true });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/settings/channel-troubleshooting',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.channel-troubleshooting.get');
      const user = request.user as JwtPayload;
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
      });
      const { limit } = parseQuery(querySchema, request.query);
      const channels = listChannelHealthRecords({ ownerUserId: user.sub });
      const auditLogs = listChannelErrorAuditLogs(user.sub, limit);
      step.succeed(undefined, { channels: channels.length, auditLogs: auditLogs.length });
      return reply.send({ channels, auditLogs });
    },
  );

  app.delete(
    '/settings/channel-troubleshooting',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.channel-troubleshooting.clear');
      const user = request.user as JwtPayload;
      const cleared = clearChannelErrorRecords(user.sub);
      step.succeed(undefined, cleared);
      return reply.send({ ok: true, ...cleared });
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.version.get');
      const currentVersion = APP_VERSION;
      const versionQuerySchema = z.object({
        channel: z.enum(['preview', 'stable']).optional(),
      });
      const parsedQuery = parseQuery(versionQuerySchema, request.query);
      const channel = parsedQuery.channel ?? 'preview';

      // Release channel is GitHub (desktop updater manifests), not npm.
      // @openAwork/agent-gateway is private and is never published to the registry.
      const releaseCheck = await checkLatestReleaseVersion({ currentVersion, channel });

      step.succeed(undefined, {
        currentVersion,
        updateAvailable: releaseCheck.updateAvailable,
        source: releaseCheck.source ?? 'none',
        channel: releaseCheck.channel,
      });
      return reply.send({
        currentVersion,
        latestVersion: releaseCheck.latestVersion,
        updateAvailable: releaseCheck.updateAvailable,
        checkError: releaseCheck.checkError,
        checkedAt: new Date().toISOString(),
        channel: releaseCheck.channel,
        source: releaseCheck.source,
      });
    },
  );
}
