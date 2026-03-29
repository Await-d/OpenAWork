import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunAsync, mockGetFirstAsync, mockExecAsync } = vi.hoisted(() => ({
  mockRunAsync: vi.fn().mockResolvedValue(undefined),
  mockGetFirstAsync: vi.fn().mockResolvedValue(null),
  mockExecAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn().mockResolvedValue({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
  }),
}));

import {
  buildMobileProviderConfig,
  loadMcpServers,
  restoreMobileProviderSelection,
  saveMcpServers,
} from '../store/providerPersistence';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildMobileProviderConfig', () => {
  it('builds provider config and active selection from selected provider + api key', () => {
    const config = buildMobileProviderConfig('openai', 'sk-test');

    expect(config.active.chat.providerId).toBe('openai');
    expect(config.active.fast.providerId).toBe('openai');
    expect(config.providers.find((provider) => provider.id === 'openai')?.apiKey).toBe('sk-test');
  });
});

describe('restoreMobileProviderSelection', () => {
  it('restores selected provider id and api key from stored config', () => {
    const config = buildMobileProviderConfig('anthropic', 'key-123');
    const restored = restoreMobileProviderSelection(config, 'key-123');

    expect(restored.selectedProviderId).toBe('anthropic');
    expect(restored.apiKey).toBe('key-123');
  });
});

describe('mcp server persistence helpers', () => {
  it('saves mcp servers into sqlite-backed settings storage', async () => {
    await saveMcpServers([
      { id: 'mcp-1', name: 'Test', url: 'http://localhost:8080', enabled: true },
    ]);

    expect(mockRunAsync).toHaveBeenCalled();
  });

  it('loads mcp servers from sqlite-backed settings storage', async () => {
    mockGetFirstAsync.mockResolvedValueOnce({
      value: JSON.stringify([
        { id: 'mcp-1', name: 'Test', url: 'http://localhost:8080', enabled: true },
      ]),
    });

    const servers = await loadMcpServers();
    expect(servers).toEqual([
      { id: 'mcp-1', name: 'Test', url: 'http://localhost:8080', enabled: true },
    ]);
  });
});
