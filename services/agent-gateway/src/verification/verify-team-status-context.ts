import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { ServerResponse } from 'node:http';
import authPlugin from '../infra/auth.js';
import { WORKSPACE_ROOT, closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { withTempEnv } from './task-verification-helpers.js';

const RESPONSES_PORT = 3312;
const PROVIDER_ID = 'openai';
const MODEL_ID = 'team-status-model';

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_BASE_URL: `http://127.0.0.1:${RESPONSES_PORT}`,
      AI_API_KEY: 'test-key',
    },
    async () => {
      const capturedBodies: Record<string, unknown>[] = [];
      const upstream = createServer((req, res) => {
        if (req.url !== '/responses') {
          res.statusCode = 404;
          res.end();
          return;
        }

        const chunks: string[] = [];
        req.on('data', (chunk) => chunks.push(chunk.toString()));
        req.on('end', () => {
          const body = JSON.parse(chunks.join('')) as Record<string, unknown>;
          capturedBodies.push(body);
          const joinedText = extractRequestTexts(body).join('\n');
          const hasTeamStatusSnapshot =
            joinedText.includes('[OPENAWORK TEAM STATUS SNAPSHOT]') &&
            joinedText.includes('完成率：67%') &&
            joinedText.includes('完成登录接口修复') &&
            joinedText.includes('补齐回归测试审查');
          const answer = hasTeamStatusSnapshot
            ? '目前共 3 个任务，已完成 2 个，完成率 67%。已完成：完成登录接口修复、补齐回归测试审查；未完成：收尾文档同步。'
            : '你提到来自 PM1 的任务清单，但没有提供具体内容。';
          writeTextCompletion(res, answer);
        });
      });

      await new Promise<void>((resolve) => upstream.listen(RESPONSES_PORT, '127.0.0.1', resolve));

      await connectDb();
      await migrate();

      const adminEmail = 'admin@openAwork.local';
      const admin = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        adminEmail,
      ]);
      const userId = admin?.id ?? 'u-team-status';
      if (!admin) {
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          adminEmail,
          createHash('sha256').update('admin123456').digest('hex'),
        ]);
      }

      configureProvider(userId);

      const app = Fastify();
      await app.register(cors, { origin: true });
      await app.register(websocket);
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
      await app.register(streamRoutes);
      await app.ready();

      try {
        const accessToken = app.jwt.sign({ sub: userId, email: adminEmail });
        const sessionId = await createSession(app, accessToken);
        await seedTeamRuntime(sessionId, userId);

        const response = await app.inject({
          method: 'GET',
          url:
            `/sessions/${sessionId}/stream/sse?message=${encodeURIComponent('前面完成了哪些任务？完成百分比多少？')}` +
            `&clientRequestId=${encodeURIComponent('req-team-status')}` +
            `&providerId=${encodeURIComponent(PROVIDER_ID)}` +
            `&model=${encodeURIComponent(MODEL_ID)}` +
            `&token=${encodeURIComponent(accessToken)}`,
        });

        if (response.statusCode !== 200) {
          throw new Error(`team status stream expected 200 but received ${response.statusCode}`);
        }

        const body = response.body;
        const events = parseSseChunks(body);
        if (!body.includes('完成率 67%') && !body.includes('完成率 67%。')) {
          throw new Error(`expected final SSE body to mention completion rate, got: ${body}`);
        }
        if (!body.includes('完成登录接口修复') || !body.includes('补齐回归测试审查')) {
          throw new Error(`expected final SSE body to mention completed tasks, got: ${body}`);
        }
        if (body.includes('来自 PM1 的任务清单') || body.includes('没有提供具体内容')) {
          throw new Error(`unexpected generic fallback response: ${body}`);
        }
        assertEvent(
          events,
          (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
          'team status scenario done',
        );
        assertNoEvent(events, (event) => event['type'] === 'error', 'team status scenario error');

        const joinedText = capturedBodies.flatMap((entry) => extractRequestTexts(entry)).join('\n');
        if (!joinedText.includes('[OPENAWORK TEAM STATUS SNAPSHOT]')) {
          throw new Error('expected upstream request to include team status snapshot');
        }
      } finally {
        await app.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        await closeDb();
      }
    },
  );
}

function configureProvider(userId: string): void {
  const providers = [
    {
      id: PROVIDER_ID,
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: `http://127.0.0.1:${RESPONSES_PORT}`,
      apiKey: 'test-key',
      upstreamProtocol: 'responses',
      defaultModels: [{ id: MODEL_ID, label: 'Team Status Model', enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const selection = {
    chat: { providerId: PROVIDER_ID, modelId: MODEL_ID },
    fast: { providerId: PROVIDER_ID, modelId: MODEL_ID },
  };

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(providers)],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(selection)],
  );
}

async function createSession(app: FastifyInstance, accessToken: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {
      metadata: {
        teamWorkspaceId: 'tw-team-status',
        teamRoleInstance: {
          rootSessionId: 's-team-root',
          roleLayer: 'reception',
        },
      },
    },
  });
  const body = response.json() as { sessionId: string };
  return body.sessionId;
}

