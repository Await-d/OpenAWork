import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { calculateTokenCost } from '@openAwork/agent-core';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import authPlugin from '../auth.js';
import { connectDb, closeDb, migrate, sqliteGet, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { withTempEnv } from './task-verification-helpers.js';

type ScenarioName =
  | 'text'
  | 'tool'
  | 'tool_error'
  | 'tool_error_recovery'
  | 'tool_empty_args'
  | 'tool_eof'
  | 'chat_tool_eof'
  | 'incomplete'
  | 'error';

interface ScenarioRequestCapture {
  scenario: ScenarioName;
  body: Record<string, unknown>;
  path: string;
}

interface VerificationContext {
  accessToken: string;
  app: FastifyInstance;
  capturedRequests: ScenarioRequestCapture[];
  userId: string;
}

interface MonthlyUsageSnapshot {
  costUsd: number;
  inputTokens: number;
  month: string;
  outputTokens: number;
}

const RESPONSES_PORT = 3311;
const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_ALIAS_MODEL = 'team-model-alias';
const DISABLED_TOOL_NAME = 'fake_tool';

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_BASE_URL: `http://127.0.0.1:${RESPONSES_PORT}`,
      AI_API_KEY: 'test-key',
    },
    async () => {
      const capturedRequests: ScenarioRequestCapture[] = [];
      const upstream = createServer((req, res) => {
        if (req.url !== '/responses' && req.url !== '/chat/completions') {
          res.statusCode = 404;
          res.end();
          return;
        }

        const chunks: string[] = [];
        req.on('data', (chunk) => {
          chunks.push(chunk.toString());
        });
        req.on('end', () => {
          const body = JSON.parse(chunks.join('')) as Record<string, unknown>;
          const scenario = resolveScenario(body);
          capturedRequests.push({ scenario, body, path: req.url ?? '' });

          if (scenario === 'error') {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'simulated upstream failure' } }));
            return;
          }

          if (scenario === 'tool_error') {
            handleToolErrorScenario(body, res);
            return;
          }

          if (scenario === 'tool_error_recovery') {
            handleToolErrorRecoveryScenario(body, res);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/event-stream' });

          switch (scenario) {
            case 'tool':
              handleToolScenario(body, res);
              return;
            case 'tool_empty_args':
              handleToolEmptyArgsScenario(body, res);
              return;
            case 'tool_eof':
              handleToolEofScenario(body, res);
              return;
            case 'chat_tool_eof':
              handleChatToolEofScenario(body, res);
              return;
            case 'incomplete':
              writeResponseEvent(res, 'response.output_text.delta', {
                output_index: 0,
                content_index: 0,
                item_id: 'msg_incomplete',
                delta: '输出被截断',
              });
              writeResponseEvent(res, 'response.incomplete', {
                response: {
                  incomplete_details: { reason: 'max_output_tokens' },
                },
              });
              res.end();
              return;
            case 'text':
            default:
              writeTextCompletion(res, '验证成功');
              return;
          }
        });
      });

      await new Promise<void>((resolve) => upstream.listen(RESPONSES_PORT, '127.0.0.1', resolve));

      await connectDb();
      await migrate();

      const admin = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
        'admin@openAwork.local',
      ]);
      const adminId = admin?.id ?? randomUUID();
      if (!admin) {
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          adminId,
          'admin@openAwork.local',
          createHash('sha256').update('admin123456').digest('hex'),
        ]);
      }

      const app = Fastify();
      await app.register(cors, { origin: true });
      await app.register(websocket);
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(sessionsRoutes);
      await app.register(streamRoutes);
      await app.ready();

      try {
        const accessToken = app.jwt.sign({ sub: adminId, email: 'admin@openAwork.local' });
        configureOpenAIProvider(adminId);

        await verifyTextScenario({ accessToken, app, capturedRequests, userId: adminId });
        await verifyToolScenario({ accessToken, app, capturedRequests, userId: adminId });
        await verifyToolEmptyArgsScenario({ accessToken, app, capturedRequests, userId: adminId });
        await verifyResponsesToolEofScenario({
          accessToken,
          app,
          capturedRequests,
          userId: adminId,
        });
        await verifyChatCompletionsToolEofScenario({
          accessToken,
          app,
          capturedRequests,
          userId: adminId,
        });
        await verifyIncompleteScenario({ accessToken, app, capturedRequests, userId: adminId });
        await verifyErrorScenario({ accessToken, app, capturedRequests, userId: adminId });
        await verifyRecoveryAfterErrorScenario({
          accessToken,
          app,
          capturedRequests,
          userId: adminId,
        });
        await verifyRecoveryAfterToolErrorScenario({
          accessToken,
          app,
          capturedRequests,
          userId: adminId,
        });
      } finally {
        await app.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        await closeDb();
      }
    },
  );
}

