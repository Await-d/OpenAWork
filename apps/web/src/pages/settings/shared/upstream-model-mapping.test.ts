import { describe, expect, it } from 'vitest';
import type { AIProviderRef } from '@openAwork/shared-ui';
import {
  applyLocalMetadataFallback,
  buildLocalMetadataIndex,
  toUpstreamItems,
  toUpstreamModelConfigs,
} from './upstream-model-mapping.js';

describe('toUpstreamItems', () => {
  it('保留网关迁移来的 meta(上下文 / 能力 / 价格)', () => {
    const items = toUpstreamItems([
      {
        id: 'gpt-4o',
        label: 'gpt-4o',
        ownedBy: 'openai',
        meta: {
          contextWindow: 128_000,
          maxOutputTokens: 16_384,
          inputPricePerMillion: 2.5,
          supportsTools: true,
          supportsVision: true,
          reasoningOptions: [{ type: 'effort', values: ['low', 'high'] }],
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.meta?.contextWindow).toBe(128_000);
    expect(items[0]?.meta?.supportsTools).toBe(true);
    expect(items[0]?.meta?.reasoningOptions).toEqual([{ type: 'effort', values: ['low', 'high'] }]);
  });

  it('丢弃非法字段,meta 全空时不写入', () => {
    const items = toUpstreamItems([
      { id: 'm1', label: 'M1', meta: { contextWindow: 'big', supportsTools: 'yes' } },
      { id: '', label: 'invalid' },
      { id: 'm2' },
    ]);

    expect(items.map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(items[0]?.meta).toBeUndefined();
    expect(items[1]?.label).toBe('m2');
  });
});

describe('toUpstreamModelConfigs', () => {
  it('把 meta 铺平进模型配置并默认启用', () => {
    const configs = toUpstreamModelConfigs([
      {
        id: 'gpt-4o',
        label: 'gpt-4o',
        meta: { contextWindow: 128_000, supportsVision: true },
      },
      { id: 'plain', label: 'plain' },
    ]);

    expect(configs[0]).toEqual({
      id: 'gpt-4o',
      label: 'gpt-4o',
      enabled: true,
      contextWindow: 128_000,
      supportsVision: true,
    });
    expect(configs[1]).toEqual({ id: 'plain', label: 'plain', enabled: true });
  });
});

function buildProvider(id: string, models: AIProviderRef['defaultModels']): AIProviderRef {
  return {
    id,
    type: 'custom',
    name: id,
    enabled: true,
    baseUrl: 'https://x.example.com/v1',
    defaultModels: models,
  };
}

describe('buildLocalMetadataIndex / applyLocalMetadataFallback', () => {
  it('优先取目标接口自身的配置,其次取其它接口', () => {
    const target = buildProvider('relay', [
      { id: 'gpt-4o', label: 'GPT-4o', enabled: true, contextWindow: 64_000 },
    ]);
    const other = buildProvider('openai', [
      { id: 'gpt-4o', label: 'GPT-4o', enabled: true, contextWindow: 128_000 },
      { id: 'o3', label: 'o3', enabled: true, contextWindow: 200_000 },
    ]);

    const index = buildLocalMetadataIndex([other, target], 'relay');

    expect(index.get('gpt-4o')?.contextWindow).toBe(64_000);
    expect(index.get('o3')?.contextWindow).toBe(200_000);
  });

  it('为上游裸 id 补齐 meta,且不覆盖上游已给的字段', () => {
    const provider = buildProvider('openai', [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        enabled: true,
        contextWindow: 128_000,
        supportsTools: true,
      },
    ]);
    const index = buildLocalMetadataIndex([provider], 'openai');

    const filled = applyLocalMetadataFallback(
      [
        { id: 'gpt-4o', label: 'gpt-4o' },
        { id: 'gpt-4o', label: 'gpt-4o', meta: { contextWindow: 1 } },
        { id: 'unknown', label: 'unknown' },
      ],
      index,
    );

    expect(filled[0]?.meta).toEqual({ contextWindow: 128_000, supportsTools: true });
    // 上游已给的 contextWindow 保留,只补它没有的 supportsTools
    expect(filled[1]?.meta).toEqual({ contextWindow: 1, supportsTools: true });
    expect(filled[2]?.meta).toBeUndefined();
  });

  it('大小写不同也视为同名(上游 GPT-4o ↔ 本地 gpt-4o)', () => {
    const provider = buildProvider('openai', [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        enabled: true,
        contextWindow: 128_000,
        supportsTools: true,
      },
    ]);
    const index = buildLocalMetadataIndex([provider], 'openai');

    const filled = applyLocalMetadataFallback([{ id: 'GPT-4o', label: 'GPT-4o' }], index);

    expect(filled[0]?.meta?.contextWindow).toBe(128_000);
    expect(filled[0]?.meta?.supportsTools).toBe(true);
    // 展示用 id 保持原始大小写
    expect(filled[0]?.id).toBe('GPT-4o');
  });

  it('首尾空白差异也视为同名', () => {
    const provider = buildProvider('relay', [
      { id: 'gpt-4o', label: 'GPT-4o', enabled: true, contextWindow: 64_000 },
    ]);
    const index = buildLocalMetadataIndex([provider], 'relay');

    const filled = applyLocalMetadataFallback([{ id: '  gpt-4o  ', label: 'GPT-4o' }], index);

    expect(filled[0]?.meta?.contextWindow).toBe(64_000);
  });
});
