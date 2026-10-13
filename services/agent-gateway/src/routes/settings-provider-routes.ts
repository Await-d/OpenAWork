import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import {
  getModelsDevData,
  getProviderCatalogUi,
  refreshModelsDevDataOrThrow,
} from '@openAwork/agent-core';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import {
  buildCustomProviderFromModelsDev,
  listDiscoverableProviders,
} from '../provider/models-dev-discover.js';
import { invalidateCatalog, invalidateAllCatalogs } from '../provider/provider-catalog.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import {
  filterEnabledProviderConfig,
  materializeProviderConfig,
  materializeProviderConfigForStorage,
  normalizeSingleProviderForTest,
  parseStoredDefaultThinking,
  parseStoredImageGenerationDefaults,
  parseStoredSubagentModelPolicy,
  providerConnectivityTestBodySchema,
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
  providerUpstreamModelsBodySchema,
} from '../provider/provider-config.js';
import { resolveSubagentLimitsForUser } from '../task/subagent-limits.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import type { AIProvider } from '@openAwork/agent-core';
import { z } from 'zod';

import {
  countProviderModels,
  mergeActiveSelectionPreservingStored,
  mergeImageGenerationDefaultsPreservingStored,
  parseStoredJson,
  providerIdsKey,
  type UserSettingRow,
} from './settings-support.js';