function configureOpenAIProvider(userId: string): void {
  const providerConfig = [
    {
      id: OPENAI_PROVIDER_ID,
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: `http://127.0.0.1:${RESPONSES_PORT}`,
      apiKey: 'test-key',
      defaultModels: [{ id: OPENAI_ALIAS_MODEL, label: 'Team Alias', enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'moonshot-local',
      type: 'moonshot',
      name: 'Moonshot Local',
      enabled: true,
      baseUrl: `http://127.0.0.1:${RESPONSES_PORT}`,
      apiKey: 'test-key',
      defaultModels: [{ id: 'kimi-k2.5', label: 'Kimi K2.5', enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const activeSelection = {
    chat: { providerId: OPENAI_PROVIDER_ID, modelId: OPENAI_ALIAS_MODEL },
    fast: { providerId: OPENAI_PROVIDER_ID, modelId: OPENAI_ALIAS_MODEL },
  };

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(providerConfig)],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(activeSelection)],
  );
}

async function verifyTextScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const beforeUsage = captureMonthlyUsageSnapshot(input.userId);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 文本验证',
    clientRequestId: 'req-responses-text',
  });

  assertStatus(response.statusCode, 200, 'text scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '验证成功',
    'text scenario output text',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    'text scenario done',
  );
  assertOrderedEvents(
    events,
    [
      (event) => event['type'] === 'text_delta' && event['delta'] === '验证成功',
      (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    ],
    'text scenario event order',
  );
  assertSingleEvent(events, (event) => event['type'] === 'done', 'text scenario done count');
  assertNoEvent(
    events,
    (event) => event['type'] === 'error',
    'text scenario should not emit error',
  );

  const request = lastScenarioRequest(input.capturedRequests, 'text');
  assertResponsesPayloadShape(request.body, 'provider alias responses 文本验证');
  assertMonthlyUsageDelta({
    before: beforeUsage,
    expectedCostUsd: 0,
    expectedInputTokens: 1,
    expectedOutputTokens: 1,
    label: 'text scenario usage persistence',
    userId: input.userId,
  });
}

async function verifyToolScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 工具验证',
    clientRequestId: 'req-responses-tool',
  });

  assertStatus(response.statusCode, 200, 'tool scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) => event['type'] === 'tool_call_delta' && event['toolName'] === DISABLED_TOOL_NAME,
    'tool scenario emits tool_call_delta',
  );
  assertEvent(
    events,
    (event) =>
      event['type'] === 'tool_result' &&
      event['toolName'] === DISABLED_TOOL_NAME &&
      event['isError'] === true &&
      String(event['output']).includes(
        `Tool "${DISABLED_TOOL_NAME}" is not enabled for this request`,
      ),
    'tool scenario emits deterministic tool_result',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '工具链路完成',
    'tool scenario final text',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    'tool scenario final done',
  );
  assertOrderedEvents(
    events,
    [
      (event) => event['type'] === 'tool_call_delta' && event['toolName'] === DISABLED_TOOL_NAME,
      (event) =>
        event['type'] === 'tool_result' &&
        event['toolName'] === DISABLED_TOOL_NAME &&
        event['isError'] === true,
      (event) => event['type'] === 'text_delta' && event['delta'] === '工具链路完成',
      (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    ],
    'tool scenario event order',
  );
  assertSingleEvent(events, (event) => event['type'] === 'done', 'tool scenario done count');
  if (events.some((event) => event['type'] === 'done' && event['stopReason'] === 'tool_use')) {
    throw new Error('tool scenario should not surface intermediate tool_use done chunk');
  }

  const toolRequests = scenarioRequests(input.capturedRequests, 'tool');
  if (toolRequests.length < 2) {
    throw new Error(
      `expected tool scenario to issue at least 2 upstream requests, got ${toolRequests.length}`,
    );
  }
  assertResponsesPayloadShape(toolRequests[0]!.body, 'provider alias responses 工具验证');
  assertResponsesPayloadShape(toolRequests[1]!.body, 'provider alias responses 工具验证');
  if (!hasFunctionCallOutput(toolRequests[1]!.body)) {
    throw new Error('expected second tool scenario request to include function_call_output');
  }
}

async function verifyToolEmptyArgsScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 空参数工具验证',
    clientRequestId: 'req-responses-tool-empty-args',
  });

  assertStatus(response.statusCode, 200, 'tool empty args scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) =>
      event['type'] === 'tool_result' &&
      event['toolName'] === 'list' &&
      event['isError'] === true &&
      String(event['output']).includes('Tool "list" was called without arguments'),
    'tool empty args scenario emits malformed-args tool_result',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '空参数工具链路完成',
    'tool empty args scenario final text',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    'tool empty args scenario final done',
  );

  const requests = scenarioRequests(input.capturedRequests, 'tool_empty_args');
  if (requests.length < 2) {
    throw new Error(
      `expected tool empty args scenario to issue at least 2 upstream requests, got ${requests.length}`,
    );
  }
  if (!hasFunctionCallOutput(requests[1]!.body)) {
    throw new Error('expected second empty args request to include function_call_output');
  }
}

async function verifyResponsesToolEofScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses EOF工具验证',
    clientRequestId: 'req-responses-tool-eof',
  });

  assertStatus(response.statusCode, 200, 'responses eof tool scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) => event['type'] === 'tool_result',
    'responses eof tool scenario emits tool_result',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '最终答复',
    'responses eof tool scenario final text',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    'responses eof tool scenario final done',
  );
  assertNoEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'tool_use',
    'responses eof tool scenario should not emit intermediate tool_use done',
  );

  const requests = scenarioRequests(input.capturedRequests, 'tool_eof');
  if (requests.length < 2) {
    throw new Error(
      `expected responses eof tool scenario to issue 2 requests, got ${requests.length}`,
    );
  }

  assertRequestsPath(requests, '/responses', 'responses eof tool scenario path');
  assertResponsesPayloadShape(requests[0]!.body, 'provider alias responses EOF工具验证');
  assertResponsesPayloadShape(requests[1]!.body, 'provider alias responses EOF工具验证');
  if (!hasFunctionCallOutput(requests[1]!.body)) {
    throw new Error('expected responses eof second request to include function_call_output');
  }
}

async function verifyChatCompletionsToolEofScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const beforeUsage = captureMonthlyUsageSnapshot(input.userId);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias chat EOF工具验证',
    clientRequestId: 'req-chat-tool-eof',
    providerId: 'moonshot-local',
    model: 'kimi-k2.5',
  });

  assertStatus(response.statusCode, 200, 'chat eof tool scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) => event['type'] === 'tool_result',
    'chat eof tool scenario emits tool_result',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '最终答复',
    'chat eof tool scenario final text',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    'chat eof tool scenario final done',
  );
  assertNoEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'tool_use',
    'chat eof tool scenario should not emit intermediate tool_use done',
  );

  const requests = scenarioRequests(input.capturedRequests, 'chat_tool_eof');
  if (requests.length < 2) {
    throw new Error(`expected chat eof tool scenario to issue 2 requests, got ${requests.length}`);
  }

  assertRequestsPath(requests, '/chat/completions', 'chat eof tool scenario path');
  assertChatPayloadShape(requests[0]!.body, 'provider alias chat EOF工具验证');
  assertChatPayloadShape(requests[1]!.body, 'provider alias chat EOF工具验证');
  if (!hasChatToolResult(requests[1]!.body)) {
    throw new Error('expected chat eof second request to include tool role output');
  }
  assertMonthlyUsageDelta({
    before: beforeUsage,
    expectedCostUsd: calculateTokenCost(3, 2, 0.6, 3),
    expectedInputTokens: 3,
    expectedOutputTokens: 2,
    label: 'chat eof tool scenario usage persistence',
    userId: input.userId,
  });
}

