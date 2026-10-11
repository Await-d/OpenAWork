import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';

process.env['JWT_SECRET'] = 'upstream-models-test-secret-1234567890';

// 仅 mock 全局 fetch;路由解析(apiKey/baseUrl/协议/headers)走真实实现,
// 以验证「拉取上游 /models」的端到端归类与请求拼装。
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { fetchUpstreamModels, buildLocalModelMetadataIndex, enrichUpstreamModels } =
  await import('../../provider/upstream-models.js');

function buildProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  const now = new Date().toISOString();
  return {
    id: 'relay',
    type: 'custom',
    name: 'Relay',
    enabled: true,
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
    defaultModels: [{ id: 'any-model', label: 'Any', enabled: true }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('fetchUpstreamModels', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('OpenAI 兼容上游成功 → 映射模型清单,并带 Bearer 鉴权', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'gpt-4o', owned_by: 'openai' },
          { id: 'gpt-4o-mini', owned_by: 'openai' },
          { id: 'my-alias', name: 'My Alias' },
        ],
      }),
    );

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini', 'my-alias']);
    expect(result.models[0]?.ownedBy).toBe('openai');
    expect(result.models[2]?.label).toBe('My Alias');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.example.com/v1/models');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('Anthropic 协议 → 使用 x-api-key + anthropic-version', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ id: 'claude-3-7-sonnet', display_name: 'Claude 3.7 Sonnet' }] }),
    );

    const result = await fetchUpstreamModels({
      provider: buildProvider({
        type: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        upstreamProtocol: 'anthropic_messages',
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.models[0]?.label).toBe('Claude 3.7 Sonnet');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('缺少 API Key → auth_error,且不发起请求', async () => {
    const result = await fetchUpstreamModels({
      provider: buildProvider({ apiKey: undefined, apiKeyEnv: undefined }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('auth_error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 → auth_error', async () => {
    fetchMock.mockResolvedValue(textResponse('unauthorized', 401));

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('auth_error');
  });

  it('404 → not_found,并提示 /models 端点缺失', async () => {
    fetchMock.mockResolvedValue(textResponse('Not Found', 404));

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('not_found');
    expect(result.message).toContain('/models');
  });

  it('429 → rate_limited', async () => {
    fetchMock.mockResolvedValue(textResponse('slow down', 429));

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('rate_limited');
  });

  it('网络异常 → error,并提示无法连接', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toContain('无法连接上游');
  });

  it('上游同时返回大小写不同的同一 id → 只保留一个', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ id: 'gpt-4o' }, { id: 'GPT-4o' }, { id: 'gpt-4o' }] }),
    );

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.models.map((model) => model.id)).toEqual(['gpt-4o']);
  });

  it('上游返回空列表 → ok,但提示为空', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const result = await fetchUpstreamModels({ provider: buildProvider() });

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([]);
    expect(result.message).toContain('为空');
  });
});

describe('buildLocalModelMetadataIndex / enrichUpstreamModels', () => {
  function buildCatalogProvider(id: string, models: AIProvider['defaultModels']): AIProvider {
    const now = new Date().toISOString();
    return {
      id,
      type: 'custom',
      name: id,
      enabled: true,
      baseUrl: 'https://x.example.com/v1',
      defaultModels: models,
      createdAt: now,
      updatedAt: now,
    };
  }

  it('用本地同名模型的上下文 / 能力补齐上游裸 id', () => {
    const userProviders = [
      buildCatalogProvider('relay', [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          enabled: true,
          contextWindow: 128_000,
          supportsTools: true,
          supportsVision: true,
        },
      ]),
    ];
    const catalog = [
      buildCatalogProvider('builtin', [
        { id: 'claude-3-7-sonnet', label: 'Claude', enabled: true, contextWindow: 200_000 },
      ]),
    ];

    const index = buildLocalModelMetadataIndex([userProviders, catalog]);
    const enriched = enrichUpstreamModels(
      [
        { id: 'gpt-4o', label: 'gpt-4o' },
        { id: 'claude-3-7-sonnet', label: 'claude-3-7-sonnet' },
        { id: 'unknown-model', label: 'unknown-model' },
      ],
      index,
    );

    expect(enriched[0]?.meta?.contextWindow).toBe(128_000);
    expect(enriched[0]?.meta?.supportsTools).toBe(true);
    expect(enriched[1]?.meta?.contextWindow).toBe(200_000);
    expect(enriched[2]?.meta).toBeUndefined();
  });

  it('大小写不同的同名模型也能匹配(上游 GPT-4o ↔ 本地 gpt-4o)', () => {
    const userProviders = [
      buildCatalogProvider('relay', [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          enabled: true,
          contextWindow: 128_000,
          supportsTools: true,
        },
      ]),
    ];

    const index = buildLocalModelMetadataIndex([userProviders]);
    const enriched = enrichUpstreamModels([{ id: 'GPT-4o', label: 'GPT-4o' }], index);

    expect(enriched[0]?.meta?.contextWindow).toBe(128_000);
    expect(enriched[0]?.meta?.supportsTools).toBe(true);
    // 原始 id 保留(不被归一化改写)
    expect(enriched[0]?.id).toBe('GPT-4o');
  });

  it('用户配置优先于内置目录,且仅覆盖已定义字段', () => {
    const userProviders = [
      buildCatalogProvider('relay', [
        { id: 'gpt-4o', label: 'GPT-4o', enabled: true, contextWindow: 64_000 },
      ]),
    ];
    const catalog = [
      buildCatalogProvider('builtin', [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          enabled: true,
          contextWindow: 128_000,
          supportsVision: true,
        },
      ]),
    ];

    const index = buildLocalModelMetadataIndex([userProviders, catalog]);
    const meta = index.get('gpt-4o');

    // 用户显式配置的上下文优先,内置的 supportsVision 仍可补齐。
    expect(meta?.contextWindow).toBe(64_000);
    expect(meta?.supportsVision).toBe(true);
  });
});
