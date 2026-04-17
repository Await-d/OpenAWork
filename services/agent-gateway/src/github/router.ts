import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { extractMessageText } from '../session-message-store.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  listSessionMessagesV2 as listSessionMessages,
} from '../message-v2-adapter.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import { GitHubTriggerImpl } from './github-trigger.js';
import type { GitHubEventType, GitHubTriggerConfig } from './github-trigger.js';
import { GitHubActionOutput } from './github-action-output.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const GITHUB_TRIGGERS_SETTINGS_KEY = 'github_triggers';

interface UserSettingRow {
  user_id?: string;
  value: string;
}

const trigger = new GitHubTriggerImpl();

function buildGitHubSessionMetadata(ctx: { eventType: string; repoFullName: string }): string {
  return JSON.stringify({
    githubTrigger: {
      eventType: ctx.eventType,
      repoFullName: ctx.repoFullName,
    },
  });
}

function persistTriggers(userId: string): void {
  const allTriggers = trigger.listAllConfigs(userId);
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, GITHUB_TRIGGERS_SETTINGS_KEY, JSON.stringify(allTriggers)],
  );
}

function extractFinalAssistantText(sessionId: string, userId: string): string {
  const messages = listSessionMessages({ sessionId, userId });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'assistant') {
      const text = extractMessageText(msg);
      if (text.length > 0) {
        return text;
      }
    }
  }
  return '';
}

async function performWriteBack(input: {
  appId: string;
  privateKeyPem: string;
  eventType: GitHubEventType;
  repoFullName: string;
  payload: {
    pull_request?: { number: number; head: { sha: string } };
  };
  sessionId: string;
  userId: string;
}): Promise<void> {
  const [owner, repo] = input.repoFullName.split('/');
  if (!owner || !repo) {
    return;
  }

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: input.appId, privateKey: input.privateKeyPem },
  });

  const { data: installation } = await appOctokit.apps.getRepoInstallation({ owner, repo });
  const installationOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: input.appId,
      privateKey: input.privateKeyPem,
      installationId: installation.id,
    },
  });

  const output = new GitHubActionOutput(installationOctokit);
  const summaryText = extractFinalAssistantText(input.sessionId, input.userId);

  if (!summaryText) {
    return;
  }

  if (input.eventType.startsWith('pull_request.') && input.payload.pull_request) {
    await output.postComment(owner, repo, input.payload.pull_request.number, summaryText);
  } else if (input.eventType === 'push') {
    const headSha = input.payload.pull_request?.head.sha;
    if (headSha) {
      await output.setCommitStatus(
        owner,
        repo,
        headSha,
        'success',
        summaryText.slice(0, 140),
        'OpenAWork Agent',
      );
    }
  }
}

function startGitHubBackgroundExecution(input: {
  clientRequestId: string;
  prompt: string;
  autoApprove: boolean;
  sessionId: string;
  userId: string;
  appId: string;
  privateKeyPem: string;
  eventType: GitHubEventType;
  repoFullName: string;
  payload: {
    pull_request?: { number: number; head: { sha: string } };
  };
}): void {
  void runSessionInBackground({
    requestData: {
      clientRequestId: input.clientRequestId,
      displayMessage: input.prompt,
      message: input.prompt,
      yoloMode: input.autoApprove,
    },
    sessionId: input.sessionId,
    userId: input.userId,
  })
    .then(async () => {
      try {
        await performWriteBack({
          appId: input.appId,
          privateKeyPem: input.privateKeyPem,
          eventType: input.eventType,
          repoFullName: input.repoFullName,
          payload: input.payload,
          sessionId: input.sessionId,
          userId: input.userId,
        });
      } catch (writeBackError) {
        console.error('GitHub write-back failed (non-fatal)', {
          sessionId: input.sessionId,
          error: writeBackError instanceof Error ? writeBackError.message : String(writeBackError),
        });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      sqliteRun(
        "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [input.sessionId, input.userId],
      );

      try {
        appendSessionMessage({
          sessionId: input.sessionId,
          userId: input.userId,
          role: 'assistant',
          status: 'error',
          clientRequestId: input.clientRequestId,
          content: [{ type: 'text', text: `[错误: GITHUB_TRIGGER_START_FAILED] ${message}` }],
        });
      } catch (appendError) {
        console.error('Failed to persist GitHub trigger execution error', appendError);
      }

      console.error('GitHub trigger background execution failed', {
        sessionId: input.sessionId,
        userId: input.userId,
        message,
      });
    });
}

trigger.setRouteHandler(async (ctx) => {
  const owner = sqliteGet<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [
    ctx.ownerUserId,
  ]);
  if (!owner) {
    throw new Error('GitHub trigger owner not found');
  }

  const config = trigger.getConfig(ctx.repoFullName);

  const sessionId = randomUUID();
  const clientRequestId = randomUUID();
  sqliteRun(
    'INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [
      sessionId,
      ctx.ownerUserId,
      `GitHub: ${ctx.eventType} on ${ctx.repoFullName}`,
      '[]',
      'idle',
      buildGitHubSessionMetadata({ eventType: ctx.eventType, repoFullName: ctx.repoFullName }),
    ],
  );

  startGitHubBackgroundExecution({
    autoApprove: ctx.autoApprove,
    clientRequestId,
    prompt: ctx.prompt,
    sessionId,
    userId: ctx.ownerUserId,
    appId: config?.appId ?? '',
    privateKeyPem: config?.privateKeyPem ?? '',
    eventType: ctx.eventType,
    repoFullName: ctx.repoFullName,
    payload: {
      pull_request: ctx.payload.pull_request
        ? {
            number: ctx.payload.pull_request.number,
            head: { sha: ctx.payload.pull_request.head.sha },
          }
        : undefined,
    },
  });

  return { sessionId };
});

const triggerConfigSchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  webhookSecretForHmacVerification: z.string().min(1),
  repoFullNameOwnerSlashRepo: z.string().min(1),
  events: z
    .array(
      z.enum([
        'pull_request.opened',
        'pull_request.synchronize',
        'push',
        'issues.opened',
        'workflow_run.completed',
      ] satisfies [GitHubEventType, ...GitHubEventType[]]),
    )
    .min(1),
  branchFilterUndefinedMeansAll: z.array(z.string()).optional(),
  pathFilterUndefinedMeansAll: z.array(z.string()).optional(),
  agentPromptTemplate: z.string().min(1),
  autoApproveWithoutUserConfirmation: z.boolean().default(false),
});

function parseJsonBodyPreservingRawBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf-8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw Object.assign(error, { statusCode: 400 });
    }
    throw error;
  }
}

export function restoreGitHubTriggers(): void {
  const rows = sqliteAll<UserSettingRow>(`SELECT user_id, value FROM user_settings WHERE key = ?`, [
    GITHUB_TRIGGERS_SETTINGS_KEY,
  ]);

  for (const row of rows) {
    const userId = row.user_id;
    if (!userId) {
      continue;
    }

    let configs: unknown[];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) {
        continue;
      }
      configs = parsed;
    } catch {
      console.error('GitHub trigger restore: 无法解析存储的触发器配置', { userId });
      continue;
    }

    for (const rawConfig of configs) {
      try {
        const config = rawConfig as GitHubTriggerConfig;
        if (
          !config.repoFullNameOwnerSlashRepo ||
          !config.webhookSecretForHmacVerification ||
          !config.events
        ) {
          continue;
        }
        trigger.register({ ...config, ownerUserId: userId });
      } catch (error) {
        console.error('GitHub trigger restore: 单个触发器注册失败', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export async function githubRoutes(app: FastifyInstance): Promise<void> {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request: FastifyRequest, body: Buffer, done) => {
      request.rawBody = body;

      try {
        done(null, parseJsonBodyPreservingRawBody(body));
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)), undefined);
      }
    },
  );

  app.post('/github/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const { step } = startRequestWorkflow(request, 'github.webhook');
    const rawBody = request.rawBody;
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = value;
    }

    if (!rawBody) {
      step.fail('raw webhook body unavailable');
      return reply.status(500).send({ error: 'Raw webhook body unavailable' });
    }

    try {
      const result = await trigger.handleWebhook({ headers, rawBody });
      if (result.sessionId) {
        step.succeed(undefined, {
          handled: true,
          sessionId: result.sessionId,
          event: result.eventType ?? 'unknown',
        });
        return reply.status(202).send({ ok: true, handled: true, sessionId: result.sessionId });
      }

      step.succeed(undefined, {
        handled: result.handled,
        event: result.eventType ?? 'ignored',
      });
      return reply.status(200).send({ ok: true, handled: result.handled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message === 'Invalid webhook signature' || error instanceof SyntaxError ? 400 : 500;
      step.fail(message);
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.get(
    '/github/triggers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      return reply.send({ triggers: trigger.listTriggers(user.sub) });
    },
  );

  app.post(
    '/github/triggers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'github.trigger.register');
      const user = request.user as JwtPayload;
      const body = triggerConfigSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid trigger config');
        return reply.status(400).send({ error: body.error.issues });
      }

      trigger.register({
        ...body.data,
        ownerUserId: user.sub,
      } satisfies GitHubTriggerConfig);
      persistTriggers(user.sub);
      step.succeed(undefined, {
        repo: body.data.repoFullNameOwnerSlashRepo,
        events: body.data.events.length,
        ownerUserId: user.sub,
      });
      return reply.status(201).send({ ok: true, repo: body.data.repoFullNameOwnerSlashRepo });
    },
  );

  app.delete(
    '/github/triggers/:repo',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'github.trigger.delete');
      const user = request.user as JwtPayload;
      const repoParam = (request.params as Record<string, string>)['repo'];

      if (!repoParam) {
        step.fail('missing repo parameter');
        return reply.status(400).send({ error: '缺少仓库名称参数' });
      }

      const repoFullName = decodeURIComponent(repoParam);
      const removed = trigger.unregister(repoFullName);

      if (!removed) {
        step.fail('trigger not found');
        return reply.status(404).send({ error: '未找到该仓库的触发器配置' });
      }

      persistTriggers(user.sub);
      step.succeed(undefined, { repo: repoFullName, ownerUserId: user.sub });
      return reply.status(200).send({ ok: true, repo: repoFullName });
    },
  );
}
