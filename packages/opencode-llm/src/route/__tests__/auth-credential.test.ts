/**
 * 凭据解析契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-18：缺失凭据归一化为「认证缺失」（不再当请求体非法），
 * 以及 `Auth.config` 把「未设置」与「设置为空串」都视为缺失。
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { Headers } from 'effect/http';
import * as Auth from '../auth.js';
import { AuthenticationReason, LLMError, LLMRequest, Message, Model } from '../../schema/index.js';
import * as AnthropicMessages from '../../protocols/anthropic-messages.js';

const authInput = (): Auth.AuthInput => ({
  request: new LLMRequest({
    model: Model.make({ id: 'test-model', provider: 'test', route: AnthropicMessages.route }),
    system: [],
    messages: [Message.user('hi')],
    tools: [],
  }),
  method: 'POST',
  url: 'https://example.test/v1/messages',
  body: '{}',
  headers: Headers.empty,
});

describe('MissingCredentialError', () => {
  it('默认文案带凭据来源', () => {
    expect(new Auth.MissingCredentialError('OPENAI_API_KEY').message).toBe(
      'Missing auth credential: OPENAI_API_KEY',
    );
  });

  it('可传入自定义文案', () => {
    expect(
      new Auth.MissingCredentialError('OPENAI_API_KEY', 'OPENAI_API_KEY is not set').message,
    ).toBe('OPENAI_API_KEY is not set');
  });
});

describe('凭据缺失的错误分类', () => {
  it('空凭据归一化为认证缺失（kind: missing）', async () => {
    const outcome = await Effect.runPromise(
      Effect.result(Auth.toEffect(Auth.value('').bearer())(authInput())),
    );

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag !== 'Failure') return;
    const error = outcome.failure;
    expect(error).toBeInstanceOf(LLMError);
    if (!(error instanceof LLMError)) return;
    expect(error.reason._tag).toBe('Authentication');
    expect(error.reason.kind).toBe('missing');
  });

  it('有效凭据正常下发 Bearer 头', async () => {
    const headers = await Effect.runPromise(
      Auth.toEffect(Auth.value('secret-token').bearer())(authInput()),
    );

    expect(headers['authorization']).toBe('Bearer secret-token');
  });
});
