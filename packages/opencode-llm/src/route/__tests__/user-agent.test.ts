import { Effect } from 'effect';
import rootPackageJson from '../../../../../package.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { HttpOptions, Message, LLMRequest } from '../../schema/index.js';
import * as OpenAIChat from '../../protocols/openai-chat.js';
import * as OpenAIResponses from '../../protocols/openai-responses.js';
import { Auth } from '../auth.js';
import { OPENAWORK_USER_AGENT } from '../transport/http.js';
import * as OpenAI from '../../providers/openai.js';

describe('上游请求标识', () => {
  it('在调用方传入 User-Agent 时，HTTP 请求仍使用固定 OpenAWork 标识', async () => {
    // Given：调用方配置了自己的 User-Agent。
    const model = OpenAI.configure({ auth: Auth.none }).chat('gpt-test');
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
      http: new HttpOptions({ headers: { 'User-Agent': 'caller-agent' } }),
    });
    const body = await Effect.runPromise(OpenAIChat.protocol.body.from(request));

    // When：路由准备 HTTP 上游请求。
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    // Then：请求始终携带固定的产品标识。
    expect(prepared.request.headers['user-agent']).toBe(OPENAWORK_USER_AGENT);
  });

  it('在认证模块传入 User-Agent 时，HTTP 请求仍使用固定 OpenAWork 标识', async () => {
    // Given：认证模块写入了自己的 User-Agent。
    const model = OpenAI.configure({ auth: Auth.headers({ 'User-Agent': 'auth-agent' }) }).chat(
      'gpt-test',
    );
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });
    const body = await Effect.runPromise(OpenAIChat.protocol.body.from(request));

    // When：路由准备 HTTP 上游请求。
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    // Then：认证模块也不能覆盖固定产品标识。
    expect(prepared.request.headers['user-agent']).toBe(OPENAWORK_USER_AGENT);
  });

  it('为 Responses WebSocket 请求使用固定 OpenAWork 标识', async () => {
    // Given：一个 Responses WebSocket 路由请求。
    const model = OpenAIResponses.webSocketRoute
      .with({ auth: Auth.headers({ 'User-Agent': 'auth-agent' }) })
      .model({ id: 'gpt-test' });
    const request = new LLMRequest({
      model,
      system: [],
      messages: [Message.user('hello')],
      tools: [],
    });
    const body = await Effect.runPromise(OpenAIResponses.protocol.body.from(request));

    // When：路由准备 WebSocket 上游请求。
    const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));

    // Then：WebSocket 握手头也使用相同的产品标识。
    expect(prepared.headers['user-agent']).toBe(OPENAWORK_USER_AGENT);
  });

  it('使用应用版本、系统类型、系统版本和架构组成 User-Agent', () => {
    expect(OPENAWORK_USER_AGENT).toContain(`OpenAWork/${rootPackageJson.version} `);
    expect(OPENAWORK_USER_AGENT).toMatch(
      /^OpenAWork\/\d+\.\d+\.\d+ \([A-Za-z]+ [^;]+; (x86|x64|arm|arm64|ppc|ppc64|riscv64|s390x|x32)\)$/,
    );
  });
});
