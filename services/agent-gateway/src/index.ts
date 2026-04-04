import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { WorkflowLogger } from '@openAwork/logger';
import authPlugin from './auth.js';
import { connectDb, closeDb, migrate, sqliteGet, sqliteRun } from './db.js';
import { ensureDefaultInstalledSkillsForAllUsers } from './default-skills.js';
import { createHash, randomUUID } from 'crypto';
import requestWorkflowPlugin, { startRequestWorkflow } from './request-workflow.js';

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
import { localSkillsRoutes } from './routes/local-skills.js';
import { capabilitiesRoutes } from './routes/capabilities.js';
import { sessionsRoutes } from './routes/sessions.js';
import { permissionsRoutes } from './routes/permissions.js';
import { questionsRoutes } from './routes/questions.js';
import { commandsRoutes } from './routes/commands.js';
import { streamRoutes } from './routes/stream-routes-plugin.js';
import { usageRoutes } from './routes/usage.js';
import { agentsRoutes } from './routes/agents.js';
import { teamRoutes } from './routes/team.js';
import { settingsRoutes } from './routes/settings.js';
import { workflowRoutes } from './routes/workflows.js';
import webStaticPlugin from './web-static.js';
import { lspRoutes } from './lsp/router.js';
import { autoStartConfiguredChannels, channelRoutes } from './channels/router.js';
import { cronRoutes } from './cron/router.js';
import { githubRoutes, restoreGitHubTriggers } from './github/router.js';
import { workspaceRoutes } from './routes/workspace.js';
import { desktopAutomationRoutes } from './routes/desktop-automation.js';
import { sshRoutes } from './routes/ssh.js';
import { toolsRoutes } from './routes/tools.js';
import { artifactsRoutes } from './routes/artifacts.js';
import { reconcileAllSessionRuntimes } from './session-runtime-reconciler.js';
import qrcodeTerminal from 'qrcode-terminal';
import { pairingManager, pairingRoutes } from './routes/pairing.js';
import { memoriesRoutes } from './routes/memories.js';

const app = Fastify({ logger: true, disableRequestLogging: true });

const port = Number(globalThis.process?.env['GATEWAY_PORT'] ?? 3000);
const host = globalThis.process?.env['GATEWAY_HOST'] ?? '0.0.0.0';

await app.register(cors, { origin: true });
await app.register(websocket);
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
await app.register(skillsRoutes);
await app.register(capabilitiesRoutes);
await app.register(pairingRoutes);
await app.register(memoriesRoutes);

app.get('/health', (request, reply) => {
  const { step } = startRequestWorkflow(request, 'gateway.health');
  step.succeed(undefined, { status: 'ok' });
  return reply.send({ status: 'ok' });
});

app.addHook('onClose', async () => {
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

  step = bootLogger.start('gateway.seed-default-admin', undefined, { email: ADMIN_EMAIL });
  await seedDefaultAdmin();
  bootLogger.succeed(step);

  step = bootLogger.start('gateway.seed-default-skills');
  ensureDefaultInstalledSkillsForAllUsers();
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

  step = bootLogger.start('gateway.listen', undefined, { host, port });
  await app.listen({ port, host });
  bootLogger.succeed(step);
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
