import { describe, expect, it } from 'vitest';
import type { AIModelConfigItem, AIProviderRef } from '@openAwork/shared-ui';
import {
  addProviderModels,
  batchUpdateProviderModels,
  removeProvider,
} from './provider-model-mutations.js';

function makeProvider(id: string, type = 'custom'): AIProviderRef {
  return {
    id,
    type,
    name: id,
    enabled: true,
    defaultModels: [],
  };
}

describe('removeProvider', () => {
  it('removes the matching provider by id', () => {
    const providers = [makeProvider('first'), makeProvider('target'), makeProvider('last')];

    expect(removeProvider(providers, 'target')).toEqual([providers[0], providers[2]]);
  });

  it('returns an equal-length list with the same members for an unknown id', () => {
    const providers = [makeProvider('first'), makeProvider('second')];

    expect(removeProvider(providers, 'unknown')).toEqual(providers);
  });

  it('preserves other providers and does not mutate the original array', () => {
    const first = makeProvider('first');
    const target = makeProvider('target');
    const last = makeProvider('last');
    const providers = [first, target, last];

    const result = removeProvider(providers, 'target');

    expect(result).not.toBe(providers);
    expect(result).toEqual([first, last]);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(last);
    expect(providers).toEqual([first, target, last]);
  });
});

function buildProviderWithModels(defaultModels: AIModelConfigItem[]): AIProviderRef {
  return {
    id: 'relay',
    type: 'custom',
    name: 'Relay',
    enabled: true,
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
    defaultModels,
  };
}

describe('addProviderModels', () => {
  it('新模型直接追加,并带入本地迁移的上下文与能力', () => {
    const providers = [buildProviderWithModels([])];
    const incoming: AIModelConfigItem[] = [
      {
        id: 'gpt-4o',
        label: 'gpt-4o',
        enabled: true,
        contextWindow: 128_000,
        supportsTools: true,
        supportsVision: true,
      },
    ];

    const next = addProviderModels(providers, 'relay', incoming);

    expect(next[0]?.defaultModels).toEqual(incoming);
  });

  it('已存在的模型只补齐缺失字段,不覆盖已有取值与 enabled', () => {
    const providers = [
      buildProviderWithModels([
        { id: 'gpt-4o', label: 'GPT-4o', enabled: false, supportsTools: true },
      ]),
    ];
    const incoming: AIModelConfigItem[] = [
      {
        id: 'gpt-4o',
        label: 'gpt-4o',
        enabled: true,
        contextWindow: 128_000,
        supportsTools: false,
        supportsVision: true,
      },
    ];

    const next = addProviderModels(providers, 'relay', incoming);
    const model = next[0]?.defaultModels[0];

    expect(next[0]?.defaultModels).toHaveLength(1);
    // 缺失的补齐
    expect(model?.contextWindow).toBe(128_000);
    expect(model?.supportsVision).toBe(true);
    // 已有的保留(不被覆盖)
    expect(model?.supportsTools).toBe(true);
    expect(model?.enabled).toBe(false);
    expect(model?.label).toBe('GPT-4o');
  });

  it('无任何变化时保持 provider 引用不变', () => {
    const providers = [
      buildProviderWithModels([
        { id: 'gpt-4o', label: 'GPT-4o', enabled: true, contextWindow: 128_000 },
      ]),
    ];

    const next = addProviderModels(providers, 'relay', [
      { id: 'gpt-4o', label: 'gpt-4o', enabled: true, contextWindow: 128_000 },
    ]);

    expect(next[0]).toBe(providers[0]);
  });

  it('大小写不同视为同一模型:不重复添加、补齐缺失字段并保留原 id', () => {
    const providers = [buildProviderWithModels([{ id: 'GPT-4o', label: 'GPT-4o', enabled: true }])];
    const incoming: AIModelConfigItem[] = [
      {
        id: 'gpt-4o',
        label: 'gpt-4o',
        enabled: true,
        contextWindow: 128_000,
        supportsTools: true,
      },
    ];

    const next = addProviderModels(providers, 'relay', incoming);
    const models = next[0]?.defaultModels ?? [];

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('GPT-4o');
    expect(models[0]?.contextWindow).toBe(128_000);
    expect(models[0]?.supportsTools).toBe(true);
  });

  it('不修改其它 provider', () => {
    const other = buildProviderWithModels([]);
    other.id = 'other';
    const providers = [buildProviderWithModels([]), other];

    const next = addProviderModels(providers, 'relay', [
      { id: 'gpt-4o', label: 'gpt-4o', enabled: true },
    ]);

    expect(next[1]).toBe(other);
  });
});

describe('batchUpdateProviderModels', () => {
  it('一次批量更新多个模型的 reasoningOptions', () => {
    const providers = [
      buildProviderWithModels([
        { id: 'm1', label: 'M1', enabled: true },
        { id: 'm2', label: 'M2', enabled: true },
        { id: 'm3', label: 'M3', enabled: true },
      ]),
    ];

    const next = batchUpdateProviderModels(providers, 'relay', [
      {
        modelId: 'm1',
        updates: { reasoningOptions: [{ type: 'effort', values: ['low', 'high'] }] },
      },
      { modelId: 'm2', updates: { supportsThinking: true } },
    ]);

    expect(next[0]?.defaultModels?.[0]?.reasoningOptions).toEqual([
      { type: 'effort', values: ['low', 'high'] },
    ]);
    expect(next[0]?.defaultModels?.[1]?.supportsThinking).toBe(true);
    // 未包含在批量更新里的模型保持原引用。
    expect(next[0]?.defaultModels?.[2]).toBe(providers[0]?.defaultModels?.[2]);
  });

  it('按大小写不敏感匹配 modelId', () => {
    const providers = [buildProviderWithModels([{ id: 'GPT-4o', label: 'GPT-4o', enabled: true }])];

    const next = batchUpdateProviderModels(providers, 'relay', [
      { modelId: 'gpt-4o', updates: { supportsThinking: true } },
    ]);

    expect(next[0]?.defaultModels?.[0]?.supportsThinking).toBe(true);
  });

  it('未命中任何模型时保持 provider 引用不变', () => {
    const providers = [buildProviderWithModels([{ id: 'm1', label: 'M1', enabled: true }])];

    const next = batchUpdateProviderModels(providers, 'relay', [
      { modelId: 'nope', updates: { supportsThinking: true } },
    ]);

    expect(next[0]).toBe(providers[0]);
  });

  it('不影响其它 provider', () => {
    const other = buildProviderWithModels([{ id: 'x', label: 'X', enabled: true }]);
    other.id = 'other';
    const providers = [buildProviderWithModels([{ id: 'm1', label: 'M1', enabled: true }]), other];

    const next = batchUpdateProviderModels(providers, 'relay', [
      { modelId: 'm1', updates: { supportsThinking: true } },
    ]);

    expect(next[1]).toBe(other);
  });
});
