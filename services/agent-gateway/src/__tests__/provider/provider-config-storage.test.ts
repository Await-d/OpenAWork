import { describe, expect, it } from 'vitest';
import {
  materializeProviderConfig,
  materializeProviderConfigForStorage,
} from '../../provider/provider-config.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'provider-config-storage-test-secret-1234567890';

describe('materializeProviderConfigForStorage', () => {
  it('落库保留自定义模型，丢弃与 catalog 一致的模型', async () => {
    const catalog = await materializeProviderConfig(undefined, undefined);
    const catalogProvider = catalog.providers.find((provider) => provider.type === 'deepseek');
    expect(catalogProvider).toBeDefined();
    expect(catalogProvider?.defaultModels.length ?? 0).toBeGreaterThan(0);

    const customModel = { id: 'relay-only-model', label: 'Relay Only Model', enabled: true };
    const { providers } = await materializeProviderConfigForStorage(
      [
        {
          ...catalogProvider,
          id: 'deepseek',
          defaultModels: [...(catalogProvider?.defaultModels ?? []), customModel],
        },
      ],
      null,
    );

    expect(providers[0]?.defaultModels).toEqual([customModel]);
  });

  it('custom 类型 provider 无 catalog 对应项时原样保留', async () => {
    const customProvider = {
      id: 'custom-relay',
      type: 'custom' as const,
      name: 'Custom Relay',
      enabled: true,
      baseUrl: 'https://relay.example/v1',
      defaultModels: [{ id: 'relay-model', label: 'Relay Model', enabled: true }],
    };

    const { providers } = await materializeProviderConfigForStorage([customProvider], null);

    expect(providers.find((provider) => provider.id === 'custom-relay')?.defaultModels).toEqual(
      customProvider.defaultModels,
    );
  });

  it('落库后读回不丢失指向 catalog 派生模型的默认选择', async () => {
    const catalog = await materializeProviderConfig(undefined, undefined);
    const provider = catalog.providers.find(
      (item) => item.enabled && item.defaultModels.some((model) => model.enabled),
    );
    expect(provider).toBeDefined();
    const model = provider?.defaultModels.find((item) => item.enabled);
    expect(model).toBeDefined();

    const selection = {
      chat: { providerId: provider?.id ?? '', modelId: model?.id ?? '' },
      fast: { providerId: provider?.id ?? '', modelId: model?.id ?? '' },
    };

    // 落库只保留覆盖项：catalog 派生模型不会写回，读取时必须等目录同步补回
    // 模型清单后再校验选择，否则会误判失效并静默回退到 fallback。
    const stored = await materializeProviderConfigForStorage(catalog.providers, selection);
    expect(stored.activeSelection.chat).toEqual(selection.chat);

    const readBack = await materializeProviderConfig(stored.providers, stored.activeSelection);
    expect(readBack.activeSelection.chat).toEqual(selection.chat);
    expect(readBack.activeSelection.fast).toEqual(selection.fast);
  });
});