export async function registerSettingsProviderRoutes(app: FastifyInstance): Promise<void> {
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
      const subagentPolicyRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'subagent_model_policy'`,
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
      const subagentModelPolicy = parseStoredSubagentModelPolicy(
        parseStoredJson(subagentPolicyRow?.value),
      );
      const subagentLimits = resolveSubagentLimitsForUser(user.sub);
      materializeStep.succeed(undefined, { providers: providers.length });
      step.succeed(undefined, { providers: providers.length });

      return reply.send({
        providers,
        activeSelection,
        defaultThinking,
        imageGenerationDefaults,
        subagentModelPolicy,
        subagentLimits,
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
      const subagentPolicyRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'subagent_model_policy'`,
        [user.sub],
      );
      loadSelectionStep.succeed(undefined, { found: selectionRow !== undefined });

      const parseStep = child('parse-body');
      const parsed = parseBody(providerSettingsBodySchema, request.body);
      parseStep.succeed();

      const storedSubagentPolicy = parseStoredSubagentModelPolicy(
        parseStoredJson(subagentPolicyRow?.value),
      );
      const subagentModelPolicy = parsed.subagentModelPolicy ?? storedSubagentPolicy;
      // 子代理数量限制：字段缺省表示「未变更」，保持已落库值（与 subagentModelPolicy 同语义）。
      const subagentLimits = parsed.subagentLimits ?? resolveSubagentLimitsForUser(user.sub);

      const materializeStep = child('materialize');
      const mergedActiveSelection = mergeActiveSelectionPreservingStored({
        incoming: parsed.activeSelection,
        stored: parseStoredJson(selectionRow?.value),
      });
      const storageConfig = await materializeProviderConfigForStorage(
        parsed.providers,
        mergedActiveSelection,
      );
      const { providers, activeSelection } = await materializeProviderConfig(
        storageConfig.providers,
        storageConfig.activeSelection,
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
        [user.sub, JSON.stringify(storageConfig.providers)],
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

      const saveSubagentPolicyStep = child('save-subagent-model-policy');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'subagent_model_policy', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(subagentModelPolicy)],
      );
      saveSubagentPolicyStep.succeed();

      const saveSubagentLimitsStep = child('save-subagent-limits');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'subagent_limits', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(subagentLimits)],
      );
      saveSubagentLimitsStep.succeed();

      // 方案 3：配置变更后 invalidate catalog 缓存
      invalidateCatalog(user.sub);

      step.succeed(undefined, { providers: providers.length });

      return reply.send({
        providers,
        activeSelection,
        defaultThinking,
        imageGenerationDefaults,
        subagentModelPolicy,
        subagentLimits,
      });
    },
  );

  app.put(
    '/settings/providers/fast-mode',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.providers.fast-mode.put');
      const user = request.user as JwtPayload;
      const body = parseBody(
        z.object({
          providerId: z.string().min(1),
          enabled: z.boolean(),
        }),
        request.body,
      );
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      let stored = parseStoredJson(row?.value);
      if (!Array.isArray(stored)) {
        // 新用户首次进入聊天时，GET /settings/providers 会从内置 catalog
        // 物化默认 Provider，但不会为了只读请求写回数据库。Fast 开关仍需
        // 以同一份默认 catalog 为基线保存，避免强制用户先去设置页点一次保存。
        stored = (await materializeProviderConfigForStorage(stored, null)).providers;
      }
      if (!Array.isArray(stored)) {
        step.fail('providers not configured');
        return reply.status(404).send({ error: 'Provider 配置不存在。' });
      }

      let providerFound = false;
      let openaiProvider = false;
      const providers = stored.map((provider) => {
        if (!provider || typeof provider !== 'object') return provider;
        const record = provider as Record<string, unknown>;
        if (record['id'] !== body.providerId) return provider;
        providerFound = true;
        openaiProvider = record['type'] === 'openai';
        if (!openaiProvider) return provider;
        if (body.enabled) return { ...record, openaiFastMode: true };
        const next = { ...record };
        delete next['openaiFastMode'];
        return next;
      });

      if (!providerFound) {
        step.fail('provider not found');
        return reply.status(404).send({ error: '指定 Provider 不存在。' });
      }
      if (!openaiProvider) {
        step.fail('provider does not support fast mode');
        return reply.status(400).send({ error: '仅 OpenAI Provider 支持 Fast 模式。' });
      }

      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(providers)],
      );
      invalidateCatalog(user.sub);
      step.succeed(undefined, { providerId: body.providerId, enabled: body.enabled });
      return reply.send({ ok: true, providerId: body.providerId, openaiFastMode: body.enabled });
    },
  );

  app.put(
    '/settings/providers/model-context',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.providers.model-context.put');
      const user = request.user as JwtPayload;
      const body = parseBody(
        z.object({
          providerId: z.string().min(1),
          modelId: z.string().min(1),
          contextWindowOverride: z.union([z.number().int().positive().max(10_000_000), z.null()]),
        }),
        request.body,
      );
      const row = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const stored = parseStoredJson(row?.value);
      if (!Array.isArray(stored)) {
        step.fail('providers not configured');
        return reply.status(404).send({ error: 'Provider 配置不存在。' });
      }
      const providers = stored.map((provider) => {
        if (!provider || typeof provider !== 'object') return provider;
        const record = provider as Record<string, unknown>;
        if (record['id'] !== body.providerId) return provider;
        const models = Array.isArray(record['defaultModels']) ? record['defaultModels'] : [];
        const nextModels = models.map((model) => {
          if (!model || typeof model !== 'object') return model;
          const modelRecord = model as Record<string, unknown>;
          if (modelRecord['id'] !== body.modelId) return model;
          const next = { ...modelRecord };
          if (body.contextWindowOverride === null) delete next['contextWindowOverride'];
          else next['contextWindowOverride'] = body.contextWindowOverride;
          return next;
        });
        return { ...record, defaultModels: nextModels };
      });
      const provider = providers.find(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as Record<string, unknown>)['id'] === body.providerId,
      );
      const modelFound =
        provider &&
        typeof provider === 'object' &&
        Array.isArray((provider as Record<string, unknown>)['defaultModels']) &&
        ((provider as Record<string, unknown>)['defaultModels'] as unknown[]).some(
          (model) =>
            model &&
            typeof model === 'object' &&
            (model as Record<string, unknown>)['id'] === body.modelId,
        );
      if (!modelFound) {
        step.fail('model not found');
        return reply.status(404).send({ error: '指定模型不存在。' });
      }
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(providers)],
      );
      // 挡位变更必须立刻反映到运行时：catalog 缓存（30s TTL）里仍是旧模型配置，
      // 不失效的话本次调整在缓存过期前不参与路由/压缩决策。
      invalidateCatalog(user.sub);
      step.succeed(undefined, { providerId: body.providerId, modelId: body.modelId });
      return reply.send({
        ok: true,
        providerId: body.providerId,
        modelId: body.modelId,
        contextWindowOverride: body.contextWindowOverride,
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

      // 历史落库会把同步来的模型写进用户配置；这里借已刷新的 catalog 把当前用户的
      // 存量清单收口为「仅覆盖项」，读取路径仍按最新 catalog 派生完整清单。
      const compactStep = child('compact-stored-providers');
      const user = request.user as JwtPayload;
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const storedProviders = parseStoredJson(providerRow?.value);
      let removedModels = 0;
      if (Array.isArray(storedProviders)) {
        const storageConfig = await materializeProviderConfigForStorage(
          storedProviders,
          parseStoredJson(selectionRow?.value),
        );
        const providerIdentitiesPreserved =
          providerIdsKey(storedProviders) === providerIdsKey(storageConfig.providers);
        const removed =
          countProviderModels(storedProviders) - countProviderModels(storageConfig.providers);
        if (providerIdentitiesPreserved && removed > 0) {
          removedModels = removed;
          sqliteRun(
            `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
             ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
            [user.sub, JSON.stringify(storageConfig.providers)],
          );
          invalidateCatalog(user.sub);
        }
      }
      compactStep.succeed(undefined, { removedModels });

      step.succeed(undefined, { providers: providerCount, models: modelCount });
      return reply.send({ ok: true, providerCount, modelCount, removedModels });
    },
  );

  // 拉取上游模型列表:对一个已配置(或内联)的 provider 发起 `GET {baseUrl}/models`,
  // 把上游真实暴露的模型 id 返回给设置页,供用户一键同步进当前接口的模型列表。
  // 只读——真正的「同步进 provider」由前端把选中的模型合并后走 PUT /settings/providers。
  app.post(
    '/settings/providers/upstream-models',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.upstream-models');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const parsed = parseBody(providerUpstreamModelsBodySchema, request.body);
      parseStep.succeed();

      // 解析目标 provider:优先用请求体里内联的 provider(拉「尚未保存」的表单值对应上游),
      // 否则按 providerId 从已保存配置里取。同时拿到当前用户的存量 provider 清单,
      // 后面用于把上游裸 id 补全为上下文 / 能力齐全的模型配置。
      const resolveStep = child('resolve-provider');
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const { providers: userProviders } = await materializeProviderConfig(
        parseStoredJson(providerRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      let provider: AIProvider | undefined;
      if (parsed.provider) {
        provider = normalizeSingleProviderForTest(parsed.provider);
      } else if (parsed.providerId) {
        provider = userProviders.find((item) => item.id === parsed.providerId);
      }

      if (!provider) {
        resolveStep.fail('provider not found');
        step.fail('provider not found');
        return reply.status(404).send({
          ok: false,
          status: 'error',
          message: '未找到目标 provider,请先保存配置或提供完整的 provider 信息。',
          models: [],
        });
      }
      resolveStep.succeed(undefined, { providerId: provider.id });

      const fetchStep = child('fetch-upstream-models');
      const { fetchUpstreamModels, buildLocalModelMetadataIndex, enrichUpstreamModels } =
        await import('../provider/upstream-models.js');
      const result = await fetchUpstreamModels({ provider });
      if (result.ok) {
        fetchStep.succeed(undefined, { models: result.models.length });
        step.succeed(undefined, { status: result.status });
      } else {
        fetchStep.fail(result.status);
        step.fail(result.status);
      }

      // 上游 `/models` 通常只回 id,不含上下文与能力。用本地「用户已配置 > 内置目录」
      // 的同名模型元数据补齐,避免同步进来的模型没有上下文大小 / 能力标记。
      const enrichStep = child('enrich-local-metadata');
      if (result.ok && result.models.length > 0) {
        const catalog = (await materializeProviderConfig(undefined, undefined)).providers;
        const index = buildLocalModelMetadataIndex([userProviders, catalog]);
        result.models = enrichUpstreamModels(result.models, index);
        enrichStep.succeed(undefined, {
          matched: result.models.filter((item) => item.meta).length,
        });
      } else {
        enrichStep.succeed();
      }

      // 与自检一致:业务层失败仍以 200 返回结构化结果,由前端面板按 `status` 渲染。
      return reply.send({ ...result, providerId: provider.id });
    },
  );

  app.get(
    '/settings/providers/discover',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.providers.discover');
      const loadStep = child('load-models-dev');
      let data: Awaited<ReturnType<typeof getModelsDevData>>;
      try {
        data = await getModelsDevData();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        loadStep.fail(message);
        step.fail('models.dev unavailable');
        return reply.status(502).send({ providers: [], message: '无法加载 models.dev' });
      }
      loadStep.succeed();
      const providers = listDiscoverableProviders(data);
      step.succeed(undefined, { providers: providers.length });
      return reply.send({ providers });
    },
  );

  app.post(
    '/settings/providers/import-from-models-dev',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { step, child } = startRequestWorkflow(request, 'settings.providers.import-models-dev');

      const parseStep = child('parse-body');
      const importBodySchema = z.object({
        modelsDevProviderId: z.string().trim().min(1),
        name: z.string().trim().min(1).optional(),
        enabled: z.boolean().optional(),
      });
      // parseBody 失败会抛 ApiError.badRequest，由全局错误处理返回 400。
      const body = parseBody(importBodySchema, request.body);
      parseStep.succeed();

      const loadStep = child('load-models-dev');
      let data: Awaited<ReturnType<typeof getModelsDevData>>;
      try {
        data = await getModelsDevData();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        loadStep.fail(message);
        step.fail('models.dev unavailable');
        return reply.status(502).send({ message: `无法加载 models.dev：${message}` });
      }
      loadStep.succeed();

      const buildStep = child('build-custom-provider');
      let imported: AIProvider;
      try {
        imported = buildCustomProviderFromModelsDev(data, body.modelsDevProviderId, {
          name: body.name,
          enabled: body.enabled,
        });
      } catch (err) {
        buildStep.fail(err instanceof Error ? err.message : String(err));
        step.fail('not found');
        return reply.status(404).send({
          message: err instanceof Error ? err.message : String(err),
        });
      }
      buildStep.succeed(undefined, { providerId: imported.id });

      const loadExistingStep = child('load-existing-providers');
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      loadExistingStep.succeed();

      const existingRaw = parseStoredJson(providerRow?.value);
      const existingList = Array.isArray(existingRaw) ? existingRaw : [];
      // 防重复导入：同 baseUrl 的 custom 实例或同 models.dev id 前缀已存在则拒绝。
      const safeModelsDevId = body.modelsDevProviderId
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .toLowerCase();
      const idPrefix = `custom-md-${safeModelsDevId}-`;
      const duplicate = existingList.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const provider = item as { id?: unknown; baseUrl?: unknown; type?: unknown };
        if (provider.type !== 'custom') return false;
        if (typeof provider.id === 'string' && provider.id.toLowerCase().startsWith(idPrefix)) {
          return true;
        }
        if (
          imported.baseUrl &&
          typeof provider.baseUrl === 'string' &&
          provider.baseUrl === imported.baseUrl
        ) {
          return true;
        }
        return false;
      });
      if (duplicate) {
        step.fail('duplicate');
        return reply.status(409).send({
          message: '该平台已导入，请勿重复添加。可在提供商列表中编辑已有实例。',
        });
      }

      const mergedRaw = [...existingList, imported];

      const materializeStep = child('materialize');
      const storageConfig = await materializeProviderConfigForStorage(
        mergedRaw,
        parseStoredJson(selectionRow?.value),
      );
      const { providers, activeSelection } = await materializeProviderConfig(
        storageConfig.providers,
        storageConfig.activeSelection,
      );
      materializeStep.succeed(undefined, { providers: providers.length });

      const saveProvidersStep = child('save-providers');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(storageConfig.providers)],
      );
      saveProvidersStep.succeed();

      const saveSelectionStep = child('save-active-selection');
      sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [user.sub, JSON.stringify(activeSelection)],
      );
      saveSelectionStep.succeed();

      invalidateCatalog(user.sub);
      step.succeed(undefined, { providerId: imported.id });
      return reply.send({ provider: imported, providers, activeSelection });
    },
  );
  app.get(
    '/settings/model-prices',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.model-prices.get');
      const user = request.user as JwtPayload;
      const providerRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const materialized = await materializeProviderConfig(
        parseStoredJson(providerRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      const modelPrices = materialized.providers.flatMap((provider) =>
        provider.defaultModels
          .map((model) => ({
            model,
            // 用量页展示有效窗口：挡位是权威值，配置后覆盖模型预设。
            contextWindow: model.contextWindowOverride ?? model.contextWindow,
          }))
          .filter(
            ({ model, contextWindow }) =>
              model.inputPricePerMillion !== undefined ||
              model.outputPricePerMillion !== undefined ||
              model.cacheReadPricePerMillion !== undefined ||
              model.cacheWritePricePerMillion !== undefined ||
              contextWindow !== undefined,
          )
          .map(({ model, contextWindow }) => ({
            providerId: provider.id,
            modelName: model.id,
            inputPer1m: model.inputPricePerMillion ?? 0,
            outputPer1m: model.outputPricePerMillion ?? 0,
            ...(contextWindow !== undefined ? { contextWindow } : {}),
            ...(model.cacheReadPricePerMillion !== undefined
              ? { cacheReadPer1m: model.cacheReadPricePerMillion }
              : {}),
            ...(model.cacheWritePricePerMillion !== undefined
              ? { cacheWritePer1m: model.cacheWritePricePerMillion }
              : {}),
          })),
      );
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
      const mergedPrices = new Map(
        builtinPrices.map((model) => [`${model.modelName}`, model] as const),
      );
      for (const model of modelPrices) {
        mergedPrices.set(`${model.providerId ?? 'custom'}:${model.modelName}`, model);
      }
      const models = modelPrices.length > 0 ? [...mergedPrices.values()] : builtinPrices;
      step.succeed(undefined, { models: models.length });
      return reply.send({ models });
    },
  );
}
