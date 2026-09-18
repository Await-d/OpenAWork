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

describe('getProviderForSelection honorRequestedModel', () => {
  it('开启后显式选择的模型即使不在 catalog 也按请求原样路由', async () => {
    const resolved = await providerCatalog.getProviderForSelection(
      'user-honor',
      { providerId: enabledProvider.id, modelId: 'drifted-model' },
      { honorRequestedModel: true },
    );

    expect(resolved?.provider.id).toBe(enabledProvider.id);
    expect(resolved?.modelId).toBe('drifted-model');
  });

  it('provider 不存在或已禁用时不做无依据路由，仍回退 chat', async () => {
    const missingProvider = await providerCatalog.getProviderForSelection(
      'user-honor',
      { providerId: 'missing-provider', modelId: 'drifted-model' },
      { honorRequestedModel: true },
    );
    expect(missingProvider?.provider.id).toBe(enabledProvider.id);
    expect(missingProvider?.modelId).toBe('enabled-model');

    const disabledProviderSelection = await providerCatalog.getProviderForSelection(
      'user-honor',
      { providerId: disabledProvider.id, modelId: 'disabled-model' },
      { honorRequestedModel: true },
    );
    expect(disabledProviderSelection?.provider.id).toBe(enabledProvider.id);
    expect(disabledProviderSelection?.modelId).toBe('enabled-model');
  });

  it('未开启 honorRequestedModel 时保持历史回退行为', async () => {
    const resolved = await providerCatalog.getProviderForSelection('user-honor', {
      providerId: enabledProvider.id,
      modelId: 'drifted-model',
    });

    expect(resolved?.provider.id).toBe(enabledProvider.id);
    expect(resolved?.modelId).toBe('enabled-model');
  });
});
