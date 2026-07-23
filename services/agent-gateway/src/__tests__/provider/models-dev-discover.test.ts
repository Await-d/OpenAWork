import { describe, expect, it } from 'vitest';
import {
  listDiscoverableProviders,
  buildCustomProviderFromModelsDev,
} from '../../provider/models-dev-discover.js';
import type { ModelsDevData } from '@openAwork/agent-core';

const sample: ModelsDevData = {
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    api: 'https://api.mistral.ai/v1',
    env: ['MISTRAL_API_KEY'],
    models: {
      'mistral-small-latest': { id: 'mistral-small-latest', name: 'Mistral Small' },
    },
  },
  together: {
    id: 'together',
    name: 'Together',
    api: 'https://api.together.xyz/v1',
    env: ['TOGETHER_API_KEY'],
    models: {
      'meta-llama/Llama-3-8b': {
        id: 'meta-llama/Llama-3-8b',
        name: 'Llama 3 8B',
        tool_call: true,
      },
      old: { id: 'old', name: 'Old', status: 'deprecated' },
    },
  },
};

describe('models-dev-discover', () => {
  it('默认排除已是内置 catalog 的 provider', () => {
    const list = listDiscoverableProviders(sample);
    expect(list.find((p) => p.id === 'mistral')).toBeUndefined();
    const together = list.find((p) => p.id === 'together');
    expect(together).toBeDefined();
    expect(together!.modelCount).toBe(1); // deprecated 不计
    expect(together!.sampleModels[0]?.id).toBe('meta-llama/Llama-3-8b');
    expect(together!.alreadyBuiltin).toBe(false);
  });

  it('includeBuiltin 时可看到内置平台', () => {
    const list = listDiscoverableProviders(sample, { includeBuiltin: true });
    const mistral = list.find((p) => p.id === 'mistral');
    expect(mistral).toBeDefined();
    expect(mistral!.alreadyBuiltin).toBe(true);
  });

  it('从 models.dev 构建 custom provider', () => {
    const provider = buildCustomProviderFromModelsDev(sample, 'together');
    expect(provider.type).toBe('custom');
    expect(provider.baseUrl).toContain('together');
    expect(provider.defaultModels.some((m) => m.id === 'meta-llama/Llama-3-8b')).toBe(true);
    expect(provider.defaultModels.some((m) => m.id === 'old')).toBe(false);
    expect(provider.id.startsWith('custom-md-together-')).toBe(true);
  });

  it('未知 id 抛错', () => {
    expect(() => buildCustomProviderFromModelsDev(sample, 'nope')).toThrow(/not found/i);
  });
});
