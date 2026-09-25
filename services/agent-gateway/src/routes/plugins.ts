/**
 * Plugin management routes — status + lifecycle + market for the v2
 * plugin platform.
 *
 *   GET    /plugins                     status projection
 *   POST   /plugins/install             install from a local path (directory / single file)
 *   DELETE /plugins/:installId          uninstall (guarded plugins refuse)
 *   POST   /plugins/:installId/reload   deactivate + re-activate from disk
 *   POST   /plugins/:pluginId/disable   disable (guarded plugins refuse)
 *   POST   /plugins/:pluginId/enable    enable / retry activation
 *   GET    /plugins/market              aggregated market listing
 *   GET    /plugins/market/entry        entry detail (README)
 *   GET/POST/DELETE /plugins/market/sources
 *   POST   /plugins/install/github      one-click GitHub install (zipball)
 *
 * Shared lifecycle/install logic lives in `plugin/lifecycle-ops.ts` and
 * `plugin/market-install.ts` so the `plugin_manage` AI tool and these
 * routes can never drift.
 *
 * Trust model: any authenticated user can install code that the gateway
 * will execute on its next scan. This matches the platform's existing
 * trust model (the gateway runs on the operator's machine and
 * authenticated users already have tool-execution surfaces), but plugin
 * install is a *persistent* code-execution capability — keep the
 * gateway bound to trusted networks.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../infra/error-response.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseParams, parseQuery } from '../infra/parse-request.js';
import { PluginFetchError } from '../plugin/github-fetch.js';
import { installPluginFromPath, PluginInstallError } from '../plugin/installer.js';
import {
  installIdForSource,
  reloadPluginByInstallId,
  setPluginEnabledById,
  uninstallPluginByInstallId,
  type PluginOpResult,
} from '../plugin/lifecycle-ops.js';
import { installPluginFromGitHub } from '../plugin/market-install.js';
import { getMarketEntryDetail, searchMarketPlugins } from '../plugin/marketplace.js';
import { getPluginRegistry } from '../plugin/registry.js';
import {
  addPluginSource,
  listPluginSources,
  PluginSourceError,
  removePluginSource,
} from '../plugin/sources-store.js';
import { isPluginGuarded } from '../plugin/supervisor.js';
import { getTrackedPlugins, refreshPluginsFromDisk } from '../runtime/plugin-host.js';

const installBodySchema = z.object({
  path: z.string().trim().min(1).max(1024),
  force: z.boolean().optional(),
});

const installIdParamsSchema = z.object({
  installId: z.string().trim().min(1).max(64),
});

const pluginIdParamsSchema = z.object({
  pluginId: z.string().trim().min(1).max(200),
});

const marketQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
});

const marketEntryQuerySchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
});

const sourceBodySchema = z.object({
  repo: z.string().trim().min(1).max(200),
  ref: z.string().trim().max(200).optional(),
  name: z.string().trim().max(100).optional(),
});

const sourceIdParamsSchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
});

const githubInstallBodySchema = z.object({
  repo: z.string().trim().min(1).max(200),
  path: z.string().trim().max(300).optional(),
  ref: z.string().trim().max(200).optional(),
  name: z.string().trim().max(64).optional(),
  force: z.boolean().optional(),
});

function installErrorToApiError(err: unknown): ApiError {
  if (err instanceof PluginInstallError) {
    return ApiError.badRequest(err.message);
  }
  return ApiError.internal(err instanceof Error ? err.message : String(err));
}

function opFailureToApiError(result: Extract<PluginOpResult, { ok: false }>): ApiError {
  switch (result.code) {
    case 'not-found':
      return ApiError.notFound(result.error);
    case 'guarded':
      return ApiError.conflict(result.error);
    case 'invalid':
      return ApiError.badRequest(result.error);
    case 'failed':
      return ApiError.internal(result.error);
  }
}

export async function pluginsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/plugins',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const registryEntries = getPluginRegistry().list();
      const knownIds = new Set(registryEntries.map((entry) => entry.id));
      // Disabled plugins never activate, so they are absent from the
      // registry — merge them in from the loader's tracked set.
      const disabledEntries = getTrackedPlugins()
        .filter((tracked) => tracked.disabled === true && !knownIds.has(tracked.pluginId))
        .map((tracked) => ({
          id: tracked.pluginId,
          source: tracked.spec,
          state: { status: 'disabled' as const },
        }));

      const plugins = [...registryEntries, ...disabledEntries].map((entry) => {
        const installId = installIdForSource(entry.source);
        return {
          id: entry.id,
          ...(entry.source === undefined ? {} : { source: entry.source }),
          ...(installId === undefined ? {} : { installId }),
          state: entry.state,
          guarded: isPluginGuarded(entry.id),
        };
      });
      return reply.send({ plugins });
    },
  );

  app.post(
    '/plugins/install',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(installBodySchema, request.body);

      let installed;
      try {
        installed = await installPluginFromPath(body.path, {
          ...(body.force === undefined ? {} : { force: body.force }),
        });
      } catch (err) {
        throw installErrorToApiError(err);
      }

      const outcome = await refreshPluginsFromDisk();
      const tracked = outcome.tracked.find(
        (plugin) => installIdForSource(plugin.spec) === installed.installId,
      );
      return reply.send({
        install: {
          installId: installed.installId,
          path: installed.path,
          entrypoint: installed.entrypoint,
        },
        plugin:
          tracked === undefined
            ? null
            : {
                id: tracked.pluginId,
                state: tracked.active
                  ? { status: 'active' }
                  : { status: 'failed', error: tracked.error },
              },
      });
    },
  );

  app.delete(
    '/plugins/:installId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { installId } = parseParams(installIdParamsSchema, request.params);
      const result = await uninstallPluginByInstallId(installId);
      if (!result.ok) throw opFailureToApiError(result);
      return reply.send({ removed: true });
    },
  );

  app.post(
    '/plugins/:installId/reload',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { installId } = parseParams(installIdParamsSchema, request.params);
      const result = await reloadPluginByInstallId(installId);
      if (!result.ok) throw opFailureToApiError(result);
      return reply.send({
        reloaded: result.active === true,
        ...(result.error === undefined ? {} : { error: result.error }),
      });
    },
  );

  app.post(
    '/plugins/:pluginId/disable',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pluginId } = parseParams(pluginIdParamsSchema, request.params);
      const result = await setPluginEnabledById(pluginId, false);
      if (!result.ok) throw opFailureToApiError(result);
      return reply.send({ disabled: true });
    },
  );

  app.post(
    '/plugins/:pluginId/enable',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pluginId } = parseParams(pluginIdParamsSchema, request.params);
      const result = await setPluginEnabledById(pluginId, true);
      if (!result.ok) throw opFailureToApiError(result);
      return reply.send({
        enabled: result.active === true,
        ...(result.error === undefined ? {} : { error: result.error }),
      });
    },
  );

  // ── Plugin market（GitHub 源 + 一键安装）─────────────────────────────

  app.get(
    '/plugins/market/sources',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ sources: listPluginSources() });
    },
  );

  app.post(
    '/plugins/market/sources',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(sourceBodySchema, request.body);
      try {
        const source = addPluginSource({
          repo: body.repo,
          ...(body.ref === undefined ? {} : { ref: body.ref }),
          ...(body.name === undefined ? {} : { name: body.name }),
        });
        return reply.send({ source });
      } catch (err) {
        if (err instanceof PluginSourceError) throw ApiError.badRequest(err.message);
        throw err;
      }
    },
  );

  app.delete(
    '/plugins/market/sources/:sourceId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sourceId } = parseParams(sourceIdParamsSchema, request.params);
      if (!removePluginSource(sourceId)) {
        throw ApiError.notFound(`插件源 "${sourceId}" 不存在。`);
      }
      return reply.send({ removed: true });
    },
  );

  app.get(
    '/plugins/market',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = parseQuery(marketQuerySchema, request.query);
      const listing = await searchMarketPlugins(query.query);
      return reply.send(listing);
    },
  );

  app.get(
    '/plugins/market/entry',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = parseQuery(marketEntryQuerySchema, request.query);
      const detail = await getMarketEntryDetail(query.sourceId, query.name);
      if (!detail) {
        throw ApiError.notFound(`市场条目 "${query.name}" 不存在。`);
      }
      return reply.send(detail);
    },
  );

  app.post(
    '/plugins/install/github',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(githubInstallBodySchema, request.body);
      try {
        const result = await installPluginFromGitHub({
          repo: body.repo,
          ...(body.path === undefined ? {} : { path: body.path }),
          ...(body.ref === undefined ? {} : { ref: body.ref }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.force === undefined ? {} : { force: body.force }),
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof PluginFetchError) throw ApiError.badRequest(err.message);
        if (err instanceof PluginSourceError) throw ApiError.badRequest(err.message);
        if (err instanceof PluginInstallError) throw installErrorToApiError(err);
        throw err;
      }
    },
  );
}
