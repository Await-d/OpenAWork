import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import websocket from '@fastify/websocket';
import { WorkflowLogger } from '@openAwork/logger';
import authPlugin from './infra/auth.js';
import { registerErrorHandler } from './infra/error-handler.js';
import { registerOpenApi } from './infra/openapi.js';
import { connectDb, closeDb, db, migrate, sqliteGet, sqliteRun } from './infra/db.js';
import { bootV2Runtime, getRuntimeFlags, shutdownV2Runtime } from './v2-runtime/index.js';
import { skillMcpPool } from './skill/skill-mcp-connection-pool.js';
import { ensureDefaultInstalledSkillsForAllUsers } from './skill/default-skills.js';
import { syncSystemSkillsForAllUsers } from './skill/system-skills.js';
import { ensureDefaultWorkflowTemplatesForAllUsers } from './runtime/default-workflow-templates.js';
import { backgroundScheduler } from './runtime/background-scheduler.js';
import { refreshRegistryCaches } from './routes/skills.js';
import { checkInstalledSkillUpdates } from './skill/skill-update-checker.js';
import { createHash, randomUUID } from 'crypto';
import requestWorkflowPlugin, { startRequestWorkflow } from './runtime/request-workflow.js';
import { startParentProcessWatch } from './infra/parent-watch.js';

const ADMIN_EMAIL = globalThis.process?.env['ADMIN_EMAIL'] ?? 'admin@openAwork.local';
const ADMIN_PASSWORD = globalThis.process?.env['ADMIN_PASSWORD'] ?? 'admin123456';

async function seedDefaultAdmin(): Promise<void> {
  const existing = sqliteGet('SELECT id FROM users WHERE email = ? LIMIT 1', [ADMIN_EMAIL]);
  if (existing) return;
  const id = randomUUID();
  const password_hash = createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    id,
    ADMIN_EMAIL,
    password_hash,
  ]);
}
import { startModelsDevRefresh } from '@openAwork/agent-core';
import { skillsRoutes } from './routes/skills.js';
import { skillSelectionRoutes } from './routes/skill-selection.js';
import { skillRecommendRoutes } from './routes/skill-recommend.js';
import { localSkillsRoutes } from './routes/local-skills.js';
import { systemSkillsRoutes } from './routes/system-skills.js';
import { capabilitiesRoutes } from './routes/capabilities.js';
import { sessionsRoutes } from './routes/sessions.js';
import { permissionsRoutes } from './routes/permissions.js';
import { questionsRoutes } from './routes/questions.js';
import { commandsRoutes } from './routes/commands.js';
import { streamRoutes } from './routes/stream-routes-plugin.js';
import { usageRoutes } from './routes/usage.js';
import { agentsRoutes } from './routes/agents.js';
import { teamRoutes } from './routes/team.js';
import { teamPhaseARoutes } from './routes/team-phase-a.js';
import { teamEventsRoutes } from './routes/team-events.js';
import { teamHandoffsRoutes } from './routes/team-handoffs.js';
import { teamWorkflowsCrudRoutes } from './routes/team-workflows-crud.js';
import { settingsRoutes } from './routes/settings.js';
import { workflowRoutes } from './routes/workflows.js';
import webStaticPlugin from './app/web-static.js';
import { lspRoutes, lspManager } from './lsp/router.js';
import { autoStartConfiguredChannels, channelRoutes } from './channels/router.js';
import { channelManager } from './channels/manager.js';
import { cronRoutes, cronScheduler } from './cron/router.js';
import { githubRoutes, restoreGitHubTriggers } from './github/router.js';
import { workspaceRoutes } from './routes/workspace.js';
import { desktopAutomationRoutes } from './routes/desktop-automation.js';
import { sshRoutes } from './routes/ssh.js';
import { toolsRoutes } from './routes/tools.js';
import { artifactsRoutes } from './routes/artifacts.js';
import { reconcileAllSessionRuntimes } from './session/session-runtime-reconciler.js';
import { reconcileStaleRunningTerminalsAtBoot } from './session/session-terminal-registry.js';
import qrcodeTerminal from 'qrcode-terminal';
import { pairingManager, pairingRoutes } from './routes/pairing.js';
import { memoriesRoutes } from './routes/memories.js';
import { notificationsRoutes } from './routes/notifications.js';
import { sessionImagesRoutes } from './routes/session-images.js';
import { sessionTerminalsRoutes } from './routes/session-terminals.js';
import { mcpEventsRoutes } from './routes/mcp-events.js';
import { mcpOAuthRoutes } from './routes/mcp-oauth.js';
import { ensurePluginsLoaded } from './runtime/plugin-host.js';