async function seedTeamRuntime(sessionId: string, userId: string): Promise<void> {
  sqliteRun(
    `UPDATE sessions
        SET role_layer = 'reception',
            metadata_json = ?,
            title = '团队根会话'
      WHERE id = ? AND user_id = ?`,
    [
      JSON.stringify({
        teamWorkspaceId: 'tw-team-status',
        teamRoleInstance: { rootSessionId: sessionId, roleLayer: 'reception' },
      }),
      sessionId,
      userId,
    ],
  );
  sqliteRun(
    `INSERT INTO sessions (
       id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id
     ) VALUES (?, ?, ?, ?, 'idle', 'executor', ?), (?, ?, ?, ?, 'idle', 'reviewer', ?)`,
    [
      's-team-exec',
      userId,
      '执行会话',
      JSON.stringify({ teamWorkspaceId: 'tw-team-status' }),
      sessionId,
      's-team-review',
      userId,
      '评审会话',
      JSON.stringify({ teamWorkspaceId: 'tw-team-status' }),
      sessionId,
    ],
  );

  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
  const done1 = taskManager.addTask(graph, {
    title: '完成登录接口修复',
    status: 'pending',
    priority: 'high',
    blockedBy: [],
    sessionId: 's-team-exec',
    tags: [],
  });
  taskManager.startTask(graph, done1.id);
  taskManager.completeTask(graph, done1.id, '已完成');

  const done2 = taskManager.addTask(graph, {
    title: '补齐回归测试审查',
    status: 'pending',
    priority: 'medium',
    blockedBy: [],
    sessionId: 's-team-review',
    tags: [],
  });
  taskManager.startTask(graph, done2.id);
  taskManager.completeTask(graph, done2.id, '已完成');

  taskManager.addTask(graph, {
    title: '收尾文档同步',
    status: 'pending',
    priority: 'medium',
    blockedBy: [done2.id],
    sessionId: 's-team-exec',
    tags: [],
  });
  await taskManager.save(graph);
}

function extractRequestTexts(body: Record<string, unknown>): string[] {
  const input = body['input'];
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const content = item['content'];
    if (typeof content === 'string') {
      return [content];
    }
    if (!Array.isArray(content)) {
      return [];
    }

    return content.flatMap((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return [];
      }
      return typeof part['text'] === 'string' ? [part['text']] : [];
    });
  });
}

function writeResponseEvent(res: ServerResponse, event: string, payload: unknown): void {
  const normalizedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? ('type' in (payload as Record<string, unknown>)
          ? (payload as Record<string, unknown>)
          : { type: event, ...(payload as Record<string, unknown>) })
      : { type: event };
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(normalizedPayload)}\n\n`);
}

function writeTextCompletion(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  writeResponseEvent(res, 'response.created', {
    response: {
      id: 'resp_status',
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'in_progress',
      model: MODEL_ID,
      output: [],
    },
  });
  writeResponseEvent(res, 'response.output_item.added', {
    output_index: 0,
    item: {
      id: 'msg_status',
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
    },
  });
  writeResponseEvent(res, 'response.content_part.added', {
    item_id: 'msg_status',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  writeResponseEvent(res, 'response.output_text.delta', {
    output_index: 0,
    content_index: 0,
    item_id: 'msg_status',
    delta: text,
  });
  writeResponseEvent(res, 'response.output_text.done', {
    output_index: 0,
    content_index: 0,
    item_id: 'msg_status',
    text,
  });
  writeResponseEvent(res, 'response.content_part.done', {
    item_id: 'msg_status',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text, annotations: [] },
  });
  writeResponseEvent(res, 'response.output_item.done', {
    output_index: 0,
    item: {
      id: 'msg_status',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  });
  writeResponseEvent(res, 'response.completed', {
    response: {
      id: 'resp_status',
      status: 'completed',
      output: [
        {
          id: 'msg_status',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 30, total_tokens: 80 },
    },
  });
  res.end();
}

function parseSseChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function assertEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  label: string,
): void {
  if (!events.some(predicate)) {
    const summary = events.map((event) => event['type']).join(', ');
    throw new Error(`${label} was not observed. Captured event types: [${summary}]`);
  }
}

function assertNoEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  label: string,
): void {
  const matches = events.filter(predicate);
  if (matches.length > 0) {
    throw new Error(`${label} but observed unexpected events: ${JSON.stringify(matches, null, 2)}`);
  }
}

void main();
