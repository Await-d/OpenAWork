import { Effect } from 'effect';
import { FetchHttpClient, HttpClientRequest } from 'effect/http';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { LLMError } from '../../schema/index.js';
import { providerErrorText } from '../../provider-error.js';
import { RequestExecutor } from '../executor.js';

const ESCAPED_GATEWAY_BODY = String.raw`{"error":{"message":"\u5168\u5C40\u5BC6\u94A5\u5DF2\u7ED1\u5B9A 1 \u4E2A\u8282\u70B9\uFF0C\u4F46\u6CA1\u6709\u4EFB\u4F55\u8282\u70B9\u652F\u6301\u6A21\u578B gpt-5.6-sol\u3002\u8BF7\u5728\u4E2A\u4EBA\u4E2D\u5FC3\u68C0\u67E5\u8282\u70B9\u7684\u6A21\u578B\u6743\u9650\u914D\u7F6E","type":"modelnotallowed","code":"ModelNotAllowed"}}`;

const DECODED =
  '全局密钥已绑定 1 个节点，但没有任何节点支持模型 gpt-5.6-sol。请在个人中心检查节点的模型权限配置';

describe('providerErrorText 解析上游错误体', () => {
  it('提取 OpenAI 风格 error.message 并解码 \\uXXXX', () => {
    const text = providerErrorText(ESCAPED_GATEWAY_BODY);
    expect(text).toBe(DECODED);
    expect(text).not.toContain('\\u');
  });

  it('支持 error 为字符串', () => {
    expect(providerErrorText('{"error":"\\u4F60\\u597D"}')).toBe('你好');
  });

  it('支持顶层 message', () => {
    expect(providerErrorText('{"message":"\\u4F60\\u597D"}')).toBe('你好');
  });

  it('支持 errors 数组中的 message', () => {
    expect(providerErrorText('{"errors":[{"message":"\\u4F60\\u597D"}]}')).toBe('你好');
  });

  it('非 JSON 文本也会解码转义', () => {
    expect(providerErrorText('request failed: \\u4F60\\u597D')).toBe('request failed: 你好');
  });

  it('非法 JSON 回退到原始文本', () => {
    expect(providerErrorText('{not json')).toBe('{not json');
  });

  it('无 message 字段时回退到原始文本', () => {
    expect(providerErrorText('{"code":"ModelNotAllowed"}')).toBe('{"code":"ModelNotAllowed"}');
  });

  it('解码代理对表情', () => {
    expect(providerErrorText('{"error":"\\uD83D\\uDE00"}')).toBe('😀');
  });

  it('空输入返回空串', () => {
    expect(providerErrorText('   ')).toBe('');
  });
});

describe('RequestExecutor 错误消息不再泄露转义序列', () => {
  it('403 响应把上游中文消息解码后写入 LLMError', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(ESCAPED_GATEWAY_BODY);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP test server');

    try {
      const request = HttpClientRequest.get(`http://127.0.0.1:${address.port}/v1/chat`);
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service;
          return yield* executor.execute(request).pipe(Effect.flip);
        }).pipe(
          Effect.provide(RequestExecutor.fetchLayer),
          Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
        ),
      );

      expect(error).toBeInstanceOf(LLMError);
      expect(error.reason.message).toContain('HTTP 403');
      expect(error.reason.message).toContain(DECODED);
      expect(error.reason.message).not.toContain('\\u');
    } finally {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });
});

const errorFor = async (status: number, body: string, contentType = 'text/plain') => {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': contentType });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP test server');

  try {
    const request = HttpClientRequest.get(`http://127.0.0.1:${address.port}/v1/chat`);
    return await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service;
        return yield* executor.execute(request).pipe(Effect.flip);
      }).pipe(
        Effect.provide(RequestExecutor.fetchLayer),
        Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
      ),
    );
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
};

const messageOf = async (status: number, body: string, contentType?: string) => {
  const error = await errorFor(status, body, contentType);
  if (!(error instanceof LLMError)) throw new Error('Expected LLMError');
  return error.reason.message;
};

describe('RequestExecutor 对错误正文的回显策略', () => {
  it('HTML 错误页不回显正文', async () => {
    const message = await messageOf(
      400,
      '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>',
      'text/html',
    );

    expect(message).toBe('Provider request failed with HTTP 400');
  });

  it('无结构信息的明文回显正文，但截断到 2000 字符', async () => {
    const message = await messageOf(400, 'x'.repeat(3000));
    const prefix = 'Provider request failed with HTTP 400: ';

    expect(message.startsWith(prefix)).toBe(true);
    expect(message.length).toBe(prefix.length + 2000);
  });

  it('超过旧上限（500）的明文现在仍会回显', async () => {
    const message = await messageOf(400, 'y'.repeat(600));

    expect(message).toContain('y'.repeat(600));
  });

  it('结构化 message 优先于正文原文', async () => {
    const message = await messageOf(400, '{"error":{"message":"余额不足"}}', 'application/json');

    expect(message).toBe('Provider request failed with HTTP 400: 余额不足');
  });
});