// 方案 5：加载所有内置 provider 插件
import './provider/plugins/index.js';

const app = Fastify({ logger: true, disableRequestLogging: true });

const port = Number(globalThis.process?.env['GATEWAY_PORT'] ?? 3000);
const host = globalThis.process?.env['GATEWAY_HOST'] ?? '0.0.0.0';

await app.register(cors, { origin: true });
await app.register(compress, {
  threshold: 1024,
  encodings: ['gzip', 'deflate'],
});
await app.register(websocket);

// 方案 4：自动 OpenAPI 文档（/docs 路径）
await registerOpenApi(app);

// 方案 2：统一错误处理（在路由注册之前）
registerErrorHandler(app);

await app.register(requestWorkflowPlugin);
await app.register(authPlugin);
await app.register(sessionsRoutes);
await app.register(permissionsRoutes);
await app.register(questionsRoutes);
await app.register(commandsRoutes);
await app.register(streamRoutes);
await app.register(usageRoutes);
await app.register(agentsRoutes);
await app.register(teamRoutes);
await app.register(teamPhaseARoutes);
await app.register(teamEventsRoutes);
await app.register(teamHandoffsRoutes);
await app.register(teamWorkflowsCrudRoutes);
await app.register(settingsRoutes);
await app.register(workflowRoutes);
await app.register(webStaticPlugin);
await app.register(lspRoutes);
await app.register(channelRoutes);
await app.register(cronRoutes);
await app.register(githubRoutes);
await app.register(workspaceRoutes);
await app.register(desktopAutomationRoutes);
await app.register(sshRoutes);
await app.register(toolsRoutes);
await app.register(artifactsRoutes);
await app.register(localSkillsRoutes);
await app.register(systemSkillsRoutes);
await app.register(skillsRoutes);
await app.register(skillSelectionRoutes);
await app.register(skillRecommendRoutes);
await app.register(capabilitiesRoutes);
await app.register(pairingRoutes);
await app.register(memoriesRoutes);
await app.register(notificationsRoutes);
await app.register(sessionImagesRoutes);
await app.register(sessionTerminalsRoutes);
await app.register(mcpEventsRoutes);
await app.register(mcpOAuthRoutes);

app.get('/health', {
  schema: {
    description: 'Health check endpoint',
    tags: ['system'],
    response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
  },
}, (request, reply) => {
  const { step } = startRequestWorkflow(request, 'gateway.health');
  step.succeed(undefined, { status: 'ok' });
  return reply.send({ status: 'ok' });
});

// OpenAPI spec as JSON (for SDK generators / CI)
app.get('/docs/openapi.json', {
  schema: { hide: true },
}, (request, reply) => {
  return reply.send(app.swagger());
});

app.addHook('onClose', async () => {
  // Cron timers + messaging-channel websockets first — both wrap
  // setInterval / external connections that would otherwise leak
  // across hot-restart cycles. Each branch is isolated so a single
  // failure can't block the rest of shutdown.
  try {
    cronScheduler.stopAll();
  } catch (err) {
    app.log.error({ err }, 'cronScheduler.stopAll failed');
  }
  try {
    await backgroundScheduler.stopAll();
  } catch (err) {
    app.log.error({ err }, 'backgroundScheduler.stopAll failed');
  }
  try {
    await channelManager.stopAll();
  } catch (err) {
    app.log.error({ err }, 'channelManager.stopAll failed');
  }
  await lspManager.shutdown();
  try {
    await skillMcpPool.disconnectAll();
  } catch (err) {
    app.log.error({ err }, 'skillMcpPool.disconnectAll failed');
  }
  // Invalidate the cached v2-runtime drizzle handle BEFORE closing the
  // legacy connection — once `closeDb()` runs the handle would be a
  // dangling reference to a closed `node:sqlite` connection.
  shutdownV2Runtime();
  await closeDb();
});

