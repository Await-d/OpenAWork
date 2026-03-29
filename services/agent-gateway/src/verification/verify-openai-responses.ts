import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import authPlugin from '../auth.js';
import { connectDb, closeDb, migrate, sqliteGet, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream.js';
import { withTempEnv } from './task-verification-helpers.js';

type ScenarioName =
  | 'text'
  | 'tool'
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

        await verifyTextScenario({ accessToken, app, capturedRequests });
        await verifyToolScenario({ accessToken, app, capturedRequests });
        await verifyToolEmptyArgsScenario({ accessToken, app, capturedRequests });
        await verifyResponsesToolEofScenario({ accessToken, app, capturedRequests });
        await verifyChatCompletionsToolEofScenario({ accessToken, app, capturedRequests });
        await verifyIncompleteScenario({ accessToken, app, capturedRequests });
        await verifyErrorScenario({ accessToken, app, capturedRequests });
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
      event['toolName'] === 'bash' &&
      event['isError'] === true &&
      String(event['output']).includes('Tool "bash" was called without arguments'),
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

function handleToolEmptyArgsScenario(body: Record<string, unknown>, res: ServerResponse): void {
  if (!hasFunctionCallOutput(body)) {
    writeResponseEvent(res, 'response.output_item.added', {
      output_index: 0,
      item: {
        id: 'fc_empty_bash',
        type: 'function_call',
        call_id: 'call_empty_bash',
        name: 'bash',
        arguments: '{}',
      },
    });
    writeResponseEvent(res, 'response.completed', {
      response: {
        output: [
          {
            id: 'fc_empty_bash',
            type: 'function_call',
            call_id: 'call_empty_bash',
            name: 'bash',
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
  if (requestContainsText(body, '错误验证')) return 'error';
  if (requestContainsText(body, '截断验证')) return 'incomplete';
  if (requestContainsText(body, 'provider alias chat EOF工具验证')) return 'chat_tool_eof';
  if (requestContainsText(body, 'provider alias responses EOF工具验证')) return 'tool_eof';
  if (requestContainsText(body, '空参数工具验证')) return 'tool_empty_args';
  if (requestContainsText(body, '工具验证')) return 'tool';
  return 'text';
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
  if (!requestContainsText(body, expectedUserText)) {
    throw new Error(`expected request messages to contain user text: ${expectedUserText}`);
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