async function verifyIncompleteScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 截断验证',
    clientRequestId: 'req-responses-incomplete',
  });

  assertStatus(response.statusCode, 200, 'incomplete scenario status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) => event['type'] === 'text_delta' && event['delta'] === '输出被截断',
    'incomplete scenario text delta',
  );
  assertEvent(
    events,
    (event) => event['type'] === 'done' && event['stopReason'] === 'max_tokens',
    'incomplete scenario stop reason',
  );
  assertOrderedEvents(
    events,
    [
      (event) => event['type'] === 'text_delta' && event['delta'] === '输出被截断',
      (event) => event['type'] === 'done' && event['stopReason'] === 'max_tokens',
    ],
    'incomplete scenario event order',
  );
  assertSingleEvent(events, (event) => event['type'] === 'done', 'incomplete scenario done count');
  if (events.some((event) => event['type'] === 'error')) {
    throw new Error('incomplete scenario should not emit error chunk');
  }
}

async function verifyErrorScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const response = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 错误验证',
    clientRequestId: 'req-responses-error',
  });

  assertStatus(response.statusCode, 200, 'error scenario transport status');
  const events = parseSseChunks(response.body);
  assertEvent(
    events,
    (event) =>
      event['type'] === 'error' &&
      event['code'] === 'MODEL_ERROR' &&
      event['status'] === 502 &&
      event['message'] === 'Upstream request failed (502): simulated upstream failure',
    'error scenario emits MODEL_ERROR',
  );
  assertSingleEvent(events, (event) => event['type'] === 'error', 'error scenario error count');
  assertNoEvent(events, (event) => event['type'] === 'done', 'error scenario should not emit done');
}

async function verifyRecoveryAfterErrorScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const errorResponse = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 错误验证',
    clientRequestId: 'req-responses-error-then-recover',
  });

  assertStatus(errorResponse.statusCode, 200, 'error then recover first transport status');
  const errorEvents = parseSseChunks(errorResponse.body);
  assertEvent(
    errorEvents,
    (event) =>
      event['type'] === 'error' &&
      event['code'] === 'MODEL_ERROR' &&
      event['message'] === 'Upstream request failed (502): simulated upstream failure',
    'error then recover first request emits MODEL_ERROR',
  );
  assertSessionStateStatus(sessionId, 'idle', 'error then recover state after failure');

  const recoveryResponse = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 错误后恢复成功',
    clientRequestId: 'req-responses-recovery',
  });

  assertStatus(recoveryResponse.statusCode, 200, 'error then recover second transport status');
  const recoveryEvents = parseSseChunks(recoveryResponse.body);
  assertOrderedEvents(
    recoveryEvents,
    [
      (event) => event['type'] === 'text_delta' && event['delta'] === '验证成功',
      (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    ],
    'error then recover second request event order',
  );
  assertNoEvent(
    recoveryEvents,
    (event) => event['type'] === 'error',
    'error then recover second request should not emit error',
  );
  assertSessionStateStatus(sessionId, 'idle', 'error then recover state after second request');

  const recoveryRequest = lastScenarioRequest(input.capturedRequests, 'text');
  assertResponsesPayloadShape(recoveryRequest.body, 'provider alias responses 错误后恢复成功');
  if (requestContainsText(recoveryRequest.body, '[错误:')) {
    throw new Error('recovery request should not include persisted assistant error text');
  }
  if (requestContainsText(recoveryRequest.body, 'simulated upstream failure')) {
    throw new Error('recovery request should not include previous upstream failure message');
  }
}