const bootLogger = new WorkflowLogger();
const bootContext = {
  requestId: 'gateway-boot',
  method: 'BOOT',
  path: '/gateway/startup',
  startTime: Date.now(),
};

try {
  let step = bootLogger.start('gateway.connect-db');
  await connectDb();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.migrate');
  await migrate();
  bootLogger.succeed(step);

  // v2-runtime boot — only initialises the drizzle handle + Effect
  // service layer when `OPENAWORK_RUNTIME[_STORAGE]=v2` is set. When
  // the flags are off this is a no-op, so the legacy stack keeps
  // running unchanged.
  step = bootLogger.start('gateway.boot-v2-runtime');
  const runtimeFlags = getRuntimeFlags();
  const v2Booted = bootV2Runtime({ connection: db });
  bootLogger.succeed(step, undefined, {
    runtime: runtimeFlags.global,
    storage: runtimeFlags.storage,
    upstream: runtimeFlags.upstream,
    services: runtimeFlags.services,
    booted: v2Booted !== null,
  });

  step = bootLogger.start('gateway.seed-default-admin', undefined, { email: ADMIN_EMAIL });
  await seedDefaultAdmin();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.seed-default-skills');
  ensureDefaultInstalledSkillsForAllUsers();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.sync-system-skills');
  try {
    const summary = await syncSystemSkillsForAllUsers();
    bootLogger.succeed(step, undefined, {
      users: summary.users,
      added: summary.added,
      updated: summary.updated,
      removed: summary.removed,
      total: summary.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootLogger.fail(step, message);
  }

  step = bootLogger.start('gateway.register-skill-background-tasks');
  try {
    const minutes = (n: number) => n * 60 * 1000;
    const hours = (n: number) => n * 60 * 60 * 1000;

    /**
     * Resolve a millisecond-valued env var with a safe default.
     * Guards against `""` → 0 and `"not-a-number"` → NaN which
     * would both send setTimeout into tight-loop territory.
     */
    const envMs = (name: string, fallback: number): number => {
      const raw = globalThis.process?.env[name];
      if (raw === undefined || raw === null || raw.trim() === '') return fallback;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
      return parsed;
    };

    const systemSkillIntervalMs = envMs('SKILL_SYSTEM_SYNC_INTERVAL_MS', minutes(10));
    const cacheRefreshIntervalMs = envMs('SKILL_REGISTRY_CACHE_REFRESH_INTERVAL_MS', hours(2));
    const versionCheckIntervalMs = envMs('SKILL_VERSION_CHECK_INTERVAL_MS', hours(12));

    backgroundScheduler.register({
      name: 'system-skills.periodic-sync',
      intervalMs: systemSkillIntervalMs,
      initialDelayMs: minutes(1),
      run: async () => {
        await syncSystemSkillsForAllUsers();
      },
    });

    backgroundScheduler.register({
      name: 'registry-cache.refresh',
      intervalMs: cacheRefreshIntervalMs,
      initialDelayMs: minutes(5),
      run: refreshRegistryCaches,
    });

    backgroundScheduler.register({
      name: 'installed-skills.version-check',
      intervalMs: versionCheckIntervalMs,
      initialDelayMs: minutes(30),
      run: async () => {
        await checkInstalledSkillUpdates();
      },
    });

    bootLogger.succeed(step, undefined, {
      tasks: backgroundScheduler.listTaskNames().join(','),
      systemSkillIntervalMs,
      cacheRefreshIntervalMs,
      versionCheckIntervalMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootLogger.fail(step, message);
  }

  step = bootLogger.start('gateway.seed-default-workflow-templates');
  ensureDefaultWorkflowTemplatesForAllUsers();
  bootLogger.succeed(step);

  // PR-D-Plugin: load operator-configured plugins listed in
  // OPENAWORK_PLUGINS. Idempotent + failure-tolerant — a broken
  // plugin path logs a warning but doesn't abort boot. Without this
  // call the dispatch* functions silently run an empty plugin list,
  // so failure to load is itself a (correct) bootable state.
  step = bootLogger.start('gateway.load-plugins');
  await ensurePluginsLoaded();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.reconcile-session-runtimes');
  const reconciliationResult = await reconcileAllSessionRuntimes();
  if (reconciliationResult.failedSessionIds.length > 0) {
    app.log.warn(
      {
        failedSessionIds: reconciliationResult.failedSessionIds,
      },
      'failed to reconcile some stale session runtimes during startup',
    );
  }
  bootLogger.succeed(step, undefined, {
    candidateCount: reconciliationResult.candidateCount,
    failedCount: reconciliationResult.failedSessionIds.length,
    pausedCount: reconciliationResult.pausedCount,
    resetCount: reconciliationResult.resetCount,
  });

  // Any session_terminals row still marked `running` after a gateway
  // restart points at a process that died with the previous instance.
  // Flip those rows to `stale` so the UI doesn't show ghost terminals.
  step = bootLogger.start('gateway.reconcile-session-terminals');
  try {
    const staleCount = reconcileStaleRunningTerminalsAtBoot();
    bootLogger.succeed(step, undefined, { staleCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bootLogger.fail(step, message);
  }

  step = bootLogger.start('gateway.autostart-channels');
  await autoStartConfiguredChannels((channel, error) => {
    app.log.error(
      {
        err: error,
        channelId: channel.id,
        channelType: channel.type,
      },
      'failed to auto-start configured channel',
    );
  });
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.restore-github-triggers');
  restoreGitHubTriggers();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.models-dev-sync');
  startModelsDevRefresh();
  bootLogger.succeed(step);

  // 260515-team-phase-b · T-04 启动 Handoff Watcher（默认开启，环境变量 OPENAWORK_DISABLE_HANDOFF_WATCHER=1 可关）
  const handoffWatcherDisabled =
    globalThis.process?.env['OPENAWORK_DISABLE_HANDOFF_WATCHER'] === '1';
  if (!handoffWatcherDisabled) {
    step = bootLogger.start('gateway.start-handoff-watcher');
    try {
      const { startHandoffWatcher } = await import('./handoff/runner/watcher.js');
      const { createPhaseCAwareRunner } = await import('./handoff/runner/pm1-runner.js');
      // 加载内置指令注册表（每层专属 LLM-facing 函数工具）
      // 这一行触发 builtin-instructions-impl 顶层 registerInstruction(...) 调用
      await import('./handoff/capability/builtin-instructions-impl.js');
      const watcher = startHandoffWatcher({
        taskRunner: createPhaseCAwareRunner(),
      });
      void watcher; // silence unused
      bootLogger.succeed(step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bootLogger.fail(step, message);
    }
  }

  step = bootLogger.start('gateway.listen', undefined, { host, port });
  await app.listen({ port, host });
  bootLogger.succeed(step);

  // 启用桌面端父进程死亡监视（仅 OPENAWORK_PARENT_PID 设置时生效）。
  // 必须在 listen 之后启动；否则 Tauri 主进程在 sidecar 还没绑定端口时崩溃，
  // 端口仍可能被占用一段时间。listen 之后注册可保证绑定成功后才进入监视循环。
  startParentProcessWatch();
  bootLogger.flush(bootContext, 200);

  step = bootLogger.start('gateway.pairing-qr');
  const pairingSession = await pairingManager.generatePairingCode();
  qrcodeTerminal.generate(pairingSession.qrData, { small: true }, (qr: string) => {
    process.stdout.write(
      '\n┌─────────────────────────────────────────────┐\n' +
        '│  OpenAWork Gateway — 扫码连接               │\n' +
        '│  Scan to connect from mobile/desktop        │\n' +
        '└─────────────────────────────────────────────┘\n' +
        qr +
        '\n' +
        `  Gateway: ${pairingSession.hostUrl}\n` +
        `  或手动填写地址后用账号密码登录\n\n`,
    );
  });
  bootLogger.succeed(step);
} catch (err) {
  const failureStep = bootLogger.start('gateway.startup');
  const message = err instanceof Error ? err.message : String(err);
  bootLogger.fail(failureStep, message);
  bootLogger.flush(bootContext, 500);
  globalThis.process?.exit(1);
}
