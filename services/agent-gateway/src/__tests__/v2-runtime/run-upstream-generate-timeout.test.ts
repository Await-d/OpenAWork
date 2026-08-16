import { createServer } from 'node:http';
import { Effect } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpstreamGenerate } from '../../v2-runtime/upstream/run-upstream-generate.js';

const response = () =>
  new OpenCodeLLM.LLMResponse({
    message: OpenCodeLLM.Message.assistant('hello'),
    events: [
      OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'hello' }),
      OpenCodeLLM.LLMEvent.finish({
        reason: 'stop',
        usage: new OpenCodeLLM.Usage({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
      }),
    ],
    usage: new OpenCodeLLM.Usage({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
    finishReason: 'stop',
  });

const generateSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'generate');

afterEach(() => {
  generateSpy.mockReset();
  delete process.env['OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS'];
});

describe('runUpstreamGenerate', () => {
  it('returns a lazy Effect contract without starting the upstream request', () => {
    const program = runUpstreamGenerate({
      providerType: 'openai',
      model: 'stub-model',
      baseURL: 'https://example.test/v1',
      messages: [OpenCodeLLM.Message.user('ping')],
    });

    expect(Effect.isEffect(program)).toBe(true);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('maps a native response and forwards generation options', async () => {
    const nativeResponse = response();
    generateSpy.mockReturnValue(Effect.succeed(nativeResponse));

    const result = await Effect.runPromise(
      runUpstreamGenerate({
        providerType: 'openai',
        model: 'stub-model',
        baseURL: 'https://example.test/v1',
        messages: [OpenCodeLLM.Message.user('ping')],
        system: 'be concise',
        temperature: 0.2,
        maxOutputTokens: 42,
        topP: 0.8,
        frequencyPenalty: 0.1,
        presencePenalty: 0.05,
      }),
    );

    expect(result).toEqual({
      text: 'hello',
      inputTokens: 3,
      outputTokens: 5,
      finishReason: 'stop',
      raw: nativeResponse,
    });
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const request = generateSpy.mock.calls[0]?.[0];
    expect(request?.messages).toEqual([OpenCodeLLM.Message.user('ping')]);
    expect(request?.system).toEqual([{ type: 'text', text: 'be concise' }]);
    expect(request?.tools).toEqual([]);
    expect(request?.generation).toMatchObject({
      maxTokens: 42,
      temperature: 0.2,
      topP: 0.8,
      frequencyPenalty: 0.1,
      presencePenalty: 0.05,
    });
  });

  it('raises a stable error when the native Effect exceeds its intrinsic timeout', async () => {
    process.env['OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS'] = '50';
    generateSpy.mockReturnValue(Effect.never);

    await expect(
      Effect.runPromise(
        runUpstreamGenerate({
          providerType: 'openai',
          model: 'stub-model',
          baseURL: 'https://example.test/v1',
          messages: [OpenCodeLLM.Message.user('ping')],
        }),
      ),
    ).rejects.toThrow('upstream generate timeout (50ms)');
  });

  it('preserves native upstream errors', async () => {
    const upstreamError = new OpenCodeLLM.LLMError({
      module: 'test',
      method: 'generate',
      reason: new OpenCodeLLM.TransportReason({
        _tag: 'Transport',
        message: 'provider failed',
      }),
    });
    generateSpy.mockReturnValue(Effect.fail(upstreamError));

    await expect(
      Effect.runPromise(
        runUpstreamGenerate({
          providerType: 'openai',
          model: 'stub-model',
          baseURL: 'https://example.test/v1',
          messages: [OpenCodeLLM.Message.user('ping')],
        }),
      ),
    ).rejects.toBe(upstreamError);
  });

  it('does not arm an intrinsic timeout when timeoutMs is non-positive', async () => {
    const controller = new AbortController();
    generateSpy.mockReturnValue(Effect.never);
    const pending = Effect.runPromise(
      runUpstreamGenerate({
        providerType: 'openai',
        model: 'stub-model',
        baseURL: 'https://example.test/v1',
        messages: [OpenCodeLLM.Message.user('ping')],
        timeoutMs: 0,
        signal: controller.signal,
      }),
    );
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'upstream generate aborted',
    });
  });

  it('drives a native Responses request through a local HTTP fixture', async () => {
    generateSpy.mockRestore();
    let requestBody = '';
    const server = createServer((request, responseStream) => {
      const chunks: string[] = [];
      request.on('data', (chunk) => chunks.push(String(chunk)));
      request.on('end', () => {
        requestBody = chunks.join('');
        responseStream.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const writeEvent = (type: string, body: Readonly<Record<string, unknown>>) => {
          responseStream.write(`event: ${type}\n`);
          responseStream.write(`data: ${JSON.stringify({ type, ...body })}\n\n`);
        };
        writeEvent('response.output_item.added', {
          output_index: 0,
          item: { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'in_progress' },
        });
        writeEvent('response.content_part.added', {
          item_id: 'msg_fixture',
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
        writeEvent('response.output_text.delta', {
          output_index: 0,
          content_index: 0,
          item_id: 'msg_fixture',
          delta: 'fixture-ok',
        });
        writeEvent('response.completed', {
          response: {
            id: 'resp_fixture',
            status: 'completed',
            output: [],
            usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
          },
        });
        responseStream.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('local fixture did not expose a TCP port');
    }

    try {
      const result = await Effect.runPromise(
        runUpstreamGenerate({
          providerType: 'openai',
          upstreamProtocol: 'responses',
          apiKey: 'fixture-key',
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          allowInsecureLocalhost: true,
          model: 'fixture-model',
          messages: [OpenCodeLLM.Message.user('ping')],
          maxOutputTokens: 17,
        }),
      );

      expect(result.text).toBe('fixture-ok');
      expect(result.inputTokens).toBe(2);
      expect(result.outputTokens).toBe(3);
      expect(requestBody).toContain('"max_output_tokens":17');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
