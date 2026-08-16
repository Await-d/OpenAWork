import { FetchHttpClient, Headers, HttpClientRequest } from 'effect/unstable/http';
import { Effect } from 'effect';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { LLMError } from '../../schema/index.js';
import { WebSocketExecutor } from '../transport/websocket.js';
import { RequestExecutor } from '../executor.js';
import * as OpenAI from '../../providers/openai.js';
import * as AmazonBedrock from '../../providers/amazon-bedrock.js';
import * as Anthropic from '../../providers/anthropic.js';
import * as Azure from '../../providers/azure.js';
import { CloudflareAIGateway, CloudflareWorkersAI } from '../../providers/cloudflare.js';
import * as GitHubCopilot from '../../providers/github-copilot.js';
import * as Google from '../../providers/google.js';
import * as OpenAICompatible from '../../providers/openai-compatible.js';
import * as OpenRouter from '../../providers/openrouter.js';
import * as XAI from '../../providers/xai.js';
import { ProviderConfigSchema } from '../../provider/types.js';
import { HttpConfigSchema } from '../../types/provider.js';

describe('transport security boundaries', () => {
  it('does not expose query credentials in WebSocket transport errors', async () => {
    class FailingWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      constructor(url: string) {
        throw new Error(`connect failed for ${url}`);
      }
    }

    vi.stubGlobal('WebSocket', FailingWebSocket);

    try {
      await expect(
        Effect.runPromise(
          WebSocketExecutor.open({
            url: 'wss://provider.example/v1?api_key=transport-secret&sig=signature-secret&token=token-secret&apiKey=api-key-secret',
            headers: Headers.fromInput({}),
          }),
        ),
      ).rejects.toSatisfy((error: unknown) => {
        if (!(error instanceof LLMError) || error.reason._tag !== 'Transport') return false;
        const text = `${error.message} ${error.reason.message} ${error.reason.url ?? ''}`;
        return (
          !text.includes('transport-secret') &&
          !text.includes('signature-secret') &&
          !text.includes('token-secret') &&
          !text.includes('api-key-secret') &&
          !text.includes('api_key=transport-secret') &&
          !text.includes('sig=signature-secret') &&
          !text.includes('token=token-secret') &&
          !text.includes('apiKey=api-key-secret')
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'http://127.0.0.1:8080/v1',
    'https://localhost/v1',
    'http://[::1]/v1',
    'http://[0:0:0:0:0:0:0:1]/v1',
    'http://[::ffff:127.0.0.1]/v1',
    'https://[fd00::1]/v1',
    'http://192.168.1.10/v1',
    'http://10.0.0.10/v1',
    'http://172.16.0.10/v1',
    'http://169.254.169.254/latest',
    'http://[fe80::1]/v1',
    'http://100.100.100.200/latest',
    'http://metadata.google.internal/v1',
  ])('rejects unsafe provider baseURL %s', (baseURL) => {
    expect(() =>
      OpenAI.configure({ apiKey: 'fixture-key', baseURL }).model('fixture-model'),
    ).toThrow(/受限制的本地或内网地址/);
  });

  it('allows a public HTTPS proxy with the provider API prefix', () => {
    const baseURL = 'https://proxy.example.com/v1';
    const model = OpenAI.configure({ apiKey: 'fixture-key', baseURL }).model('fixture-model');

    expect(model.route.endpoint.baseURL).toBe(baseURL);
  });

  it('rejects unsafe legacy provider configuration before model creation', () => {
    expect(() =>
      ProviderConfigSchema.parse({
        apiKey: 'sk-fixture-key',
        baseUrl: 'https://localhost/v1',
      }),
    ).toThrow(/受限制的本地或内网地址/);
  });

  it('rejects unsafe generic provider HTTP configuration', () => {
    expect(() => HttpConfigSchema.parse({ baseURL: 'https://[::1]/v1' })).toThrow(
      /受限制的本地或内网地址/,
    );
  });

  it('allows an explicitly opted-in loopback fixture without allowing RFC1918 hosts', () => {
    const baseURL = 'http://127.0.0.1:8080/v1';
    const model = OpenAI.configure({
      apiKey: 'fixture-key',
      baseURL,
      allowInsecureLocalhost: true,
    }).model('fixture-model');

    expect(model.route.endpoint.baseURL).toBe(baseURL);
    expect(() =>
      OpenAI.configure({
        apiKey: 'fixture-key',
        baseURL: 'http://192.168.1.10/v1',
        allowInsecureLocalhost: true,
      }),
    ).toThrow(/受限制的本地或内网地址/);
  });

  it.each([
    () => Anthropic.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => Google.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => AmazonBedrock.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => Azure.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => CloudflareAIGateway.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => CloudflareWorkersAI.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => GitHubCopilot.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () =>
      OpenAICompatible.configure({
        apiKey: 'fixture-key',
        baseURL: 'https://localhost/v1',
      }),
    () => OpenRouter.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
    () => XAI.configure({ apiKey: 'fixture-key', baseURL: 'https://localhost/v1' }),
  ])('rejects unsafe provider route baseURL during configuration', (configure) => {
    expect(configure).toThrow(/受限制的本地或内网地址/);
  });

  it('disables fetch redirects for provider requests', async () => {
    let redirect: RequestRedirect | undefined;
    vi.stubGlobal('fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response(null, { status: 204 });
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service;
          yield* executor.execute(HttpClientRequest.get('https://provider.example/v1'));
        }).pipe(Effect.provide(RequestExecutor.fetchLayer)),
      );
      expect(redirect).toBe('error');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not follow redirects from a provider request', async () => {
    let redirectRequestCount = 0;
    let privateRequestCount = 0;
    const server = createServer((request, response) => {
      if (request.url === '/private') {
        privateRequestCount += 1;
        response.end();
        return;
      }
      redirectRequestCount += 1;
      response.writeHead(302, { location: '/private' });
      response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP test server');

    try {
      const request = HttpClientRequest.get(`http://127.0.0.1:${address.port}/redirect`);
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service;
          yield* executor.execute(request);
        }).pipe(
          Effect.provide(RequestExecutor.fetchLayer),
          Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
        ),
      );
      expect(result._tag).toBe('Failure');
      expect(redirectRequestCount).toBe(1);
      expect(privateRequestCount).toBe(0);
    } finally {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });
});
