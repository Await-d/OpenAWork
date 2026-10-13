import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { resolveAuxiliaryLlmConfig } from '../provider/auxiliary-llm-config.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { z } from 'zod';
import { getTelemetryConsent, setTelemetryConsent } from '../telemetry/telemetry-consent-store.js';
import { trackEvent } from '../telemetry/telemetry-service.js';
import type { TelemetryEventName } from '@openAwork/telemetry';
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
  loadUserDisplayPreferences,
  saveUserDisplayPreferences,
  userDisplayPreferencesUpdateSchema,
} from '../user/user-display-preferences.js';

export async function registerSettingsUserRoutes(app: FastifyInstance): Promise<void> {
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

  // ── Display preferences（显示偏好，跨设备恢复）─────────────────

  app.get(
    '/settings/display-preferences',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.display-preferences.get');
      const user = request.user as JwtPayload;

      const stored = loadUserDisplayPreferences(user.sub);
      step.succeed(undefined, { hasPreferences: stored !== null });

      return reply.send({
        preferences: stored?.preferences ?? null,
        updatedAt: stored?.updatedAt ?? null,
      });
    },
  );

  app.put(
    '/settings/display-preferences',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'settings.display-preferences.put');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(userDisplayPreferencesUpdateSchema, request.body);
      parseStep.succeed(undefined, { fieldCount: Object.keys(body).length });

      const saveStep = child('save');
      const saved = saveUserDisplayPreferences(user.sub, body);
      saveStep.succeed(undefined, { fieldCount: Object.keys(saved.preferences).length });
      step.succeed(undefined, { fieldCount: Object.keys(saved.preferences).length });

      return reply.send({
        preferences: saved.preferences,
        updatedAt: saved.updatedAt,
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
          ...(llmConfig.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
  // ── Custom Base URL ──────────────────────────────────────────

  const OPENAWORK_BASE_URL_KEY = 'openawork_base_url';

  const baseUrlSettingsSchema = z.object({
    baseUrl: z
      .string()
      .url()
      .transform((url) => url.replace(/\/+$/, '')),
  });

  app.get(
    '/settings/base-url',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.base-url.get');
      const user = request.user as JwtPayload;
      const row = sqliteGet<{ value: string }>(
        'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
        [user.sub, OPENAWORK_BASE_URL_KEY],
      );
      const baseUrl = row?.value ?? '';
      step.succeed(undefined, { baseUrl });
      return reply.send({ baseUrl });
    },
  );

  app.put(
    '/settings/base-url',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'settings.base-url.put');
      const user = request.user as JwtPayload;
      const parsed = parseBody(baseUrlSettingsSchema, request.body);
      sqliteRun('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)', [
        user.sub,
        OPENAWORK_BASE_URL_KEY,
        parsed.baseUrl,
      ]);
      step.succeed(undefined, { baseUrl: parsed.baseUrl });
      return reply.send({ ok: true });
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
