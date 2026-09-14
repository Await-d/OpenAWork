import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runUpstreamGenerate } from '../../v2-runtime/upstream/run-upstream-generate.js';

/**
 * 线路级验收：证明 `x-opencode-session` 不只是纯函数返回值，而是真的出现在
 * 出站 HTTP 请求头上，并且三种上游协议都覆盖到了。用本地 mock 上游捕获请求头。
 */
const SESSION_HEADER = 'x-opencode-session';

interface RecordedRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

const recorded: RecordedRequest[] = [];

const responseBodyFor = (path: string): string => {
  if (path.includes('/messages')) {
    return JSON.stringify({
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      model: 'mock',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  if (path.includes('/responses')) {
    return JSON.stringify({
      id: 'resp-1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'mock',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  }
  return JSON.stringify({
    id: 'chat-1',
    object: 'chat.completion',
    created: 1,
    model: 'mock',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};

let server: Server;
let baseURL: string;

beforeAll(async () => {
  process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
  server = createServer((req, res) => {
    const url = req.url ?? '';
    req.on('data', () => undefined);
    req.on('end', () => {
      recorded.push({ path: url, headers: { ...req.headers } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(responseBodyFor(url));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/zen/go/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  recorded.length = 0;
});

const generate = async (options: {
  providerType: string;
  protocol: 'chat_completions' | 'responses' | 'anthropic_messages';
  sessionId?: string;
  baseURL?: string;
}): Promise<RecordedRequest | undefined> => {
  try {
    await Effect.runPromise(
      runUpstreamGenerate({
        providerType: options.providerType,
        baseURL: options.baseURL ?? baseURL,
        apiKey: 'test-key',
        model: 'deepseek-v4.1-flash',
        upstreamProtocol: options.protocol,
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 16,
        timeoutMs: 5_000,
      }),
    );
  } catch {
    // mock 上游的响应体解析可能失败——本用例只断言「请求头」，不影响结论。
  }
  return recorded[recorded.length - 1];
};

const sessionHeaderOf = (request: RecordedRequest | undefined): string | undefined => {
  const value = request?.headers[SESSION_HEADER];
  return typeof value === 'string' ? value : undefined;
};

describe('x-opencode-session 线路级注入', () => {
  it.each([
    ['chat_completions', 'chat_completions', '/chat/completions'],
    ['responses', 'responses', '/responses'],
    ['anthropic_messages', 'anthropic_messages', '/messages'],
  ] as const)('协议 %s 的请求确实带上会话头', async (_label, protocol, pathSuffix) => {
    const request = await generate({
      providerType: 'opencode-go',
      protocol,
      sessionId: 'session-abc',
    });

    expect(request?.path).toContain(pathSuffix);
    expect(sessionHeaderOf(request)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('同一会话跨调用取值稳定', async () => {
    const first = await generate({
      providerType: 'opencode-go',
      protocol: 'chat_completions',
      sessionId: 'session-abc',
    });
    const second = await generate({
      providerType: 'opencode-go',
      protocol: 'chat_completions',
      sessionId: 'session-abc',
    });

    expect(sessionHeaderOf(first)).toBeDefined();
    expect(sessionHeaderOf(second)).toBe(sessionHeaderOf(first));
  });

  it('不同会话取值不同', async () => {
    const a = await generate({
      providerType: 'opencode-go',
      protocol: 'chat_completions',
      sessionId: 'session-aaa',
    });
    const b = await generate({
      providerType: 'opencode-go',
      protocol: 'chat_completions',
      sessionId: 'session-bbb',
    });

    expect(sessionHeaderOf(a)).not.toBe(sessionHeaderOf(b));
  });

  it('不把原始会话 ID 泄漏到头上', async () => {
    const request = await generate({
      providerType: 'opencode-go',
      protocol: 'chat_completions',
      sessionId: 'session-abc',
    });

    expect(sessionHeaderOf(request)).not.toContain('session-abc');
  });

  it('缺少 sessionId 时不注入（不退化成随机值）', async () => {
    const request = await generate({ providerType: 'opencode-go', protocol: 'chat_completions' });

    expect(sessionHeaderOf(request)).toBeUndefined();
  });

  it.each(['deepseek', 'custom'])('非 OpenCode 平台 %s 不注入该头', async (providerType) => {
    const request = await generate({
      providerType,
      protocol: 'chat_completions',
      sessionId: 'session-abc',
    });

    expect(sessionHeaderOf(request)).toBeUndefined();
  });
});
