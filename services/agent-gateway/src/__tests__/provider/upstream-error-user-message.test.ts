/**
 * `describeUpstreamErrorForUser` —— 上游错误 → 用户可读中文说明。
 *
 * fixture 刻意复刻生产里 `LLM.Error` 的真实形态（`reason._tag` / `reason.kind` /
 * `reason.http.response.status` + `RequestExecutor.execute: …` 前缀的 message），
 * 因为这条链路此前只把原始错误写进 console.warn，用户只能看到「请稍后重试」。
 */

import { describe, expect, it } from 'vitest';
import { describeUpstreamErrorForUser } from '../../provider/retry-classify.js';

function llmError(input: {
  tag: string;
  kind?: string;
  status?: number;
  detail?: string;
  retryable?: boolean;
}): Error {
  const detail = input.detail === undefined ? '' : input.detail;
  const message =
    input.status === undefined
      ? `RequestExecutor.execute: ${detail.length > 0 ? detail : input.tag}`
      : `RequestExecutor.execute: Provider request failed with HTTP ${input.status}${detail.length > 0 ? `: ${detail}` : ''}`;
  return Object.assign(new Error(message), {
    reason: {
      _tag: input.tag,
      message,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.status !== undefined ? { http: { response: { status: input.status } } } : {}),
    },
    ...(input.retryable !== undefined ? { retryable: input.retryable } : {}),
  });
}

const RELAY_403_DETAIL =
  '全局密钥已绑定 14 个节点，存在可支持模型 qwen3.8-flash 的有效订单，但对应节点上游配置不可用（分组/账号不可用或缺少密钥）。请在个人中心检查节点上游配置';

describe('describeUpstreamErrorForUser · 403 权限/节点不可用', () => {
  const description = describeUpstreamErrorForUser(
    llmError({
      tag: 'Authentication',
      kind: 'insufficient-permissions',
      status: 403,
      detail: RELAY_403_DETAIL,
      retryable: false,
    }),
  );

  it('把上游原话带给用户，并去掉 SDK 包装前缀', () => {
    expect(description.message).toContain(RELAY_403_DETAIL);
    expect(description.message).not.toContain('RequestExecutor.execute');
    expect(description.message).not.toContain('Provider request failed with HTTP');
  });

  it('明确指出是权限/配置类问题，且重试无效', () => {
    expect(description.status).toBe(403);
    expect(description.retryable).toBe(false);
    expect(description.message).toContain('403');
    expect(description.message).toContain('设置 → 提供商');
    expect(description.message).not.toContain('稍后重试');
  });
});

describe('describeUpstreamErrorForUser · 其它类别', () => {
  it('401 提示重新配置 API Key 且重试无效', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'Authentication', kind: 'invalid', status: 401, retryable: false }),
    );

    expect(description.status).toBe(401);
    expect(description.retryable).toBe(false);
    expect(description.message).toContain('401');
    expect(description.message).toContain('API Key');
  });

  it('429 限流保留「稍后重试」并标记可重试', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'RateLimit', status: 429, retryable: true }),
    );

    expect(description.status).toBe(429);
    expect(description.retryable).toBe(true);
    expect(description.message).toContain('稍后重试');
  });

  it('配额用尽不提示重试', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'QuotaExceeded', retryable: false }),
    );

    expect(description.retryable).toBe(false);
    expect(description.message).toContain('额度');
    expect(description.message).not.toContain('稍后重试');
  });

  it('5xx 归类为瞬时故障、可重试', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'ProviderInternal', status: 503, retryable: true }),
    );

    expect(description.status).toBe(503);
    expect(description.retryable).toBe(true);
    expect(description.message).toContain('503');
    expect(description.message).toContain('稍后重试');
  });

  it('Transport 归类为连接失败', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'Transport', detail: 'fetch failed', retryable: true }),
    );

    expect(description.retryable).toBe(true);
    expect(description.message).toContain('连接');
  });

  it('非 LLM.Error 的裸错误不抛异常，回落到通用说明', () => {
    const description = describeUpstreamErrorForUser(new Error('something blew up'));

    expect(description.category).toBe('unknown');
    expect(description.retryable).toBe(false);
    expect(description.message).toContain('something blew up');
  });

  it('字符串错误同样可用', () => {
    expect(() => describeUpstreamErrorForUser('boom')).not.toThrow();
  });
});

describe('describeUpstreamErrorForUser · 上游原话处理', () => {
  it('没有上游原话时不渲染「上游返回」行', () => {
    const description = describeUpstreamErrorForUser(
      llmError({ tag: 'ProviderInternal', status: 500, retryable: true }),
    );

    expect(description.message).not.toContain('**上游返回**');
  });

  it('超长上游原话被截断', () => {
    const description = describeUpstreamErrorForUser(
      llmError({
        tag: 'Authentication',
        kind: 'insufficient-permissions',
        status: 403,
        detail: 'x'.repeat(1_000),
        retryable: false,
      }),
    );

    expect(description.message).toContain('…');
    expect(description.message.length).toBeLessThan(600);
  });
});
