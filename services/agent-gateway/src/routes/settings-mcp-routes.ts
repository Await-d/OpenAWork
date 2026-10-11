import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  getMcpPoolKey,
  invalidateMcpServerConnectionForUser,
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

import { type UserSettingRow } from './settings-support.js';

export async function registerSettingsMcpRoutes(app: FastifyInstance): Promise<void> {
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

      // Snapshot the pre-save config so we can tear down the old pooled
      // connections after persisting. A session that already cached a
      // broken adapter (connect succeeded once, then auth/transport
      // started failing) would otherwise keep reusing it and stay in the
      // `error` state even after the user fixes the server here.
      const previousServers = loadConfiguredMcpServersForUser(user.sub);

      const saveStep = child('save');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(body.servers)],
      );
      saveStep.succeed(undefined, { servers: body.servers.length });

      // Invalidate both the previous and the freshly-saved connections so
      // the next session turn reconnects from scratch. Re-reading the
      // config yields the merged `ConfiguredMCPServer[]` (builtins +
      // persisted) that the pool keys are derived from.
      const invalidateStep = child('invalidate-connections');
      const nextServers = loadConfiguredMcpServersForUser(user.sub);
      const invalidatedKeys = new Set<string>();
      for (const server of [...previousServers, ...nextServers]) {
        const poolKey = getMcpPoolKey(server);
        if (invalidatedKeys.has(poolKey)) continue;
        invalidatedKeys.add(poolKey);
        await invalidateMcpServerConnectionForUser(user.sub, server);
      }
      invalidateStep.succeed(undefined, { connections: invalidatedKeys.size });

      step.succeed(undefined, { servers: body.servers.length });

      return reply.send({ ok: true, servers: body.servers });
    },
  );
}
