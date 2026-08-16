import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import { describe, expect, it } from 'vitest';
import {
  buildNativeModel,
  type UpstreamProtocolKind,
} from '../../v2-runtime/upstream/native-model.js';
import type { ExtendedThinkingConfig } from '../../v2-runtime/upstream/provider-options.js';
import { runUpstreamStream } from '../../v2-runtime/upstream/stream-runner.js';

const thinking = {
  config: { type: 'enabled', budgetTokens: 16_384 },
  effort: 'high',
  providerType: 'openai',
  supportsThinking: true,
} satisfies ExtendedThinkingConfig;

const writeResponsesStream = (response: ServerResponse): void => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const writeEvent = (type: string, body: Readonly<Record<string, unknown>>): void => {
    response.write(`event: ${type}\n`);
    response.write(`data: ${JSON.stringify({ type, ...body })}\n\n`);
  };
  writeEvent('response.output_item.added', {
    output_index: 0,
    item: { id: 'message-fixture', type: 'message', role: 'assistant', status: 'in_progress' },
  });
  writeEvent('response.content_part.added', {
    item_id: 'message-fixture',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  writeEvent('response.output_text.delta', {
    item_id: 'message-fixture',
    output_index: 0,
    content_index: 0,
    delta: 'fixture-ok',
  });
  writeEvent('response.completed', {
    response: {
      id: 'response-fixture',
      status: 'completed',
      service_tier: 'priority',
      output: [],
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    },
  });
  response.end();
};

const writeChatCompletionsStream = (response: ServerResponse): void => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(
    `data: ${JSON.stringify({
      id: 'chat-fixture',
      object: 'chat.completion.chunk',
      created: 0,
      service_tier: 'priority',
      model: 'gpt-5.4',
      choices: [
        { index: 0, delta: { role: 'assistant', content: 'fixture-ok' }, finish_reason: null },
      ],
    })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({
      id: 'chat-fixture',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'gpt-5.4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      service_tier: 'priority',
    })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
};

const expectedPath = (protocol: UpstreamProtocolKind): string =>
  protocol === 'responses' ? '/v1/responses' : '/v1/chat/completions';

describe('OpenAI upstream parameter forwarding', () => {
  it.each([
    { providerType: 'openai', upstreamProtocol: 'responses' },
    { providerType: 'openai', upstreamProtocol: 'chat_completions' },
    { providerType: 'custom', upstreamProtocol: 'responses' },
    { providerType: 'custom', upstreamProtocol: 'chat_completions' },
  ] as const)(
    'sends Fast tier and reasoning effort to the $upstreamProtocol endpoint for $providerType',
    async ({ providerType, upstreamProtocol }) => {
      let requestPath: string | undefined;
      let requestBody: string | undefined;
      const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.once('end', () => {
          requestPath = request.url;
          requestBody = Buffer.concat(chunks).toString('utf8');
          if (upstreamProtocol === 'responses') {
            writeResponsesStream(response);
            return;
          }
          writeChatCompletionsStream(response);
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close();
        throw new Error('local upstream fixture did not expose a TCP port');
      }

      try {
        let finishInfo: unknown;
        let diagnostics: unknown;
        const model = buildNativeModel({
          providerType,
          upstreamProtocol,
          apiKey: 'fixture-key',
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          allowInsecureLocalhost: true,
          model: 'gpt-5.4',
        });
        const chunks = Array.from(
          await Effect.runPromise(
            Stream.runCollect(
              runUpstreamStream({
                model,
                modelId: 'gpt-5.4',
                messages: [OpenCodeLLM.Message.user('ping')],
                providerType,
                upstreamProtocol,
                openaiFastMode: true,
                thinking,
                onFinish: (info) => {
                  finishInfo = info;
                },
                onDiagnostics: (info) => {
                  diagnostics = info;
                },
              }),
            ),
          ),
        );

        expect(chunks.some((chunk) => chunk.type === 'text_delta')).toBe(true);
        expect(finishInfo).toMatchObject({
          providerMetadata: { openai: { serviceTier: 'priority' } },
        });
        expect(diagnostics).toMatchObject({ openaiServiceTier: 'priority' });
        expect(requestPath).toBe(expectedPath(upstreamProtocol));
        expect(JSON.parse(requestBody ?? 'null')).toMatchObject({
          model: 'gpt-5.4',
          service_tier: 'priority',
          ...(upstreamProtocol === 'responses'
            ? { reasoning: { effort: 'high' } }
            : { reasoning_effort: 'high' }),
        });
        expect(JSON.parse(requestBody ?? 'null')).not.toHaveProperty('openaiFastMode');
        expect(JSON.parse(requestBody ?? 'null')).not.toHaveProperty('fast');
      } finally {
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );
});
