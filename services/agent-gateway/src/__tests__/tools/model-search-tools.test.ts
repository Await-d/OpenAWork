import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';

vi.mock('../../provider/provider-catalog.js', () => ({
  getCatalog: vi.fn(),
}));

import { getCatalog } from '../../provider/provider-catalog.js';
import { modelSearchToolDefinition, runModelSearchTool } from '../../tools/model-search-tools.js';

function makeProvider(overrides: Partial<AIProvider> & Pick<AIProvider, 'id'>): AIProvider {
  return {
    type: 'custom',
    name: overrides.id,
    enabled: true,
    baseUrl: '',
    defaultModels: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setupCatalog(providers: AIProvider[]): void {
  vi.mocked(getCatalog).mockResolvedValue({
    providers,
  } as unknown as Awaited<ReturnType<typeof getCatalog>>);
}

describe('runModelSearchTool', () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockReset();
  });

  it('按 family 去重并保留每个 family 的最新版本', async () => {
    setupCatalog([
      makeProvider({
        id: 'acme',
        defaultModels: [
          {
            id: 'gpt-x',
            label: 'GPT-X',
            enabled: true,
            family: 'gpt-x',
            releaseDate: '2025-06-01',
          },
          {
            id: 'gpt-x-legacy',
            label: 'GPT-X Legacy',
            enabled: true,
            family: 'gpt-x',
            releaseDate: '2024-01-01',
          },
          { id: 'vision', label: 'Vision', enabled: true },
        ],
      }),
    ]);

    const result = await runModelSearchTool('user-1', { query: 'gpt-x', limit: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.next).toBeNull();
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.id).toBe('acme');
    expect(result.providers[0]?.models[0]?.id).toBe('acme/gpt-x');
    expect(result.providers[0]?.models[0]?.released).toBe(Date.parse('2025-06-01'));
  });

  it('把自身 provider 的分组排在最前', async () => {
    setupCatalog([
      makeProvider({
        id: 'beta',
        defaultModels: [{ id: 'sonnet', label: 'Sonnet', enabled: true }],
      }),
      makeProvider({ id: 'acme', defaultModels: [{ id: 'gpt-x', label: 'GPT-X', enabled: true }] }),
    ]);

    const result = await runModelSearchTool(
      'user-1',
      { limit: 20, offset: 0 },
      { ownProviderId: 'beta' },
    );

    expect(result.providers.map((group) => group.id)).toEqual(['beta', 'acme']);
  });

  it('跳过禁用的 provider 并对无匹配结果返回空列表', async () => {
    setupCatalog([
      makeProvider({
        id: 'disabled',
        enabled: false,
        defaultModels: [{ id: 'hidden', label: 'Hidden', enabled: true }],
      }),
    ]);

    const disabled = await runModelSearchTool('user-1', { limit: 20, offset: 0 });
    expect(disabled.total).toBe(0);
    expect(disabled.providers).toEqual([]);

    setupCatalog([
      makeProvider({ id: 'acme', defaultModels: [{ id: 'gpt-x', label: 'GPT-X', enabled: true }] }),
    ]);
    const unmatched = await runModelSearchTool('user-1', {
      query: '不存在的模型',
      limit: 20,
      offset: 0,
    });
    expect(unmatched.total).toBe(0);
    expect(unmatched.next).toBeNull();
  });

  it('按 offset / limit 分页并返回下一页偏移', async () => {
    setupCatalog([
      makeProvider({
        id: 'acme',
        defaultModels: [
          { id: 'm1', label: 'M1', enabled: true },
          { id: 'm2', label: 'M2', enabled: true },
          { id: 'm3', label: 'M3', enabled: true },
        ],
      }),
    ]);

    const firstPage = await runModelSearchTool('user-1', { limit: 2, offset: 0 });
    expect(firstPage.total).toBe(3);
    expect(firstPage.providers[0]?.models).toHaveLength(2);
    expect(firstPage.next).toBe(2);

    const secondPage = await runModelSearchTool('user-1', { limit: 2, offset: 2 });
    expect(secondPage.providers[0]?.models).toHaveLength(1);
    expect(secondPage.next).toBeNull();
  });
});

describe('modelSearchToolDefinition', () => {
  it('使用 models 作为模型可见名称', () => {
    expect(modelSearchToolDefinition.name).toBe('models');
    expect(modelSearchToolDefinition.description).toContain('模型');
  });
});
