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
});