async function verifyRecoveryAfterToolErrorScenario(input: VerificationContext): Promise<void> {
  const sessionId = await createSession(input.app, input.accessToken);
  const errorResponse = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 工具错误验证',
    clientRequestId: 'req-responses-tool-error',
  });

  assertStatus(errorResponse.statusCode, 200, 'tool error then recover first transport status');
  const errorEvents = parseSseChunks(errorResponse.body);
  assertEvent(
    errorEvents,
    (event) => event['type'] === 'tool_result' && event['toolName'] === DISABLED_TOOL_NAME,
    'tool error then recover first request emits tool_result',
  );
  assertEvent(
    errorEvents,
    (event) =>
      event['type'] === 'error' &&
      event['code'] === 'MODEL_ERROR' &&
      event['message'] === 'Upstream request failed (502): simulated tool recovery failure',
    'tool error then recover first request emits MODEL_ERROR',
  );
  assertNoEvent(
    errorEvents,
    (event) => event['type'] === 'done',
    'tool error then recover first request should not emit done',
  );
  assertSessionStateStatus(sessionId, 'idle', 'tool error then recover state after failure');

  const recoveryResponse = await streamScenario({
    app: input.app,
    accessToken: input.accessToken,
    sessionId,
    message: 'provider alias responses 工具错误后恢复成功',
    clientRequestId: 'req-responses-tool-error-recovery',
  });

  assertStatus(recoveryResponse.statusCode, 200, 'tool error then recover second transport status');
  const recoveryEvents = parseSseChunks(recoveryResponse.body);
  assertOrderedEvents(
    recoveryEvents,
    [
      (event) => event['type'] === 'text_delta' && event['delta'] === '工具错误恢复成功',
      (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
    ],
    'tool error then recover second request event order',
  );
  assertNoEvent(
    recoveryEvents,
    (event) => event['type'] === 'error',
    'tool error then recover second request should not emit error',
  );
  assertSessionStateStatus(sessionId, 'idle', 'tool error then recover state after second request');

  const recoveryRequest = lastScenarioRequest(input.capturedRequests, 'tool_error_recovery');
  assertResponsesPayloadShape(recoveryRequest.body, 'provider alias responses 工具错误后恢复成功');
  if (hasFunctionCall(recoveryRequest.body)) {
    throw new Error('tool error recovery request should not include stale function_call items');
  }
  if (hasFunctionCallOutput(recoveryRequest.body)) {
    throw new Error(
      'tool error recovery request should not include stale function_call_output items',
    );
  }
}

function handleToolScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasFunctionCallOutput(body)) {
    writeResponseEvent(res, 'response.output_item.added', {
      output_index: 0,
      item: {
        id: 'fc_disabled_tool',
        type: 'function_call',
        call_id: 'call_disabled_tool',
        name: DISABLED_TOOL_NAME,
        arguments: '',
      },
    });
    writeResponseEvent(res, 'response.function_call_arguments.delta', {
      output_index: 0,
      item_id: 'fc_disabled_tool',
      delta: JSON.stringify({ query: '上海天气' }),
    });
    writeResponseEvent(res, 'response.output_item.done', {
      output_index: 0,
      item: {
        id: 'fc_disabled_tool',
        type: 'function_call',
        call_id: 'call_disabled_tool',
        name: DISABLED_TOOL_NAME,
        arguments: JSON.stringify({ query: '上海天气' }),
      },
    });
    writeResponseEvent(res, 'response.completed', {
      response: {
        output: [
          {
            id: 'fc_disabled_tool',
            type: 'function_call',
            call_id: 'call_disabled_tool',
            name: DISABLED_TOOL_NAME,
            arguments: JSON.stringify({ query: '上海天气' }),
          },
        ],
      },
    });
    res.end();
    return;
  }

  writeTextCompletion(res, '工具链路完成');
}

function handleToolErrorScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasFunctionCallOutput(body)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    writeResponseEvent(res, 'response.output_item.added', {
      output_index: 0,
      item: {
        id: 'fc_error_tool',
        type: 'function_call',
        call_id: 'call_error_tool',
        name: DISABLED_TOOL_NAME,
        arguments: '',
      },
    });
    writeResponseEvent(res, 'response.function_call_arguments.delta', {
      output_index: 0,
      item_id: 'fc_error_tool',
      delta: JSON.stringify({ query: '上海天气' }),
    });
    writeResponseEvent(res, 'response.output_item.done', {
      output_index: 0,
      item: {
        id: 'fc_error_tool',
        type: 'function_call',
        call_id: 'call_error_tool',
        name: DISABLED_TOOL_NAME,
        arguments: JSON.stringify({ query: '上海天气' }),
      },
    });
    writeResponseEvent(res, 'response.completed', {
      response: {
        output: [
          {
            id: 'fc_error_tool',
            type: 'function_call',
            call_id: 'call_error_tool',
            name: DISABLED_TOOL_NAME,
            arguments: JSON.stringify({ query: '上海天气' }),
          },
        ],
      },
    });
    res.end();
    return;
  }

  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'simulated tool recovery failure' } }));
}

function handleToolErrorRecoveryScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (hasFunctionCall(body) || hasFunctionCallOutput(body)) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'stale failed tool history leaked into recovery request' },
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  writeTextCompletion(res, '工具错误恢复成功');
}

function handleToolEmptyArgsScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasFunctionCallOutput(body)) {
    writeResponseEvent(res, 'response.output_item.added', {
      output_index: 0,
      item: {
        id: 'fc_empty_list',
        type: 'function_call',
        call_id: 'call_empty_list',
        name: 'list',
        arguments: '{}',
      },
    });
    writeResponseEvent(res, 'response.completed', {
      response: {
        output: [
          {
            id: 'fc_empty_list',
            type: 'function_call',
            call_id: 'call_empty_list',
            name: 'list',
            arguments: '{}',
          },
        ],
      },
    });
    res.end();
    return;
  }

  writeTextCompletion(res, '空参数工具链路完成');
}

function handleToolEofScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasFunctionCallOutput(body)) {
    res.write(
      'event: response.output_item.added\n' +
        'data: {"output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"unknown_tool","arguments":"{\\"query\\":\\"上海天气\\"}"}}\n\n' +
        'event: response.completed\n' +
        'data: {"response":{"output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"unknown_tool","arguments":"{\\"query\\":\\"上海天气\\"}"}]}}',
    );
    res.end();
    return;
  }

  writeTextCompletion(res, '最终答复');
}

function handleChatToolEofScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasChatToolResult(body)) {
    res.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"unknown_tool","arguments":"{\\"query\\":\\"上海天气\\"}"}}]},"finish_reason":"tool_calls"}]}',
    );
    res.end();
    return;
  }

  res.write(
    'data: {"choices":[{"delta":{"content":"最终答复"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n' +
      'data: [DONE]\n\n',
  );
  res.end();
}

function writeTextCompletion(res: ServerResponse, text: string): void {
  writeResponseEvent(res, 'response.output_text.delta', {
    output_index: 0,
    content_index: 0,
    item_id: 'msg_1',
    delta: text,
  });
  writeResponseEvent(res, 'response.completed', {
    response: {
      output: [{ id: 'msg_1', type: 'message' }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
}

function writeResponseEvent(
  res: ServerResponse,
  event: string,
  body: Record<string, unknown>,
): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function resolveScenario(body: Record<string, unknown>): ScenarioName {
  const latestUserText = extractLatestUserRequestText(body);
  const matches = (needle: string) => latestUserText.includes(needle);

  if (matches('工具错误后恢复成功')) return 'tool_error_recovery';
  if (matches('工具错误验证')) return 'tool_error';
  if (matches('provider alias chat EOF工具验证')) return 'chat_tool_eof';
  if (matches('provider alias responses EOF工具验证')) return 'tool_eof';
  if (matches('空参数工具验证')) return 'tool_empty_args';
  if (matches('工具验证')) return 'tool';
  if (matches('错误验证')) return 'error';
  if (matches('截断验证')) return 'incomplete';
  return 'text';
}

function extractLatestUserRequestText(body: Record<string, unknown>): string {
  const input = body['input'];
  if (Array.isArray(input)) {
    for (let index = input.length - 1; index >= 0; index -= 1) {
      const item = input[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      if (item['role'] !== 'user') {
        continue;
      }

      const content = item['content'];
      if (typeof content === 'string') {
        return content;
      }
      if (!Array.isArray(content)) {
        continue;
      }

      const parts = content.flatMap((part) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
          return [];
        }
        return typeof part['text'] === 'string' ? [part['text']] : [];
      });
      if (parts.length > 0) {
        return parts.join('\n');
      }
    }
  }

  const messages = body['messages'];
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      if (item['role'] !== 'user' || typeof item['content'] !== 'string') {
        continue;
      }
      return item['content'];
    }
  }

  return '';
}

async function createSession(app: FastifyInstance, accessToken: string): Promise<string> {
  const sessionRes = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: {},
  });
  if (sessionRes.statusCode !== 201) {
    throw new Error(`session creation failed: ${sessionRes.statusCode} ${sessionRes.body}`);
  }
  return (JSON.parse(sessionRes.body) as { sessionId: string }).sessionId;
}

