import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type * as ProviderCatalogModule from '../../provider/provider-catalog.js';

const enabledProvider = {
  id: 'enabled-provider',
  type: 'openai',
  name: 'Enabled Provider',
  enabled: true,
  baseUrl: 'https://example.test/v1',
  defaultModels: [{ id: 'enabled-model', label: 'Enabled Model', enabled: true }],
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:00.000Z',
} satisfies AgentCoreModule.AIProvider;

const disabledProvider = {
  id: 'disabled-provider',
  type: 'openai',
  name: 'Disabled Provider',
  enabled: false,
  baseUrl: 'https://example.test/v1',
  defaultModels: [{ id: 'disabled-model', label: 'Disabled Model', enabled: true }],
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:00.000Z',
} satisfies AgentCoreModule.AIProvider;

const activeSelection = {
  chat: { providerId: enabledProvider.id, modelId: 'enabled-model' },
  fast: { providerId: enabledProvider.id, modelId: 'enabled-model' },
} satisfies AgentCoreModule.ActiveSelection;

vi.mock('../../infra/db.js', () => ({
  sqliteGet: () => null,
}));

vi.mock('@openAwork/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentCoreModule>();
  class StubProviderManager {
    async syncFromModelsDev() {
      return [];
    }

    getConfig() {
      return { providers: [enabledProvider, disabledProvider], active: activeSelection };
    }

    getChatProviderConfig() {
      return { provider: enabledProvider, model: enabledProvider.defaultModels[0]! };
    }
  }
  return { ...actual, ProviderManagerImpl: StubProviderManager };
});

let providerCatalog: typeof ProviderCatalogModule;

beforeEach(async () => {
  providerCatalog = await import('../../provider/provider-catalog.js');
  providerCatalog.invalidateAllCatalogs();
});

describe('getProviderForSelection strict selection', () => {
  it('默认保留 fallback 到 Chat 模型', async () => {
    const resolved = await providerCatalog.getProviderForSelection('user-strict', {
      providerId: disabledProvider.id,
      modelId: 'disabled-model',
    });

    expect(resolved?.provider.id).toBe(enabledProvider.id);
    expect(resolved?.modelId).toBe('enabled-model');
  });

  it('fallbackToChat=false 时模型不可用返回 null', async () => {
    const resolved = await providerCatalog.getProviderForSelection(
      'user-strict',
      {
        providerId: disabledProvider.id,
        modelId: 'disabled-model',
      },
      { fallbackToChat: false },
    );

    expect(resolved).toBeNull();
  });
});