async function streamScenario(input: {
  app: FastifyInstance;
  accessToken: string;
  sessionId: string;
  message: string;
  clientRequestId: string;
  model?: string;
  providerId?: string;
}): Promise<{ statusCode: number; body: string }> {
  return input.app.inject({
    method: 'GET',
    url: `/sessions/${input.sessionId}/stream/sse?message=${encodeURIComponent(input.message)}&clientRequestId=${encodeURIComponent(input.clientRequestId)}&providerId=${encodeURIComponent(input.providerId ?? OPENAI_PROVIDER_ID)}&model=${encodeURIComponent(input.model ?? OPENAI_ALIAS_MODEL)}&token=${encodeURIComponent(input.accessToken)}`,
  });
}

function assertRequestsPath(
  requests: ScenarioRequestCapture[],
  expectedPath: string,
  label: string,
): void {
  if (!requests.every((request) => request.path === expectedPath)) {
    throw new Error(`${label} expected all requests to target ${expectedPath}`);
  }
}

function scenarioRequests(
  capturedRequests: ScenarioRequestCapture[],
  scenario: ScenarioName,
): ScenarioRequestCapture[] {
  return capturedRequests.filter((entry) => entry.scenario === scenario);
}

function lastScenarioRequest(
  capturedRequests: ScenarioRequestCapture[],
  scenario: ScenarioName,
): ScenarioRequestCapture {
  const requests = scenarioRequests(capturedRequests, scenario);
  const request = requests.at(-1);
  if (!request) {
    throw new Error(`expected at least one captured request for scenario ${scenario}`);
  }
  return request;
}

function assertResponsesPayloadShape(
  body: Record<string, unknown>,
  expectedUserText: string,
): void {
  if (!Array.isArray(body['input'])) {
    throw new Error('expected Responses input payload');
  }
  if (body['messages'] !== undefined) {
    throw new Error('did not expect chat messages payload');
  }
  if (body['max_output_tokens'] !== 2048) {
    throw new Error('expected max_output_tokens=2048');
  }
  if (!requestContainsText(body, expectedUserText)) {
    throw new Error(`expected request input to contain user text: ${expectedUserText}`);
  }
}

function assertChatPayloadShape(body: Record<string, unknown>, expectedUserText: string): void {
  if (!Array.isArray(body['messages'])) {
    throw new Error('expected chat_completions messages payload');
  }
  if (body['input'] !== undefined) {
    throw new Error('did not expect Responses input payload');
  }
  if (body['max_tokens'] !== 2048) {
    throw new Error('expected max_tokens=2048');
  }
  const streamOptions = body['stream_options'];
  const streamOptionsRecord: Record<string, unknown> | null =
    streamOptions && typeof streamOptions === 'object' && !Array.isArray(streamOptions)
      ? (streamOptions as Record<string, unknown>)
      : null;
  if (streamOptionsRecord?.['include_usage'] !== true) {
    throw new Error('expected stream_options.include_usage=true');
  }
  if (!requestContainsText(body, expectedUserText)) {
    throw new Error(`expected request messages to contain user text: ${expectedUserText}`);
  }
}

function captureMonthlyUsageSnapshot(userId: string): MonthlyUsageSnapshot {
  const month = new Date().toISOString().slice(0, 7);
  const row = sqliteGet<{
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  }>(
    `SELECT input_tokens, output_tokens, cost_usd
     FROM usage_records
     WHERE user_id = ? AND month = ?
     LIMIT 1`,
    [userId, month],
  );

  return {
    costUsd: row?.cost_usd ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    month,
    outputTokens: row?.output_tokens ?? 0,
  };
}

function captureSessionStateStatus(sessionId: string): string | null {
  return (
    sqliteGet<{ state_status: string }>('SELECT state_status FROM sessions WHERE id = ? LIMIT 1', [
      sessionId,
    ])?.state_status ?? null
  );
}

function assertSessionStateStatus(sessionId: string, expected: string, label: string): void {
  const actual = captureSessionStateStatus(sessionId);
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected} but received ${actual ?? 'null'}`);
  }
}

function assertMonthlyUsageDelta(input: {
  before: MonthlyUsageSnapshot;
  expectedCostUsd: number;
  expectedInputTokens: number;
  expectedOutputTokens: number;
  label: string;
  userId: string;
}): void {
  const after = captureMonthlyUsageSnapshot(input.userId);
  const expectedInputTotal = input.before.inputTokens + input.expectedInputTokens;
  const expectedOutputTotal = input.before.outputTokens + input.expectedOutputTokens;
  const expectedCostTotal = Number((input.before.costUsd + input.expectedCostUsd).toFixed(8));

  if (after.inputTokens !== expectedInputTotal) {
    throw new Error(
      `${input.label} expected input_tokens=${expectedInputTotal} but received ${after.inputTokens}`,
    );
  }

  if (after.outputTokens !== expectedOutputTotal) {
    throw new Error(
      `${input.label} expected output_tokens=${expectedOutputTotal} but received ${after.outputTokens}`,
    );
  }

  if (Number(after.costUsd.toFixed(8)) !== expectedCostTotal) {
    throw new Error(
      `${input.label} expected cost_usd=${expectedCostTotal} but received ${after.costUsd}`,
    );
  }
}

function requestContainsText(body: Record<string, unknown>, text: string): boolean {
  return extractRequestTexts(body).some((entry) => entry.includes(text));
}

function hasFunctionCallOutput(body: Record<string, unknown>): boolean {
  const input = body['input'];
  return Array.isArray(input)
    ? input.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item['type'] === 'function_call_output',
      )
    : false;
}

function hasFunctionCall(body: Record<string, unknown>): boolean {
  const input = body['input'];
  return Array.isArray(input)
    ? input.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item['type'] === 'function_call',
      )
    : false;
}

function hasChatToolResult(body: Record<string, unknown>): boolean {
  const messages = body['messages'];
  return Array.isArray(messages)
    ? messages.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item['role'] === 'tool' &&
          typeof item['tool_call_id'] === 'string',
      )
    : false;
}

function extractRequestTexts(body: Record<string, unknown>): string[] {
  return [...extractResponseTexts(body), ...extractChatMessagesTexts(body)];
}

function extractResponseTexts(body: Record<string, unknown>): string[] {
  const input = body['input'];
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    if (typeof item['output'] === 'string') {
      return [item['output']];
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

function extractChatMessagesTexts(body: Record<string, unknown>): string[] {
  const messages = body['messages'];
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    return typeof item['content'] === 'string' ? [item['content']] : [];
  });
}

function assertStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected} but received ${actual}`);
  }
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
    throw new Error(`${label} was not observed in SSE output`);
  }
}

function assertNoEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  label: string,
): void {
  if (events.some(predicate)) {
    throw new Error(`${label} but matched an unexpected SSE event`);
  }
}

function assertSingleEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  label: string,
): void {
  const matches = events.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label} expected exactly 1 match but received ${matches.length}`);
  }
}

function assertOrderedEvents(
  events: Array<Record<string, unknown>>,
  predicates: Array<(event: Record<string, unknown>) => boolean>,
  label: string,
): void {
  let cursor = 0;
  for (const predicate of predicates) {
    const nextIndex = events.findIndex((event, index) => index >= cursor && predicate(event));
    if (nextIndex === -1) {
      throw new Error(`${label} failed to match expected event subsequence`);
    }
    cursor = nextIndex + 1;
  }
}

await main();
